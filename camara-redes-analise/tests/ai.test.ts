import assert from "node:assert/strict";
import test from "node:test";

import { generateText, ProviderError } from "../lib/ai";

test("envia a geração ao Chat Completions da Groq", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_MODEL;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};

  process.env.GROQ_API_KEY = "gsk_teste_local";
  process.env.GROQ_MODEL = "groq/compound";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: "Resposta de teste" } }],
    });
  };

  try {
    const result = await generateText({
      instructions: "Responda em português.",
      input: "Faça um resumo.",
    });

    assert.equal(
      requestUrl,
      "https://api.groq.com/openai/v1/chat/completions",
    );
    assert.equal(requestBody.model, "groq/compound");
    assert.deepEqual(requestBody.messages, [
      { role: "system", content: "Responda em português." },
      { role: "user", content: "Faça um resumo." },
    ]);
    assert.equal(result.text, "Resposta de teste");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  }
});

test("orienta configurar GROQ_API_KEY quando a chave não existe", async () => {
  const originalKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;

  try {
    await assert.rejects(
      generateText({ instructions: "Teste", input: "Teste" }),
      /Configure GROQ_API_KEY/,
    );
  } finally {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("preserva o status 413 retornado pela Groq", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_teste_local";
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Request Entity Too Large" } },
      { status: 413 },
    );

  try {
    await assert.rejects(
      generateText({ instructions: "Teste", input: "Teste" }),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.status === 413 &&
        /capacidade de contexto/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("troca o Compound pelo GPT-OSS quando a Groq recusa o lote", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_MODEL;
  const requestedModels: string[] = [];

  process.env.GROQ_API_KEY = "gsk_teste_local";
  process.env.GROQ_MODEL = "groq/compound";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    requestedModels.push(body.model);
    if (body.model === "groq/compound") {
      return Response.json(
        { error: { message: "Request Entity Too Large" } },
        { status: 413 },
      );
    }
    return Response.json({
      choices: [{ message: { content: "Resposta pelo modelo alternativo" } }],
    });
  };

  try {
    const result = await generateText({
      instructions: "Teste",
      input: "Teste",
    });

    assert.deepEqual(requestedModels, [
      "groq/compound",
      "openai/gpt-oss-120b",
    ]);
    assert.equal(result.model, "openai/gpt-oss-120b");
    assert.equal(result.text, "Resposta pelo modelo alternativo");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  }
});
