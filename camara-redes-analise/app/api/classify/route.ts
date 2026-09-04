import { z } from "zod";

import { generateText, ProviderError } from "@/lib/ai";
import { buildClassificationPrompt, ANALYSIS_SYSTEM_INSTRUCTIONS } from "@/lib/prompts";

const recordSchema = z.object({
  id: z.string().regex(/^P\d{6}$/),
  text: z.string().trim().min(1).max(1_000),
});

const requestSchema = z.object({
  subject: z.string().trim().min(1).max(1_000),
  context: z.string().trim().min(1).max(1_500),
  knownThemes: z.array(z.string().trim().min(1).max(48)).max(80).default([]),
  records: z.array(recordSchema).min(1).max(20),
});

const outputItemSchema = z.object({
  id: z.string(),
  status: z.enum(["RELEVANTE", "OFFTOPIC"]),
  stance: z.enum(["POSITIVO", "NEGATIVO", "NEUTRO"]),
  themes: z.array(z.string()).max(12),
});

const outputSchema = z.object({
  items: z.array(outputItemSchema).min(1).max(20),
});

const classificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["RELEVANTE", "OFFTOPIC"] },
          stance: {
            type: "string",
            enum: ["POSITIVO", "NEGATIVO", "NEUTRO"],
          },
          themes: {
            type: "array",
            minItems: 0,
            maxItems: 12,
            items: { type: "string", maxLength: 48 },
          },
        },
        required: ["id", "status", "stance", "themes"],
      },
    },
  },
  required: ["items"],
};

function cleanTheme(value: string) {
  return value
    .replace(/[|*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function fallbackTheme(stance: "POSITIVO" | "NEGATIVO" | "NEUTRO") {
  if (stance === "POSITIVO") return "Apoio geral ao assunto";
  if (stance === "NEGATIVO") return "Crítica geral ao assunto";
  return "Menção geral ao assunto";
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const generated = await generateText({
      instructions: ANALYSIS_SYSTEM_INSTRUCTIONS,
      input: buildClassificationPrompt(body),
      purpose: "bulk",
      jsonSchema: {
        name: "classificacao_postagens",
        schema: classificationJsonSchema,
      },
      maxCompletionTokens: Math.min(5_000, Math.max(1_200, body.records.length * 220)),
      signal: request.signal,
    });
    const parsed = outputSchema.parse(JSON.parse(generated.text));
    const expectedIds = new Set(body.records.map((record) => record.id));
    const returnedIds = new Set(parsed.items.map((item) => item.id));

    if (
      returnedIds.size !== parsed.items.length ||
      returnedIds.size !== expectedIds.size ||
      [...expectedIds].some((id) => !returnedIds.has(id)) ||
      parsed.items.some((item) => !expectedIds.has(item.id))
    ) {
      throw new Error("A Groq não devolveu todos os identificadores do lote.");
    }

    const classifications = parsed.items.map((item) => {
      if (item.status === "OFFTOPIC") {
        return { ...item, stance: "NEUTRO" as const, themes: [] };
      }
      const themes = [...new Set(item.themes.map(cleanTheme).filter(Boolean))];
      return {
        ...item,
        themes: themes.length ? themes : [fallbackTheme(item.stance)],
      };
    });

    return Response.json(
      { classifications, model: generated.model },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "A classificação retornou dados inválidos. Tente novamente." },
        { status: 502 },
      );
    }
    if (error instanceof ProviderError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível classificar este lote.",
      },
      { status: 500 },
    );
  }
}
