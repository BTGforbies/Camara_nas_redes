import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { generateReportPdf, reportFileName } from "../lib/pdf";

const transparentPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("gera PDF A4 paginado com imagem e conteúdo longo", async () => {
  const content = Array.from(
    { length: 120 },
    (_, index) => `Linha ${index + 1}: análise objetiva com acentuação e informação validada.`,
  ).join("\n");
  const bytes = await generateReportPdf({
    projectName: "PL 123/2026 - Proteção à infância",
    headerImage: transparentPng,
    sections: [
      { title: "Classificação, contagens e ranking", content },
      { title: "Resumo executivo", content: "Síntese final dos resultados." },
    ],
  });
  const document = await PDFDocument.load(bytes);
  assert.ok(bytes.byteLength > 3_000);
  assert.ok(document.getPageCount() >= 2);
  const size = document.getPage(0).getSize();
  assert.ok(Math.abs(size.width - 595.28) < 0.1);
  assert.ok(Math.abs(size.height - 841.89) < 0.1);
});

test("normaliza o nome do arquivo", () => {
  const name = reportFileName("PL 123/2026: Educação & Saúde", new Date("2026-08-25T12:00:00Z"));
  assert.equal(name, "Analise_PL_123_2026_Educacao_Saude_2026-08-25.pdf");
});

