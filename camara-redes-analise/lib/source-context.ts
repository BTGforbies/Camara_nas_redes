import type { SourceContext, SourceReference } from "@/lib/types";

const MAX_SOURCE_BYTES = 300_000;
const MAX_REDIRECTS = 3;
const SOURCE_TIMEOUT_MS = 8_000;

function compact(value: string, limit: number) {
  const clean = value.replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trim()}…`;
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const hexadecimal = code[1]?.toLowerCase() === "x";
      const number = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function attribute(tag: string, name: string) {
  const expression = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(expression);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function metaContent(html: string, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "property") || attribute(tag, "name")).toLowerCase();
    if (wanted.has(key)) return attribute(tag, "content");
  }
  return "";
}

function stripHtml(html: string) {
  return decodeHtml(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function pageDetails(html: string, fallbackTitle: string) {
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = compact(
    metaContent(html, ["og:title", "twitter:title"]) ||
      decodeHtml(titleTag) ||
      fallbackTitle,
    180,
  );
  const description = compact(
    metaContent(html, ["og:description", "twitter:description", "description"]),
    400,
  );
  const excerpt = compact(stripHtml(html), 1_200);
  return { title, description, excerpt };
}

export function safePublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Link inválido.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Somente links HTTP ou HTTPS são aceitos.");
  }
  if (url.username || url.password) {
    throw new Error("Links com credenciais não são aceitos.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("A porta do link não é pública.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host.includes(".") ||
    host.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".onion")
  ) {
    throw new Error("O link não aponta para um domínio público permitido.");
  }

  url.hash = "";
  return url;
}

async function readLimitedText(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = "";

  while (received < MAX_SOURCE_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = MAX_SOURCE_BYTES - received;
    const selected = value.byteLength > remaining ? value.slice(0, remaining) : value;
    received += selected.byteLength;
    result += decoder.decode(selected, { stream: received < MAX_SOURCE_BYTES });
    if (value.byteLength > remaining) {
      await reader.cancel();
      break;
    }
  }
  result += decoder.decode();
  return result;
}

async function fetchSource(start: URL, signal: AbortSignal) {
  let current = start;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        Accept: "text/html,text/plain;q=0.9",
        "User-Agent": "CamaraNasRedes/1.0 (contexto de fonte publica)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) {
        throw new Error("Redirecionamento inválido.");
      }
      current = safePublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Fonte respondeu com HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error("O link não contém uma página de texto.");
    }
    return { response, finalUrl: current };
  }
  throw new Error("Muitos redirecionamentos.");
}

export async function inspectSource(source: SourceReference): Promise<SourceContext> {
  let url: URL;
  try {
    url = safePublicUrl(source.url);
  } catch {
    return {
      domain: "Link inválido",
      title: compact(source.title || "Fonte não identificada", 180),
      description: "",
      excerpt: "",
      occurrences: source.occurrences,
      available: false,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const { response, finalUrl } = await fetchSource(url, controller.signal);
    const html = await readLimitedText(response);
    const details = pageDetails(html, source.title || "");
    return {
      domain: finalUrl.hostname,
      title: details.title || compact(source.title || finalUrl.hostname, 180),
      description: details.description,
      excerpt: details.excerpt,
      occurrences: source.occurrences,
      available: Boolean(details.title || details.description || details.excerpt),
    };
  } catch {
    return {
      domain: url.hostname,
      title: compact(source.title || url.hostname, 180),
      description: "",
      excerpt: "",
      occurrences: source.occurrences,
      available: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}
