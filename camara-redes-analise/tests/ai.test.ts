import assert from "node:assert/strict";
import test from "node:test";

import { generateText, ProviderError } from "../lib/ai";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("envia a geração qualitativa ao Gemini", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_QUALITY_MODEL;
  let requestUrl = "";
  let requestHeaders = new Headers();
  let requestBody: Record<string, unknown> = {};

  process.env.GEMINI_API_KEY = "AIza-chave-de-teste-local";
  process.env.GEMINI_QUALITY_MODEL = "gemini-3.6-flash";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      candidates: [
        { content: { parts: [{ text: "Resposta de teste" }] } },
      ],
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    );
    assert.equal(
      requestHeaders.get("x-goog-api-key"),
      "AIza-chave-de-teste-local",
    );
    assert.deepEqual(requestBody.systemInstruction, {
      parts: [{ text: "Responda em português." }],
    });
    assert.deepEqual(requestBody.contents, [
      { role: "user", parts: [{ text: "Faça um resumo." }] },
    ]);
    assert.deepEqual(
      (requestBody.generationConfig as Record<string, unknown>).thinkingConfig,
      { thinkingLevel: "low", includeThoughts: false },
    );
    assert.equal(result.model, "gemini-3.6-flash");
    assert.equal(result.text, "Resposta de teste");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GEMINI_API_KEY", originalKey);
    restoreEnv("GEMINI_QUALITY_MODEL", originalModel);
  }
});

test("usa o modelo econômico na classificação em massa", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_BULK_MODEL;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};

  process.env.GEMINI_API_KEY = "AIza-chave-de-teste-local";
  process.env.GEMINI_BULK_MODEL = "gemini-3.5-flash-lite";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      candidates: [{ content: { parts: [{ text: "Lote classificado" }] } }],
    });
  };

  try {
    const result = await generateText({
      instructions: "Classifique.",
      input: "Lote.",
      purpose: "bulk",
    });

    assert.match(requestUrl, /gemini-3\.5-flash-lite:generateContent$/);
    assert.deepEqual(
      (requestBody.generationConfig as Record<string, unknown>).thinkingConfig,
      { thinkingLevel: "minimal", includeThoughts: false },
    );
    assert.equal(result.model, "gemini-3.5-flash-lite");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GEMINI_API_KEY", originalKey);
    restoreEnv("GEMINI_BULK_MODEL", originalModel);
  }
});

test("orienta configurar GEMINI_API_KEY quando a chave não existe", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    await assert.rejects(
      generateText({ instructions: "Teste", input: "Teste" }),
      /Configure GEMINI_API_KEY/,
    );
  } finally {
    restoreEnv("GEMINI_API_KEY", originalKey);
  }
});

test("preserva o status 413 retornado pelo Gemini", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "AIza-chave-de-teste-local";
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
        /capacidade aceita/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GEMINI_API_KEY", originalKey);
  }
});

test("traduz a resposta de chave inválida sem expor a credencial", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "AIza-chave-de-teste-local";
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "API key not valid. Please pass a valid API key." } },
      { status: 400 },
    );

  try {
    await assert.rejects(
      generateText({ instructions: "Teste", input: "Teste" }),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.status === 400 &&
        /GEMINI_API_KEY/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("GEMINI_API_KEY", originalKey);
  }
});
