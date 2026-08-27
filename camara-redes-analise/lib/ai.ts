export interface AiAvailability {
  configured: boolean;
  model: string;
}

interface GenerateTextOptions {
  instructions: string;
  input: string;
  signal?: AbortSignal;
}

class ProviderError extends Error {}

function aiConfig() {
  return {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || "groq/compound",
  };
}

export function getAiAvailability(): AiAvailability {
  const config = aiConfig();
  return { configured: Boolean(config.apiKey), model: config.model };
}

function sanitizeUpstreamMessage(value: string) {
  return value
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
  if (status === 401) {
    return "A chave da API de IA foi recusada. Confira GROQ_API_KEY no arquivo .env.local.";
  }
  if (status === 403) {
    return detail
      ? `O provedor de IA bloqueou o acesso: ${detail}`
      : "A chave foi reconhecida, mas não possui permissão para utilizar o modelo configurado.";
  }
  if (status === 400) {
    return detail
      ? `O provedor de IA recusou a solicitação: ${detail}`
      : "O provedor de IA recusou o formato da solicitação.";
  }
  if (status === 429) {
    return "O limite gratuito da API foi atingido. Aguarde alguns instantes e tente novamente.";
  }
  if (status >= 500) {
    return "O serviço de IA está indisponível no momento. Tente novamente.";
  }
  return detail || "Não foi possível concluir a geração com a IA.";
}

function retryDelay(response: Response) {
  const value = Number(response.headers.get("retry-after") || 0);
  return Math.min(Math.max(Number.isFinite(value) ? value * 1_000 : 0, 1_000), 15_000);
}

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = response.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

export async function generateText({ instructions, input, signal }: GenerateTextOptions) {
  const config = aiConfig();
  if (!config.apiKey) {
    throw new ProviderError("Configure GROQ_API_KEY no arquivo .env.local.");
  }
  const timeout = Number(process.env.AI_REQUEST_TIMEOUT_MS || 240_000);
  const timeoutSignal = AbortSignal.timeout(Number.isFinite(timeout) ? timeout : 240_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: input },
          ],
          temperature: 0.2,
        }),
        signal: requestSignal,
      });
      if (response.status !== 429 || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response)));
    }
    if (!response) throw new ProviderError("O provedor de IA não respondeu.");
    if (!response.ok) {
      throw new ProviderError(
        apiError(response.status, await upstreamErrorMessage(response)),
      );
    }
    const text = outputText(await response.json());
    if (!text) throw new ProviderError("A IA retornou uma resposta vazia.");
    return { text, model: config.model };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error("A geração foi cancelada ou excedeu o tempo limite.");
    }
    throw new Error("Não foi possível concluir a geração com a IA. Tente novamente.");
  }
}
