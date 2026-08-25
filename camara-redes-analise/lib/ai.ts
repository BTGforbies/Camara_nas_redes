import OpenAI from "openai";

import type { AiProvider } from "@/lib/types";

export interface ProviderAvailability {
  id: AiProvider;
  label: string;
  configured: boolean;
  model: string;
}

interface GenerateTextOptions {
  provider: AiProvider;
  instructions: string;
  input: string;
  signal?: AbortSignal;
}

function configFor(provider: AiProvider) {
  if (provider === "xai") {
    return {
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
      model: process.env.XAI_MODEL || "grok-4.6",
      label: "Grok / xAI",
    };
  }

  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: undefined,
    model: process.env.OPENAI_MODEL || "gpt-5.6",
    label: "OpenAI",
  };
}

export function getProviderAvailability(): ProviderAvailability[] {
  return (["xai", "openai"] as const).map((id) => {
    const config = configFor(id);
    return {
      id,
      label: config.label,
      configured: Boolean(config.apiKey),
      model: config.model,
    };
  });
}

function errorMessage(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) {
      return "A chave da API foi recusada. Confira o arquivo .env.local.";
    }
    if (error.status === 429) {
      return "O limite da API foi atingido. Aguarde alguns instantes e tente novamente.";
    }
    if (error.status && error.status >= 500) {
      return "O serviço de IA está indisponível no momento. Tente novamente.";
    }
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "A geração foi cancelada.";
  }
  return "Não foi possível concluir a geração. Tente novamente sem apagar seus dados.";
}

export async function generateText({
  provider,
  instructions,
  input,
  signal,
}: GenerateTextOptions) {
  const config = configFor(provider);
  if (!config.apiKey) {
    throw new Error(
      provider === "xai"
        ? "Configure XAI_API_KEY no arquivo .env.local."
        : "Configure OPENAI_API_KEY no arquivo .env.local.",
    );
  }

  const timeout = Number(process.env.AI_REQUEST_TIMEOUT_MS || 240_000);
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: Number.isFinite(timeout) ? timeout : 240_000,
    maxRetries: 2,
  });

  try {
    const response = await client.responses.create(
      {
        model: config.model,
        input: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
        reasoning: { effort: "medium" },
        store: false,
      },
      { signal },
    );

    const text = response.output_text?.trim();
    if (!text) {
      throw new Error("A IA retornou uma resposta vazia.");
    }

    return { text, model: config.model };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Configure ")) {
      throw error;
    }
    throw new Error(errorMessage(error));
  }
}

