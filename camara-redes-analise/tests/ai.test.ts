import assert from "node:assert/strict";
import test from "node:test";

import { generateText, ProviderError } from "../lib/ai";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("envia a geração qualitativa ao Chat Completions da Groq", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_QUALITY_MODEL;
  let requestUrl = "";
  let requestHeaders = new Headers();
  let requestBody: Record<string, unknown> = {};

  process.env.GROQ_API_KEY = "gsk_chave_de_teste_local";
  process.env.GROQ_QUALITY_MODEL = "openai/gpt-oss-120b";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: "Resposta de teste" } }],
    });
  };

  try {
    const result = await generateText({
      instructions: "Responda em português.",
      input: "Faça um resumo.",
      purpose: "quality",
    });

    assert.equal(
      requestUrl,
      "https://api.groq.com/openai/v1/chat/completions",
    );
    assert.equal(
      requestHeaders.get("authorization"),
      "Bearer gsk_chave_de_teste_local",
    );
    assert.deepEqual(requestBody.messages, [
      { role: "system", content: "Responda em português." },
      { role: "user", content: "Faça um resumo." },
    ]);
    assert.equal(requestBody.include_reasoning, false);
    assert.equal(requestBody.reasoning_effort, "medium");
    assert.equal(result.model, "openai/gpt-oss-120b");
    assert.equal(result.text, "Resposta de teste");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GROQ_API_KEY", originalKey);
    restoreEnv("GROQ_QUALITY_MODEL", originalModel);
  }
});

test("usa o modelo econômico e Structured Outputs na classificação", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_BULK_MODEL;
  let requestBody: Record<string, unknown> = {};

  process.env.GROQ_API_KEY = "gsk_chave_de_teste_local";
  process.env.GROQ_BULK_MODEL = "openai/gpt-oss-20b";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: '{"items":[]}' } }],
    });
  };

  try {
    const result = await generateText({
      instructions: "Classifique.",
      input: "Lote.",
      purpose: "bulk",
      jsonSchema: {
        name: "teste",
        schema: {
          type: "object",
          properties: { items: { type: "array", items: {} } },
          required: ["items"],
        },
      },
    });

    assert.equal(requestBody.model, "openai/gpt-oss-20b");
    assert.equal(requestBody.reasoning_effort, "low");
    assert.deepEqual(requestBody.response_format, {
      type: "json_schema",
      json_schema: {
        name: "teste",
        strict: true,
        schema: {
          type: "object",
          properties: { items: { type: "array", items: {} } },
          required: ["items"],
        },
      },
    });
    assert.equal(result.model, "openai/gpt-oss-20b");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GROQ_API_KEY", originalKey);
    restoreEnv("GROQ_BULK_MODEL", originalModel);
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
    restoreEnv("GROQ_API_KEY", originalKey);
  }
});

test("preserva o status 413 retornado pela Groq", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_chave_de_teste_local";
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
        /dividido automaticamente/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GROQ_API_KEY", originalKey);
  }
});

test("traduz chave inválida sem expor a credencial", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_chave_de_teste_local";
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Invalid API key: gsk_segredo" } },
      { status: 401 },
    );

  try {
    await assert.rejects(
      generateText({ instructions: "Teste", input: "Teste" }),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.status === 401 &&
        /GROQ_API_KEY/.test(error.message) &&
        !/gsk_segredo/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GROQ_API_KEY", originalKey);
  }
});
