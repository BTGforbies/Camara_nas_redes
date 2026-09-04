import type {
  AnalysisRecord,
  AnalysisSummary,
  ClassifiedRecord,
  NamedAggregate,
  ProjectContext,
  SourceReference,
  WorkbookPayload,
} from "@/lib/types";
import {
  DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
  MIN_ANALYSIS_CHUNK_CHARACTERS,
} from "@/lib/workbook";

const MAX_CLASSIFICATION_TEXT_CHARACTERS = 900;
const MAX_RECORDS_PER_BATCH = 20;
const COMPACTION_MARKER = " … [trecho compactado] … ";

export interface LocalAnalysisRow extends AnalysisRecord {
  author: string;
  channel: string;
  engagement: number;
  duplicate: boolean;
  corrupted: boolean;
}

export interface PreparedWorkbookAnalysis {
  rows: LocalAnalysisRow[];
  records: AnalysisRecord[];
  sources: SourceReference[];
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactText(value: string, limit: number) {
  const clean = value.replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const available = Math.max(20, limit - COMPACTION_MARKER.length);
  const beginning = Math.ceil(available * 0.72);
  const ending = available - beginning;
  return `${clean.slice(0, beginning).trimEnd()}${COMPACTION_MARKER}${clean.slice(-ending).trimStart()}`;
}

export function redactSensitiveText(value: string) {
  return value
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link removido]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail removido]")
    .replace(/@[A-Za-z0-9_.-]{2,}/g, "[perfil removido]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento removido]")
    .replace(
      /(^|\D)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2}\)?[ .-]?)?\d{4,5}[ .-]?\d{4}(?!\d)/g,
      "$1[telefone removido]",
    );
}

function safeLabel(value: string, fallback: string) {
  return compactText(redactSensitiveText(value), 120) || fallback;
}

function fallbackText(values: string[], ignoredIndexes: Set<number>) {
  return values.reduce((selected, value, index) => {
    if (ignoredIndexes.has(index)) return selected;
    return value.length > selected.length ? value : selected;
  }, "");
}

function normalizedPublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith('utm_') ||
        ['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid'].includes(
          key.toLowerCase(),
        )
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function extractPublicUrls(value: string) {
  const matches = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const unique = new Set<string>();
  for (const match of matches) {
    const clean = match.replace(/[),.;!?]+$/g, '');
    const normalized = normalizedPublicUrl(clean);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export function mergeSourceReferences(
  ...groups: SourceReference[][]
): SourceReference[] {
  const sources = new Map<string, SourceReference>();
  for (const group of groups) {
    for (const source of group) {
      const url = normalizedPublicUrl(source.url);
      if (!url) continue;
      const current = sources.get(url) ?? {
        url,
        title: source.title?.trim() || undefined,
        occurrences: 0,
      };
      current.occurrences += Math.max(1, source.occurrences || 1);
      if (!current.title && source.title?.trim()) {
        current.title = compactText(source.title, 180);
      }
      sources.set(url, current);
    }
  }
  return [...sources.values()].sort(
    (left, right) =>
      right.occurrences - left.occurrences || left.url.localeCompare(right.url),
  );
}

export function sourceReferencesFromText(value: string): SourceReference[] {
  return extractPublicUrls(value).map((url) => ({
    url,
    occurrences: 1,
  }));
}

export function parseEngagement(value: string) {
  const clean = value.trim().replace(/[^0-9,.-]/g, "");
  if (!clean) return 0;

  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let normalized = clean;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = clean.split(thousandsSeparator).join("");
    if (decimalSeparator === ",") normalized = normalized.replace(",", ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const fractionLength = clean.length - clean.lastIndexOf(separator) - 1;
    normalized =
      fractionLength === 3
        ? clean.split(separator).join("")
        : clean.replace(separator, ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function prepareWorkbookAnalysis(
  workbook: WorkbookPayload,
): PreparedWorkbookAnalysis {
  const rows: LocalAnalysisRow[] = [];
  const sourceReferences: SourceReference[] = [];
  let recordNumber = 0;

  for (const sheet of workbook.sheets) {
    const authorIndex = sheet.detectedColumns.author
      ? sheet.headers.indexOf(sheet.detectedColumns.author)
      : -1;
    const textIndex = sheet.detectedColumns.text
      ? sheet.headers.indexOf(sheet.detectedColumns.text)
      : -1;
    const channelIndex = sheet.detectedColumns.channel
      ? sheet.headers.indexOf(sheet.detectedColumns.channel)
      : -1;
    const engagementIndex = sheet.detectedColumns.engagement
      ? sheet.headers.indexOf(sheet.detectedColumns.engagement)
      : -1;
    const linkIndex = sheet.detectedColumns.link
      ? sheet.headers.indexOf(sheet.detectedColumns.link)
      : -1;
    const titleIndex = sheet.detectedColumns.title
      ? sheet.headers.indexOf(sheet.detectedColumns.title)
      : -1;

    for (const row of sheet.rows) {
      recordNumber += 1;
      const ignoredIndexes = new Set(
        [authorIndex, channelIndex, engagementIndex, linkIndex].filter(
          (index) => index >= 0,
        ),
      );
      const originalText =
        textIndex >= 0
          ? row.values[textIndex] || ""
          : fallbackText(row.values, ignoredIndexes);
      const text = compactText(
        redactSensitiveText(originalText),
        MAX_CLASSIFICATION_TEXT_CHARACTERS,
      );
      const corrupted = Boolean(row.corrupted) || !text;
      const duplicate = !corrupted && Boolean(row.duplicateOf);
      const sourceTitle =
        titleIndex >= 0 ? compactText(row.values[titleIndex] || '', 180) : '';
      const rowLinks = new Set([
        ...extractPublicUrls(originalText),
        ...(linkIndex >= 0 ? extractPublicUrls(row.values[linkIndex] || '') : []),
      ]);
      for (const url of rowLinks) {
        sourceReferences.push({
          url,
          title: sourceTitle || undefined,
          occurrences: 1,
        });
      }

      rows.push({
        id: `P${String(recordNumber).padStart(6, "0")}`,
        text,
        author: safeLabel(
          authorIndex >= 0 ? row.values[authorIndex] || "" : "",
          "Autor não identificado",
        ),
        channel: safeLabel(
          channelIndex >= 0 ? row.values[channelIndex] || "" : "",
          "Canal não identificado",
        ),
        engagement:
          engagementIndex >= 0
            ? parseEngagement(row.values[engagementIndex] || "")
            : 0,
        duplicate,
        corrupted,
      });
    }
  }

  return {
    rows,
    records: rows
      .filter((row) => !row.corrupted && !row.duplicate)
      .map(({ id, text }) => ({ id, text })),
    sources: mergeSourceReferences(sourceReferences),
  };
}

export function buildClassificationBatches(
  records: AnalysisRecord[],
  maxCharacters = DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
) {
  if (
    !Number.isFinite(maxCharacters) ||
    maxCharacters < MIN_ANALYSIS_CHUNK_CHARACTERS
  ) {
    throw new Error("O limite de cada lote da classificação é inválido.");
  }

  const batches: AnalysisRecord[][] = [];
  let current: AnalysisRecord[] = [];

  for (const record of records) {
    const candidate = [...current, record];
    const candidateSize = JSON.stringify(candidate).length;
    if (
      current.length &&
      (candidateSize > maxCharacters || current.length >= MAX_RECORDS_PER_BATCH)
    ) {
      batches.push(current);
      current = [record];
    } else {
      current = candidate;
    }
  }

  if (current.length) batches.push(current);
  return batches;
}

export function knownThemeNames(
  classifications: ClassifiedRecord[],
  limit = 80,
) {
  const themes = new Map<string, string>();
  for (const item of classifications) {
    for (const theme of item.themes) {
      const clean = compactText(theme, 48).replace(/[|*_#]/g, "").trim();
      const key = normalizeKey(clean);
      if (key && !themes.has(key)) themes.set(key, clean);
      if (themes.size >= limit) return [...themes.values()];
    }
  }
  return [...themes.values()];
}

function incrementAggregate(
  values: Map<string, NamedAggregate>,
  name: string,
  engagement: number,
) {
  const key = normalizeKey(name) || "nao identificado";
  const current = values.get(key) ?? { name, posts: 0, engagement: 0 };
  current.posts += 1;
  current.engagement += engagement;
  values.set(key, current);
}

function sortedAggregates(values: Map<string, NamedAggregate>) {
  return [...values.values()]
    .sort(
      (left, right) =>
        right.engagement - left.engagement ||
        right.posts - left.posts ||
        left.name.localeCompare(right.name, "pt-BR"),
    )
    .slice(0, 10);
}

export function aggregateAnalysis(
  prepared: PreparedWorkbookAnalysis,
  classifications: ClassifiedRecord[],
): AnalysisSummary {
  const classificationById = new Map(
    classifications.map((item) => [item.id, item]),
  );
  const missing = prepared.records.filter(
    (record) => !classificationById.has(record.id),
  );
  if (missing.length) {
    throw new Error(
      `A classificação não retornou ${missing.length} postagem(ns). Tente novamente.`,
    );
  }

  const repeated = prepared.rows.filter((row) => row.duplicate).length;
  const corrupted = prepared.rows.filter((row) => row.corrupted).length;
  const relevantRows: LocalAnalysisRow[] = [];
  let offTopic = 0;
  const stances = { POSITIVO: 0, NEGATIVO: 0, NEUTRO: 0 };
  const themeMap = new Map<
    string,
    { name: string; count: number; candidates: Map<string, string> }
  >();

  for (const row of prepared.rows) {
    if (row.corrupted || row.duplicate) continue;
    const classification = classificationById.get(row.id);
    if (!classification) continue;
    if (classification.status === "OFFTOPIC") {
      offTopic += 1;
      continue;
    }

    relevantRows.push(row);
    stances[classification.stance] += 1;
    const uniqueThemes = new Set(
      (classification.themes.length
        ? classification.themes
        : ["Opinião geral sobre o assunto"]
      ).map((theme) => compactText(theme, 48).replace(/[|*_#]/g, "").trim()),
    );
    for (const name of uniqueThemes) {
      const key = normalizeKey(name);
      if (!key) continue;
      const current = themeMap.get(key) ?? {
        name,
        count: 0,
        candidates: new Map<string, string>(),
      };
      current.count += 1;
      if (
        row.text &&
        ![...current.candidates.values()].includes(row.text)
      ) {
        current.candidates.set(row.id, row.text);
      }
      themeMap.set(key, current);
    }
  }

  const relevant = relevantRows.length;
  const allThemes = [...themeMap.values()].sort(
    (left, right) =>
      right.count - left.count || left.name.localeCompare(right.name, "pt-BR"),
  );
  const topThemes = allThemes.slice(0, 5).map((theme) => ({
    name: theme.name,
    count: theme.count,
    percentage: relevant ? (theme.count / relevant) * 100 : 0,
    candidates: [...theme.candidates.entries()]
      .map(([id, text]) => ({ id, text }))
      .sort((left, right) => right.text.length - left.text.length)
      .slice(0, 3),
  }));
  const otherThemeOccurrences = allThemes
    .slice(5)
    .reduce((total, theme) => total + theme.count, 0);

  const channels = new Map<string, NamedAggregate>();
  const authors = new Map<string, NamedAggregate>();
  for (const row of relevantRows) {
    incrementAggregate(channels, row.channel, row.engagement);
    incrementAggregate(authors, row.author, row.engagement);
  }

  return {
    metrics: {
      totalGross: prepared.rows.length,
      analyzed: prepared.rows.length,
      offTopic,
      repeated,
      corrupted,
      relevant,
    },
    stances,
    themes: topThemes,
    argumentOverview: allThemes.map((theme) => ({
      name: theme.name,
      count: theme.count,
      percentage: relevant ? (theme.count / relevant) * 100 : 0,
    })),
    otherThemeOccurrences,
    channels: sortedAggregates(channels),
    authors: sortedAggregates(authors),
  };
}

function formatPercentage(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value);
}

function tableValue(value: string) {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
}

export function renderAutomaticTables(summary: AnalysisSummary) {
  const { metrics } = summary;
  const themeRows = summary.themes.map(
    (theme) =>
      `| ${tableValue(theme.name)} | ${theme.count} | ${formatPercentage(theme.percentage)}% |`,
  );
  const otherPercentage = metrics.relevant
    ? (summary.otherThemeOccurrences / metrics.relevant) * 100
    : 0;
  themeRows.push(
    `| **Outras opiniões sobre o assunto** | **${summary.otherThemeOccurrences}** | **${formatPercentage(otherPercentage)}%** |`,
  );

  return `### Métricas
| Métrica | Valor |
|---|---:|
| Total bruto de postagens do arquivo | ${metrics.totalGross} |
| Total de postagens analisadas | ${metrics.analyzed} |
| Total OFFTOPIC | ${metrics.offTopic} |
| Total REPETIDO | ${metrics.repeated} |
| Total CORROMPIDA (sinalizada à parte) | ${metrics.corrupted} |
| **Total RELEVANTES (base de cálculo)** | **${metrics.relevant}** |

### Principais argumentos
| Argumento | Ocorrências | Percentual (%) |
|---|---:|---:|
${themeRows.join("\n")}`;
}

export function compactProjectForAi(project: ProjectContext) {
  return {
    projectName: compactText(project.projectName, 240),
    progressSheet: compactText(project.progressSheet, 800),
    situation: compactText(project.situation, 800),
    subject: compactText(project.subject, 1_000),
    context: compactText(project.context, 1_500),
    engagementByChannel: compactText(project.engagementByChannel, 2_000),
  };
}
