import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  parseWorkbookArrayBuffer,
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
  assert.equal(result.sheets[0].rows[1].duplicateOf, "Postagens!2");
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

test("preserva somente a planilha local, sem criar um prompt bruto", () => {
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

  assert.equal("contextText" in result, false);
  assert.equal(result.sheets[0].rows[0].values[4], "https://exemplo.test/postagem");
});

test("mantém a célula longa no arquivo e avisa sobre compactação para IA", () => {
  const workbook = XLSX.utils.book_new();
  const longText = `Início do argumento. ${"detalhe relevante ".repeat(500)}Fim do argumento.`;
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Author", "Text", "Channel"],
      ["Ana", longText, "Facebook"],
    ]),
    "Dados",
  );
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const result = parseWorkbookArrayBuffer(bytes, {
    fileName: "texto-longo.xlsx",
    fileSize: bytes.byteLength,
  });

  assert.match(result.warnings.join(" "), /versão compacta e anonimizada/);
  assert.equal(result.sheets[0].rows[0].values[1], longText);
});

test("prioriza o texto completo e reconhece colunas de link e título", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Original Post", "Full Text", "URL", "Title"],
      [
        "Texto repetido da publicação original",
        "Comentário individual com um argumento",
        "https://noticias.example/materia",
        "Notícia relacionada",
      ],
    ]),
    "Comentários",
  );
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const result = parseWorkbookArrayBuffer(bytes, {
    fileName: "comentarios.xlsx",
    fileSize: bytes.byteLength,
  });

  assert.equal(result.sheets[0].detectedColumns.text, "Full Text");
  assert.equal(result.sheets[0].detectedColumns.link, "URL");
  assert.equal(result.sheets[0].detectedColumns.title, "Title");
});
