import { getAiAvailability } from "@/lib/ai";
import {
  DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
  MIN_ANALYSIS_CHUNK_CHARACTERS,
} from "@/lib/workbook";

function safeChunkCharacters() {
  const configured = Number(
    process.env.NEXT_PUBLIC_AI_CHUNK_CHARS ||
      DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
  );
  if (!Number.isFinite(configured)) return DEFAULT_ANALYSIS_CHUNK_CHARACTERS;
  return Math.min(
    Math.max(configured, MIN_ANALYSIS_CHUNK_CHARACTERS),
    DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
  );
}

export async function GET() {
  return Response.json({
    ai: getAiAvailability(),
    limits: {
      maxFileMb: Number(process.env.NEXT_PUBLIC_MAX_FILE_MB || 25),
      maxContextCharacters: Number(
        process.env.NEXT_PUBLIC_MAX_CONTEXT_CHARS || 2_000_000,
      ),
      maxChunkCharacters: safeChunkCharacters(),
    },
  });
}
