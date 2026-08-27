import assert from "node:assert/strict";
import test from "node:test";

import { generateText } from "../lib/ai";

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
