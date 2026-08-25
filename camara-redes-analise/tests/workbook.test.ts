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

test("rejeita extensão e assinatura incompatíveis", () => {
  const invalid = new TextEncoder().encode("não é excel").buffer;
  assert.throws(
    () => validateWorkbookBytes("proposta.csv", invalid.byteLength, invalid),
    /Formato não permitido/,
  );
  assert.throws(
    () => validateWorkbookBytes("proposta.xlsx", invalid.byteLength, invalid),
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

