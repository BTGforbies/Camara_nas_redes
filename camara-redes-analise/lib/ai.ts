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

function apiError(status: number) {
  if (status === 401 || status === 403) {
    return "A chave da API Grok foi recusada. Confira o arquivo .env.local.";
  }
  if (status === 429) {
    return "O limite da API Grok foi atingido. Aguarde alguns instantes e tente novamente.";
  }
  if (status >= 500) {
    return "O serviço Grok está indisponível no momento. Tente novamente.";
  }
  return "Não foi possível concluir a geração com o Grok.";
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
        reasoning: { effort: "medium" },
        store: false,
      }),
      signal: requestSignal,
    });
    if (!response.ok) throw new Error(apiError(response.status));
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
