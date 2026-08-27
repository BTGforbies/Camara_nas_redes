import { z } from "zod";

import { generateText, ProviderError } from "@/lib/ai";
import {
  buildCharacterLimitRepairPrompt,
  buildSectionPrompt,
} from "@/lib/prompts";
import type { AnalyzeRequest } from "@/lib/types";

const sectionIds = [
  "classification",
  "qualitative",
  "whatTheySay",
  "featuredChannel",
  "whoMobilized",
  "whatMobilized",
  "executiveSummary",
] as const;

const projectSchema = z.object({
  projectName: z.string().trim().min(1).max(240),
  progressSheet: z.string().trim().max(12_000),
  situation: z.string().trim().max(8_000),
  subject: z.string().trim().min(1).max(8_000),
  context: z.string().trim().min(1).max(12_000),
  engagementByChannel: z.string().trim().max(20_000),
});

const requestSchema = z.object({
  sectionId: z.enum(sectionIds),
  project: projectSchema,
  workbook: z.object({
    fileName: z.string().min(1).max(255),
    totalSheets: z.number().int().positive(),
    usableSheets: z.number().int().positive(),
    recordCount: z.number().int().positive(),
    duplicateCount: z.number().int().nonnegative(),
    corruptedCount: z.number().int().nonnegative(),
    warnings: z.array(z.string().max(1_000)).max(100),
    contextText: z.string().min(1),
  }),
  previousResults: z.record(z.enum(sectionIds), z.string().max(120_000)),
  chunk: z
    .object({
      index: z.number().int().positive(),
      total: z.number().int().positive().max(100),
      aggregation: z.boolean(),
      finalAggregation: z.boolean(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  const maxBodyBytes = Number(process.env.AI_MAX_REQUEST_BYTES || 12_000_000);
  if (contentLength && contentLength > maxBodyBytes) {
    return Response.json(
      { error: "O arquivo processado excede o limite seguro da análise." },
      { status: 413 },
    );
  }

  try {
    const body = requestSchema.parse(await request.json()) as AnalyzeRequest;
    const maxContext = Number(process.env.AI_MAX_CONTEXT_CHARS || 2_000_000);
    if (body.workbook.contextText.length > maxContext) {
      return Response.json(
        {
          error: `O contexto ultrapassa o limite configurado de ${maxContext.toLocaleString("pt-BR")} caracteres.`,
        },
        { status: 413 },
      );
    }

    const prompt = buildSectionPrompt(body);
    let generated = await generateText({
      instructions: prompt.instructions,
      input: prompt.input,
      signal: request.signal,
    });

    if (
      prompt.definition.characterLimit &&
      generated.text.length > prompt.definition.characterLimit
    ) {
      generated = await generateText({
        instructions: prompt.instructions,
        input: buildCharacterLimitRepairPrompt(
          generated.text,
          prompt.definition.characterLimit,
        ),
        signal: request.signal,
      });
    }

    return Response.json({
      content: generated.text,
      characterCount: generated.text.length,
      model: generated.model,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Os dados enviados estão incompletos ou inválidos." },
        { status: 400 },
      );
    }
    if (error instanceof ProviderError) {
      return Response.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha inesperada durante a análise.",
      },
      { status: 500 },
    );
  }
}
