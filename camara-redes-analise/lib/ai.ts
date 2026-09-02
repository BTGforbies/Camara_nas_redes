export interface AiAvailability {
  configured: boolean;
  model: string;
  bulkModel: string;
  qualityModel: string;
}

export type AiPurpose = "bulk" | "quality";

interface JsonSchemaOption {
  name: string;
  schema: Record<string, unknown>;
}

interface GenerateTextOptions {
  instructions: string;
  input: string;
  purpose?: AiPurpose;
  jsonSchema?: JsonSchemaOption;
  maxCompletionTokens?: number;
  signal?: AbortSignal;
}

interface GroqPayload {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: unknown;
    };
  }>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "ProviderError";
  }
}

function aiConfig() {
  return {
    apiKey: process.env.GROQ_API_KEY,
    bulkModel: process.env.GROQ_BULK_MODEL || "openai/gpt-oss-20b",
    qualityModel: process.env.GROQ_QUALITY_MODEL || "openai/gpt-oss-120b",
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
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[chave ocultada]")
    .replace(/xai-[A-Za-z0-9_-]+/g, "[chave ocultada]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[chave ocultada]")
    .replace(/Bearer\s+\S+/gi, "Bearer [chave ocultada]")
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
    normalized.includes("invalid api key") ||
    normalized.includes("incorrect api key") ||
    normalized.includes("api_key_invalid")
  ) {
    return "A chave da Groq foi recusada. Confira GROQ_API_KEY no arquivo .env.local.";
  }
  if (status === 403) {
    return detail
      ? `A Groq bloqueou o acesso: ${detail}`
      : "A chave foi reconhecida, mas não possui permissão para o modelo configurado.";
  }
  if (status === 404) {
    return detail
      ? `O modelo da Groq não está disponível: ${detail}`
      : "O modelo configurado não está disponível para esta chave da Groq.";
  }
  if (status === 400 || status === 422) {
    return detail
      ? `A Groq recusou a solicitação: ${detail}`
      : "A Groq recusou o formato da solicitação.";
  }
  if (status === 413) {
    return "O lote ultrapassou o tamanho aceito pela Groq e será dividido automaticamente.";
  }
  if (status === 429) {
    return "O limite temporário da Groq foi atingido. Aguarde alguns instantes e tente novamente.";
  }
  if (status >= 500) {
    return "O serviço da Groq está indisponível no momento. Tente novamente.";
  }
  return detail || "Não foi possível concluir a geração com a Groq.";
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

function outputText(payload: GroqPayload) {
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

export async function generateText({
  instructions,
  input,
  purpose = "quality",
  jsonSchema,
  maxCompletionTokens,
  signal,
}: GenerateTextOptions) {
  const config = aiConfig();
  if (!config.apiKey) {
    throw new ProviderError("Configure GROQ_API_KEY no arquivo .env.local.");
  }

  const model = purpose === "bulk" ? config.bulkModel : config.qualityModel;
  const timeout = Number(process.env.AI_REQUEST_TIMEOUT_MS || 180_000);
  const timeoutSignal = AbortSignal.timeout(
    Number.isFinite(timeout) ? timeout : 180_000,
  );
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  const configuredMaxTokens = Number(
    process.env.AI_MAX_COMPLETION_TOKENS || 5_000,
  );
  const completionTokens = Math.min(
    Math.max(maxCompletionTokens || configuredMaxTokens, 256),
    Number.isFinite(configuredMaxTokens) ? configuredMaxTokens : 5_000,
  );
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: input },
    ],
    temperature: 0.2,
    max_completion_tokens: completionTokens,
    include_reasoning: false,
    reasoning_effort: purpose === "bulk" ? "low" : "medium",
    stream: false,
    ...(jsonSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: jsonSchema.name,
              strict: true,
              schema: jsonSchema.schema,
            },
          },
        }
      : {}),
  });
  const maxRequestBytes = Number(process.env.AI_MAX_REQUEST_BYTES || 250_000);
  if (
    Number.isFinite(maxRequestBytes) &&
    new TextEncoder().encode(body).byteLength > maxRequestBytes
  ) {
    throw new ProviderError(
      "O lote local ultrapassou o limite seguro e precisa ser dividido.",
      413,
    );
  }

  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: requestSignal,
      });

      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === 3) break;
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay(response as Response, attempt)),
      );
    }

    if (!response) throw new ProviderError("A Groq não respondeu.");
    if (!response.ok) {
      throw new ProviderError(
        apiError(response.status, await upstreamErrorMessage(response)),
        response.status,
      );
    }

    const payload = (await response.json()) as GroqPayload;
    const text = outputText(payload);
    if (!text) {
      const reason = payload.choices?.[0]?.finish_reason;
      throw new ProviderError(
        reason
          ? `A Groq não retornou texto (${sanitizeUpstreamMessage(reason)}).`
          : "A Groq retornou uma resposta vazia.",
      );
    }
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
      "Não foi possível concluir a geração com a Groq. Tente novamente.",
    );
  }
}
