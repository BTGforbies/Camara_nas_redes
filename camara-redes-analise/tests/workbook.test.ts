import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  parseWorkbookArrayBuffer,
  splitWorkbookContext,
  validateWorkbookBytes,
} from "../lib/workbook";

function makeWorkbook(bookType: "xlsx" | "biff8") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Author", "Text", "Channel", "Engagement Score"],
      ["Ana", "Apoio a proposta", "Instagram", 10],
      ["Ana", "Apoio a proposta", "Instagram", 10],
      ["Bruno", "Apoio a proposta", "X", 7],
    ]),
    "Postagens",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Autor", "Comentário", "Canal"],
      ["Carla", "Discordo do texto", "Facebook"],
    ]),
    "Complemento",
  );
  return XLSX.write(workbook, { type: "array", bookType });
}

function makeCsv() {
  return new TextEncoder().encode(
    [
      "Author;Text;Channel;Engagement Score",
      "Ana;Apoio a proposta;Instagram;10",
      "Ana;Apoio a proposta;Instagram;10",
      "Bruno;Discordo da proposta;X;7",
    ].join("\n"),
  ).buffer;
}

test("processa xlsx com várias planilhas e marca repetido do mesmo autor", () => {
  const bytes = makeWorkbook("xlsx") as ArrayBuffer;
  const result = parseWorkbookArrayBuffer(bytes, {
    fileName: "proposta.xlsx",
    fileSize: bytes.byteLength,
  });

  assert.equal(result.totalSheets, 2);
  assert.equal(result.usableSheets, 2);
  assert.equal(result.recordCount, 4);
  assert.equal(result.duplicateCount, 1);
  assert.match(result.contextText, /REPETIDO DE Postagens!2/);
  assert.match(result.contextText, /Complemento/);
});

test("aceita arquivo xls binário", () => {
  const bytes = makeWorkbook("biff8") as ArrayBuffer;
  const result = parseWorkbookArrayBuffer(bytes, {
    fileName: "proposta.xls",
    fileSize: bytes.byteLength,
  });
  assert.equal(result.extension, ".xls");
  assert.equal(result.recordCount, 4);
});

test("aceita csv separado por ponto e vírgula", () => {
  const bytes = makeCsv();
  const result = parseWorkbookArrayBuffer(bytes, {
    fileName: "proposta.csv",
    fileSize: bytes.byteLength,
  });

  assert.equal(result.extension, ".csv");
  assert.equal(result.totalSheets, 1);
  assert.equal(result.recordCount, 3);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.sheets[0].detectedColumns.author, "Author");
  assert.equal(result.sheets[0].detectedColumns.text, "Text");
});

test("rejeita extensão e assinatura incompatíveis", () => {
  const invalid = new TextEncoder().encode("não é excel").buffer;
  assert.throws(
    () => validateWorkbookBytes("proposta.txt", invalid.byteLength, invalid),
    /Formato não permitido/,
  );
  assert.throws(
    () => validateWorkbookBytes("proposta.xlsx", invalid.byteLength, invalid),
    /extensão não corresponde/,
  );

  const binary = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer;
  assert.throws(
    () => validateWorkbookBytes("proposta.csv", binary.byteLength, binary),
    /extensão não corresponde/,
  );
});

test("bloqueia contexto acima do limite sem truncar", () => {
  const bytes = makeWorkbook("xlsx") as ArrayBuffer;
  assert.throws(
    () =>
      parseWorkbookArrayBuffer(
        bytes,
        { fileName: "proposta.xlsx", fileSize: bytes.byteLength },
        { maxContextCharacters: 20 },
      ),
    /ultrapassa o limite configurado/,
  );
});

test("envia à IA somente as colunas relevantes quando elas são detectadas", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Author", "Text", "Channel", "Engagement Score", "URL enorme", "Metadado"],
      ["Ana", "Apoio a proposta", "Instagram", 10, "https://exemplo.test/postagem", "ignorar"],
    ]),
    "Dados",
  );
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const result = parseWorkbookArrayBuffer(bytes, {
    fileName: "dados.xlsx",
    fileSize: bytes.byteLength,
  });

  assert.match(result.contextText, /Author \| Text \| Channel \| Engagement Score/);
  assert.doesNotMatch(result.contextText, /URL enorme|exemplo\.test|Metadado|ignorar/);
});

test("divide uma base grande em lotes e repete os cabeçalhos", () => {
  const context = [
    "PLANILHA: Dados",
    "COLUNAS: Author | Text | Channel",
    ...Array.from(
      { length: 500 },
      (_, index) => `Dados!${index + 2} | Autor ${index} | ${"texto ".repeat(20)} | Instagram`,
    ),
  ].join("\n");
  const chunks = splitWorkbookContext(context, 12_000);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 12_000);
    assert.match(chunk, /^PLANILHA: Dados\nCOLUNAS: Author \| Text \| Channel/);
  }
  assert.match(chunks.at(-1) ?? "", /Dados!501/);
});
