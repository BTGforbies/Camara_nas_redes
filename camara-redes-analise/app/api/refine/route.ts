import { z } from "zod";

import { generateText } from "@/lib/ai";
import { ANALYSIS_SYSTEM_INSTRUCTIONS } from "@/lib/prompts";
import { REPORT_SECTION_IDS, SECTION_DEFINITIONS } from "@/lib/types";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(8_000),
});

const requestSchema = z.object({
  sectionId: z.enum([
    "whatTheySay",
    "featuredChannel",
    "whoMobilized",
    "whatMobilized",
    "executiveSummary",
  ]),
  currentContent: z.string().trim().min(1).max(120_000),
  instruction: z.string().trim().min(1).max(8_000),
  history: z.array(messageSchema).max(20).default([]),
});

function parseGrokResponse(value: string) {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as {
    message?: unknown;
    revisedContent?: unknown;
  };
  if (
    typeof parsed.message !== "string" ||
    typeof parsed.revisedContent !== "string" ||
    !parsed.revisedContent.trim()
  ) {
    throw new Error("O Grok não retornou uma revisão válida.");
  }
  return {
    message: parsed.message.trim(),
    revisedContent: parsed.revisedContent.trim(),
  };
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    if (!REPORT_SECTION_IDS.includes(body.sectionId)) {
      return Response.json({ error: "Resposta não disponível para revisão." }, { status: 400 });
    }
    const definition = SECTION_DEFINITIONS.find((item) => item.id === body.sectionId);
    if (!definition) throw new Error("Seção de resposta inválida.");

    const history = body.history
      .map((item) => `${item.role === "user" ? "USUÁRIO" : "GROK"}: ${item.content}`)
      .join("\n\n");
    const limit = definition.characterLimit ?? 4_000;
    const generated = await generateText({
      instructions: `${ANALYSIS_SYSTEM_INSTRUCTIONS}\n\nVocê também atua como editor. Ajude o usuário a aperfeiçoar uma resposta já gerada sem inventar fatos.`,
      input: `
RESPOSTA EM REVISÃO: ${definition.title}
LIMITE OBRIGATÓRIO: ${limit} caracteres com espaços

VERSÃO ATUAL:
${body.currentContent}

CONVERSA ANTERIOR:
${history || "Nenhuma."}

PEDIDO DO USUÁRIO:
${body.instruction}

Responda somente com JSON válido, sem bloco markdown, exatamente neste formato:
{"message":"explicação curta do que foi ajustado","revisedContent":"versão integral revisada"}

A versão revisada deve obedecer ao limite, preservar o sentido editorial da seção, usar português do Brasil e nunca acrescentar dados ausentes.
      `.trim(),
      signal: request.signal,
    });
    const result = parseGrokResponse(generated.text);
    if (result.revisedContent.length > limit) {
      throw new Error(`A revisão ultrapassou o limite de ${limit} caracteres. Peça ao Grok para resumir.`);
    }
    return Response.json({ ...result, model: generated.model });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "A solicitação de revisão está incompleta." }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível revisar a resposta." },
      { status: 500 },
    );
  }
}
