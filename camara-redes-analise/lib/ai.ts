export interface GrokAvailability {
  configured: boolean;
  model: string;
}

interface GenerateTextOptions {
  instructions: string;
  input: string;
  signal?: AbortSignal;
}

function grokConfig() {
  return {
    apiKey: process.env.XAI_API_KEY,
    model: process.env.XAI_MODEL || "grok-4.6",
  };
}

export function getGrokAvailability(): GrokAvailability {
  const config = grokConfig();
  return { configured: Boolean(config.apiKey), model: config.model };
}

function sanitizeUpstreamMessage(value: string) {
  return value
    .replace(/xai-[A-Za-z0-9_-]+/g, "[chave ocultada]")
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
    return "A chave da API Grok foi recusada. Confira o arquivo .env.local.";
  }
  if (status === 403) {
    return detail
      ? `A xAI bloqueou o acesso: ${detail}`
      : "A chave foi reconhecida, mas a equipe xAI não tem crédito ou permissão para usar a API.";
  }
  if (status === 400) {
    return detail
      ? `A xAI recusou a solicitação: ${detail}`
      : "A xAI recusou o formato da solicitação.";
  }
  if (status === 429) {
    return "O limite da API Grok foi atingido. Aguarde alguns instantes e tente novamente.";
  }
  if (status >= 500) {
    return "O serviço Grok está indisponível no momento. Tente novamente.";
  }
  return detail || "Não foi possível concluir a geração com o Grok.";
}

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => String(item.text))
    .join("\n")
    .trim();
}

export async function generateText({ instructions, input, signal }: GenerateTextOptions) {
  const config = grokConfig();
  if (!config.apiKey) throw new Error("Configure XAI_API_KEY no arquivo .env.local.");
  const timeout = Number(process.env.AI_REQUEST_TIMEOUT_MS || 240_000);
  const timeoutSignal = AbortSignal.timeout(Number.isFinite(timeout) ? timeout : 240_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  try {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
      }),
      signal: requestSignal,
    });
    if (!response.ok) {
      throw new Error(
        apiError(response.status, await upstreamErrorMessage(response)),
      );
    }
    const text = outputText(await response.json());
    if (!text) throw new Error("O Grok retornou uma resposta vazia.");
    return { text, model: config.model };
  } catch (error) {
    if (error instanceof Error && (error.message.includes("Configure ") || error.message.includes("Grok"))) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("A geração foi cancelada ou excedeu o tempo limite.");
    }
    throw new Error("Não foi possível concluir a geração com o Grok. Tente novamente.");
  }
}
