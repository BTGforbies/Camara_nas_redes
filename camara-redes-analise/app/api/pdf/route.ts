import { z } from "zod";

import { generateReportPdf, reportFileName } from "@/lib/pdf";

const pdfSchema = z.object({
  projectName: z.string().trim().min(1).max(240),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(240),
        content: z.string().trim().min(1).max(120_000),
      }),
    )
    .min(1)
    .max(5),
});

export async function POST(request: Request) {
  try {
    const input = pdfSchema.parse(await request.json());
    const bytes = await generateReportPdf(input);
    const fileName = reportFileName(input.projectName);

    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);

    return new Response(body.buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Os resultados enviados para o PDF são inválidos." },
        { status: 400 },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível criar o PDF.",
      },
      { status: 500 },
    );
  }
}
