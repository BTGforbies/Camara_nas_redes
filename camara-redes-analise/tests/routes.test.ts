import assert from "node:assert/strict";
import test from "node:test";

import { POST as classifyPost } from "../app/api/classify/route";
import { POST as reportPost } from "../app/api/report/route";

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("rota de classificação valida todos os ids do lote", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_teste_local";
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                {
                  id: "P000001",
                  status: "RELEVANTE",
                  stance: "POSITIVO",
                  themes: ["Apoio à proposta"],
                },
              ],
            }),
          },
        },
      ],
    });

  try {
    const response = await classifyPost(
      request("/api/classify", {
        subject: "Assunto",
        context: "Contexto",
        knownThemes: [],
        records: [{ id: "P000001", text: "Apoio o projeto." }],
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.classifications[0].id, "P000001");
    assert.deepEqual(body.classifications[0].themes, ["Apoio à proposta"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("classificação relevante sem argumento recebe tema geral e não interrompe", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_teste_local";
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                {
                  id: "P000021",
                  status: "RELEVANTE",
                  stance: "NEGATIVO",
                  themes: [],
                },
              ],
            }),
          },
        },
      ],
    });

  try {
    const response = await classifyPost(
      request("/api/classify", {
        subject: "Assunto",
        context: "Contexto",
        knownThemes: [],
        records: [{ id: "P000021", text: "Isso não resolve o problema." }],
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.classifications[0].themes, [
      "Crítica geral ao assunto",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});

test("rota final fixa números, caixa alta e postagem original", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_teste_local";
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              rankingItems: [
                {
                  themeIndex: 1,
                  explanation: "O argumento defende a aprovação da proposta.",
                  representativeId: "P000001",
                },
              ],
              whatTheySay: "A maioria apoia a proposta.",
              featuredChannel: "O Facebook concentrou o debate.",
              whoMobilized: "A Página A reuniu a maior mobilização.",
              whatMobilized: "A espera pela votação pode ter ampliado o debate.",
              executiveSummary: "O apoio apareceu como posição principal.",
            }),
          },
        },
      ],
    });

  try {
    const response = await reportPost(
      request("/api/report", {
        project: {
          projectName: "PL 1/2026",
          progressSheet: "",
          situation: "Em análise",
          subject: "Assunto",
          context: "Contexto",
          engagementByChannel: "",
        },
        summary: {
          metrics: {
            totalGross: 3,
            analyzed: 3,
            offTopic: 1,
            repeated: 0,
            corrupted: 0,
            relevant: 2,
          },
          stances: { POSITIVO: 2, NEGATIVO: 0, NEUTRO: 0 },
          themes: [
            {
              name: "apoio direto à proposta",
              count: 2,
              percentage: 100,
              candidates: [
                { id: "P000001", text: "Apoio totalmente." },
              ],
            },
          ],
          argumentOverview: [
            {
              name: "apoio direto à proposta",
              count: 2,
              percentage: 100,
            },
          ],
          otherThemeOccurrences: 0,
          channels: [{ name: "Facebook", posts: 2, engagement: 50 }],
          authors: [{ name: "Página A", posts: 1, engagement: 50 }],
        },
      }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(
      body.sections.qualitative,
      /\*\*1 - APOIO DIRETO À PROPOSTA \| 2 ocorrências \(100,0%\)\*\*/,
    );
    assert.match(body.sections.qualitative, /"Apoio totalmente\."/);
    assert.equal(body.sections.whatTheySay, "A maioria apoia a proposta.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  }
});
