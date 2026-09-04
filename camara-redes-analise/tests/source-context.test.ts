import assert from "node:assert/strict";
import test from "node:test";

import { inspectSource, safePublicUrl } from "../lib/source-context";

test("bloqueia links locais e portas não públicas", () => {
  assert.throws(() => safePublicUrl("http://localhost/noticia"), /domínio público/);
  assert.throws(
    () => safePublicUrl("https://noticias.example:8080/noticia"),
    /porta do link não é pública/,
  );
});

test("extrai título, descrição e trecho de uma notícia pública", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<!doctype html><html><head><title>Título antigo</title><meta property="og:title" content="Notícia principal"><meta name="description" content="Resumo da notícia"></head><body><header>Menu</header><main>A proposta entrou na pauta após a audiência pública.</main></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  try {
    const context = await inspectSource({
      url: "https://noticias.example/materia",
      occurrences: 4,
    });
    assert.equal(context.available, true);
    assert.equal(context.domain, "noticias.example");
    assert.equal(context.title, "Notícia principal");
    assert.equal(context.description, "Resumo da notícia");
    assert.match(context.excerpt, /entrou na pauta/);
    assert.doesNotMatch(context.excerpt, /Menu/);
    assert.equal(context.occurrences, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
