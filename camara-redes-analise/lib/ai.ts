export interface AiAvailability {
  configured: boolean;
  model: string;
  bulkModel: string;
  qualityModel: string;
}

export type AiPurpose = "bulk" | "quality";

interface GenerateTextOptions {
  instructions: string;
  input: string;
  purpose?: AiPurpose;
  signal?: AbortSignal;
}

interface GeminiPayload {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown; thought?: boolean }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
  };
}

export class ProviderError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "ProviderError";
  }
}

function aiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY,
    bulkModel:
      process.env.GEMINI_BULK_MODEL || "gemini-3.5-flash-lite",
    qualityModel:
      process.env.GEMINI_QUALITY_MODEL || "gemini-3.6-flash",
  };
}

export function getAiAvailability(): AiAvailability {
  const config = aiConfig();
  return {
    configured: Boolean(config.apiKey),
    model: config.qualityModel,
    bulkModel: config.bulkModel,
    qualityModel: config.qualityModel,
  };
}

function sanitizeUpstreamMessage(value: string) {
  return value
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[chave ocultada]")
    .replace(/xai-[A-Za-z0-9_-]+/g, "[chave ocultada]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[chave ocultada]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function upstreamErrorMessage(response: Response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return "";
  try {
    const payload = JSON.parse(raw) as {
      error?: string | { message?: string };
      message?: string;
      detail?: string;
    };
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message || payload.message || payload.detail || "";
    return sanitizeUpstreamMessage(message);
  } catch {
    return sanitizeUpstreamMessage(raw);
  }
}

function apiError(status: number, detail: string) {
  const normalized = detail.toLowerCase();
  if (
    status === 401 ||
    normalized.includes("api key not valid") ||
    normalized.includes("api_key_invalid") ||
    normalized.includes("invalid api key")
  ) {
    return "A chave do Gemini foi recusada. Confira GEMINI_API_KEY no arquivo .env.local.";
  }
  if (status === 403) {
    return detail
      ? `O Gemini bloqueou o acesso: ${detail}`
      : "A chave foi reconhecida, mas não possui permissão ou faturamento ativo para utilizar o modelo configurado.";
  }
  if (status === 404) {
    return detail
      ? `O modelo configurado não está disponível: ${detail}`
      : "O modelo configurado não está disponível para esta chave do Gemini.";
  }
  if (status === 400) {
    return detail
      ? `O Gemini recusou a solicitação: ${detail}`
      : "O Gemini recusou o formato da solicitação.";
  }
  if (status === 429) {
    return "A cota ou o limite temporário do Gemini foi atingido. Aguarde alguns instantes e tente novamente.";
  }
  if (status === 413) {
    return "O lote ultrapassou a capacidade aceita pela API do Gemini.";
  }
  if (status >= 500) {
    return "O serviço do Gemini está indisponível no momento. Tente novamente.";
  }
  return detail || "Não foi possível concluir a geração com o Gemini.";
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  const exponential = 1_000 * 2 ** attempt;
  return Math.min(
    Math.max(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : exponential,
      1_000,
    ),
    30_000,
  );
}

function outputText(payload: GeminiPayload) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("")
    .trim();
}

function emptyResponseMessage(payload: GeminiPayload) {
  const reason =
    payload.promptFeedback?.blockReasonMessage ||
    payload.promptFeedback?.blockReason ||
    payload.candidates?.[0]?.finishReason;
  return reason
    ? `O Gemini não retornou texto (${sanitizeUpstreamMessage(reason)}).`
    : "O Gemini retornou uma resposta vazia.";
}

function thinkingLevel(purpose: AiPurpose) {
  const configured =
    purpose === "bulk"
      ? process.env.GEMINI_BULK_THINKING_LEVEL || "minimal"
      : process.env.GEMINI_QUALITY_THINKING_LEVEL || "low";
  return configured.toLowerCase();
}

export async function generateText({
  instructions,
  input,
  purpose = "quality",
  signal,
}: GenerateTextOptions) {
  const config = aiConfig();
  if (!config.apiKey) {
    throw new ProviderError("Configure GEMINI_API_KEY no arquivo .env.local.");
  }

  const model = purpose === "bulk" ? config.bulkModel : config.qualityModel;
  const timeout = Number(process.env.AI_REQUEST_TIMEOUT_MS || 240_000);
  const timeoutSignal = AbortSignal.timeout(
    Number.isFinite(timeout) ? timeout : 240_000,
  );
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: instructions }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: input }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: Number(
              process.env.AI_MAX_COMPLETION_TOKENS || 3_000,
            ),
            thinkingConfig: {
              thinkingLevel: thinkingLevel(purpose),
              includeThoughts: false,
            },
          },
        }),
        signal: requestSignal,
      });

      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === 3) break;
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay(response as Response, attempt)),
      );
    }

    if (!response) throw new ProviderError("O Gemini não respondeu.");
    if (!response.ok) {
      throw new ProviderError(
        apiError(response.status, await upstreamErrorMessage(response)),
        response.status,
      );
    }

    const payload = (await response.json()) as GeminiPayload;
    const text = outputText(payload);
    if (!text) throw new ProviderError(emptyResponseMessage(payload));
    return { text, model };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error("A geração foi cancelada ou excedeu o tempo limite.");
    }
    throw new Error(
      "Não foi possível concluir a geração com o Gemini. Tente novamente.",
    );
  }
}
