import { z } from "zod";

import { generateText, ProviderError } from "@/lib/ai";
import { normalizeQualitativeRanking } from "@/lib/analysis-format";
import { ANALYSIS_SYSTEM_INSTRUCTIONS, buildReportPrompt } from "@/lib/prompts";

const projectSchema = z.object({
  projectName: z.string().trim().min(1).max(240),
  progressSheet: z.string().trim().max(800),
  situation: z.string().trim().max(800),
  subject: z.string().trim().min(1).max(1_000),
  context: z.string().trim().min(1).max(1_500),
  engagementByChannel: z.string().trim().max(2_000),
});

const namedAggregateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  posts: z.number().int().nonnegative(),
  engagement: z.number().finite(),
});

const summarySchema = z.object({
  metrics: z.object({
    totalGross: z.number().int().nonnegative(),
    analyzed: z.number().int().nonnegative(),
    offTopic: z.number().int().nonnegative(),
    repeated: z.number().int().nonnegative(),
    corrupted: z.number().int().nonnegative(),
    relevant: z.number().int().nonnegative(),
  }),
  stances: z.object({
    POSITIVO: z.number().int().nonnegative(),
    NEGATIVO: z.number().int().nonnegative(),
    NEUTRO: z.number().int().nonnegative(),
  }),
  themes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(48),
        count: z.number().int().positive(),
        percentage: z.number().finite().nonnegative(),
        candidates: z
          .array(
            z.object({
              id: z.string().regex(/^P\d{6}$/),
              text: z.string().trim().min(1).max(1_000),
            }),
          )
          .max(3),
      }),
    )
    .max(5),
  otherThemeOccurrences: z.number().int().nonnegative(),
  channels: z.array(namedAggregateSchema).max(10),
  authors: z.array(namedAggregateSchema).max(10),
});

const requestSchema = z.object({
  project: projectSchema,
  summary: summarySchema,
});

const generatedSchema = z.object({
  rankingItems: z
    .array(
      z.object({
        themeIndex: z.number().int(),
        explanation: z.string().trim().min(1),
        representativeId: z.string(),
      }),
    )
    .max(5),
  whatTheySay: z.string().trim().min(1),
  featuredChannel: z.string().trim().min(1),
  whoMobilized: z.string().trim().min(1),
  whatMobilized: z.string().trim().min(1),
  executiveSummary: z.string().trim().min(1),
});

const reportJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rankingItems: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          themeIndex: { type: "integer", minimum: 1, maximum: 5 },
          explanation: { type: "string", maxLength: 500 },
          representativeId: { type: "string" },
        },
        required: ["themeIndex", "explanation", "representativeId"],
      },
    },
    whatTheySay: { type: "string", maxLength: 600 },
    featuredChannel: { type: "string", maxLength: 600 },
    whoMobilized: { type: "string", maxLength: 600 },
    whatMobilized: { type: "string", maxLength: 600 },
    executiveSummary: { type: "string", maxLength: 600 },
  },
  required: [
    "rankingItems",
    "whatTheySay",
    "featuredChannel",
    "whoMobilized",
    "whatMobilized",
    "executiveSummary",
  ],
};

function plainText(value: string) {
  return value
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\*\*(.*?)\*\*:?\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function fitToLimit(value: string, limit: number) {
  const clean = plainText(value);
  if (clean.length <= limit) return clean;
  const slice = clean.slice(0, Math.max(1, limit - 1));
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (sentenceEnd >= Math.floor(limit * 0.55)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const wordEnd = slice.lastIndexOf(" ");
  return `${slice.slice(0, wordEnd > 0 ? wordEnd : slice.length).trim()}…`;
}

function percentage(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value);
}

function rankingContent(
  summary: z.infer<typeof summarySchema>,
  items: z.infer<typeof generatedSchema>["rankingItems"],
) {
  if (!summary.themes.length) {
    return "Informação não identificada nos dados fornecidos.";
  }
  const itemByTheme = new Map(
    items.map((item) => [item.themeIndex, item]),
  );

  return normalizeQualitativeRanking(
    summary.themes
      .map((theme, index) => {
        const item = itemByTheme.get(index + 1);
        const explanation = fitToLimit(
          item?.explanation ||
            `As postagens apresentam este argumento relacionado ao assunto analisado.`,
          350,
        );
        const representative =
          theme.candidates.find(
            (candidate) => candidate.id === item?.representativeId,
          ) || theme.candidates[0];
        const quote =
          representative?.text ||
          "Informação não identificada nos dados fornecidos.";
        const occurrences = theme.count === 1 ? "ocorrência" : "ocorrências";
        return `**${index + 1} - ${theme.name.toLocaleUpperCase("pt-BR")} | ${theme.count} ${occurrences} (${percentage(theme.percentage)}%)**\n${explanation}\n\n**Postagem representativa:**\n"${quote}"`;
      })
      .join("\n\n"),
  );
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const generated = await generateText({
      instructions: ANALYSIS_SYSTEM_INSTRUCTIONS,
      input: buildReportPrompt(body),
      purpose: "quality",
      jsonSchema: {
        name: "relatorio_consolidado",
        schema: reportJsonSchema,
      },
      maxCompletionTokens: 4_000,
      signal: request.signal,
    });
    const result = generatedSchema.parse(JSON.parse(generated.text));
    const sections = {
      qualitative: rankingContent(body.summary, result.rankingItems),
      whatTheySay: fitToLimit(result.whatTheySay, 400),
      featuredChannel: fitToLimit(result.featuredChannel, 400),
      whoMobilized: fitToLimit(result.whoMobilized, 400),
      whatMobilized: fitToLimit(result.whatMobilized, 400),
      executiveSummary: fitToLimit(result.executiveSummary, 400),
    };

    return Response.json(
      { sections, model: generated.model },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "A Groq retornou um relatório inválido. Tente novamente." },
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
            : "Não foi possível gerar o relatório consolidado.",
      },
      { status: 500 },
    );
  }
}
