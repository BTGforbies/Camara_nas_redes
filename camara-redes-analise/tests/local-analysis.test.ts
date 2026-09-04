import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  aggregateAnalysis,
  buildClassificationBatches,
  extractPublicUrls,
  mergeSourceReferences,
  parseEngagement,
  prepareWorkbookAnalysis,
  redactSensitiveText,
  renderAutomaticTables,
} from "../lib/local-analysis";
import { parseWorkbookArrayBuffer } from "../lib/workbook";

function analysisWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Author", "Text", "Channel", "Engagement Score"],
      [
        "Ana",
        "Apoio. Contato ana@example.com, @ana e https://example.com/post. Telefone (61) 99999-1234.",
        "Facebook",
        "3.432",
      ],
      [
        "Ana",
        "Apoio. Contato ana@example.com, @ana e https://example.com/post. Telefone (61) 99999-1234.",
        "Facebook",
        "3.432",
      ],
      ["Bruno", "Receita de bolo sem relação.", "X", "10"],
      ["Carla", "Já passou da hora de aprovar.", "Facebook", "20"],
      ["Davi", "Comentário sem canal.", "", "5"],
    ]),
    "Dados",
  );
  const bytes = XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return parseWorkbookArrayBuffer(bytes, {
    fileName: "dados.xlsx",
    fileSize: bytes.byteLength,
  });
}

test("prepara lotes sem autor e remove identificadores óbvios", () => {
  const prepared = prepareWorkbookAnalysis(analysisWorkbook());
  const serialized = JSON.stringify(prepared.records);

  assert.equal(prepared.rows.length, 5);
  assert.equal(prepared.records.length, 3);
  assert.doesNotMatch(serialized, /Ana|Bruno|Carla/);
  assert.doesNotMatch(serialized, /ana@example|example\.com|@ana|99999-1234/);
  assert.match(serialized, /\[e-mail removido\]/);
  assert.match(serialized, /\[perfil removido\]/);
  assert.match(serialized, /\[link removido\]/);
  assert.match(serialized, /\[telefone removido\]/);
  assert.ok(prepared.records.every((record) => record.text.length <= 900));
  assert.equal(prepared.sources[0].url, "https://example.com/post");
  assert.equal(prepared.sources[0].occurrences, 2);
});

test("divide por tamanho e por no máximo vinte registros", () => {
  const records = Array.from({ length: 45 }, (_, index) => ({
    id: `P${String(index + 1).padStart(6, "0")}`,
    text: "argumento ".repeat(70),
  }));
  const batches = buildClassificationBatches(records, 10_000);

  assert.ok(batches.length > 2);
  assert.equal(batches.flat().length, records.length);
  for (const batch of batches) {
    assert.ok(batch.length <= 20);
    assert.ok(JSON.stringify(batch).length <= 10_000);
  }
});

test("calcula métricas, percentuais, canais e autores localmente", () => {
  const prepared = prepareWorkbookAnalysis(analysisWorkbook());
  const summary = aggregateAnalysis(prepared, [
    {
      id: "P000001",
      status: "RELEVANTE",
      stance: "POSITIVO",
      themes: ["Apoio direto à proposta"],
    },
    {
      id: "P000003",
      status: "OFFTOPIC",
      stance: "NEUTRO",
      themes: [],
    },
    {
      id: "P000004",
      status: "RELEVANTE",
      stance: "POSITIVO",
      themes: ["Crítica à demora", "Apoio direto à proposta"],
    },
  ]);

  assert.deepEqual(summary.metrics, {
    totalGross: 5,
    analyzed: 5,
    offTopic: 1,
    repeated: 1,
    corrupted: 1,
    relevant: 2,
  });
  assert.equal(summary.themes[0].name, "Apoio direto à proposta");
  assert.equal(summary.themes[0].count, 2);
  assert.equal(summary.themes[0].percentage, 100);
  assert.equal(summary.argumentOverview.length, 2);
  assert.equal(summary.channels[0].name, "Facebook");
  assert.equal(summary.channels[0].posts, 2);
  assert.equal(summary.authors.length, 2);

  const tables = renderAutomaticTables(summary);
  assert.match(tables, /Total RELEVANTES \(base de cálculo\).*\*\*2\*\*/);
  assert.match(tables, /Apoio direto à proposta \| 2 \| 100,0%/);
  assert.match(tables, /Outras opiniões sobre o assunto/);
});

test("deduplica links e remove parâmetros de rastreamento", () => {
  const links = extractPublicUrls(
    "Veja https://noticias.example/materia?utm_source=rede&fbclid=abc e https://noticias.example/materia.",
  );
  const sources = mergeSourceReferences(
    links.map((url) => ({ url, occurrences: 1 })),
  );

  assert.deepEqual(links, ["https://noticias.example/materia"]);
  assert.equal(sources.length, 1);
});

test("normaliza pontos de engajamento e redações sensíveis", () => {
  assert.equal(parseEngagement("3.432"), 3432);
  assert.equal(parseEngagement("1.234,5"), 1234.5);
  assert.equal(parseEngagement("10,5"), 10.5);
  assert.equal(
    redactSensitiveText("Fale com pessoa@site.com"),
    "Fale com [e-mail removido]",
  );
});
