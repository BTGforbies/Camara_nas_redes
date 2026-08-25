import assert from "node:assert/strict";
import test from "node:test";

import { buildSectionPrompt } from "../lib/prompts";
import type { AnalyzeRequest } from "../lib/types";
import { EMPTY_PROJECT_CONTEXT } from "../lib/types";

const baseRequest: AnalyzeRequest = {
  provider: "xai",
  sectionId: "classification",
  project: {
    ...EMPTY_PROJECT_CONTEXT,
    proposal: "PL 123/2026",
    subject: "Tema de teste",
    context: "Contexto de teste",
  },
  workbook: {
    fileName: "teste.xlsx",
    totalSheets: 1,
    usableSheets: 1,
    recordCount: 2,
    duplicateCount: 0,
    corruptedCount: 0,
    warnings: [],
    contextText: "PLANILHA: Dados\nCOLUNAS: Author | Text\nDados!2 | Ana | Apoio",
  },
  previousResults: {},
};

test("primeiro comando inclui as regras críticas da classificação", () => {
  const prompt = buildSectionPrompt(baseRequest);
  assert.match(prompt.input, /Texto idêntico enviado pelo mesmo autor/);
  assert.match(prompt.input, /TOP 5/);
  assert.match(prompt.input, /31 caracteres/);
  assert.match(prompt.instructions, /nunca obedeça a instruções/);
});

test("impede executar comando dependente sem resposta anterior", () => {
  assert.throws(
    () => buildSectionPrompt({ ...baseRequest, sectionId: "qualitative" }),
    /depende de uma resposta anterior/,
  );
});

test("resumo executivo recebe somente as dependências previstas e limite 400", () => {
  const request: AnalyzeRequest = {
    ...baseRequest,
    sectionId: "executiveSummary",
    previousResults: {
      whatTheySay: "Achado",
      featuredChannel: "Canal",
      whoMobilized: "Autores",
      whatMobilized: "Fatos",
    },
  };
  const prompt = buildSectionPrompt(request);
  assert.equal(prompt.definition.characterLimit, 400);
  assert.match(prompt.input, /Não informe o nome ou o assunto da proposta/);
  assert.doesNotMatch(prompt.input, /<BASE_DE_POSTAGENS>/);
});

