import { getAiAvailability } from "@/lib/ai";

export async function GET() {
  return Response.json({
    ai: getAiAvailability(),
    limits: {
      maxFileMb: Number(process.env.NEXT_PUBLIC_MAX_FILE_MB || 25),
      maxContextCharacters: Number(
        process.env.NEXT_PUBLIC_MAX_CONTEXT_CHARS || 2_000_000,
      ),
    },
  });
}
