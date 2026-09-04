import { z } from "zod";

import { inspectSource } from "@/lib/source-context";

const sourceSchema = z.object({
  url: z.string().trim().url().max(2_048),
  title: z.string().trim().max(180).optional(),
  occurrences: z.number().int().positive().max(100_000),
});

const requestSchema = z.object({
  sources: z.array(sourceSchema).max(12),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const contexts = [];
    for (let index = 0; index < body.sources.length; index += 4) {
      contexts.push(
        ...(await Promise.all(body.sources.slice(index, index + 4).map(inspectSource))),
      );
    }
    return Response.json(
      { contexts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "Os links enviados para consulta são inválidos." },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Não foi possível consultar os links públicos." },
      { status: 500 },
    );
  }
}
