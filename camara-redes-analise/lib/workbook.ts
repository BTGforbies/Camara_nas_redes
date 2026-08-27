import * as XLSX from "xlsx";

import type {
  WorkbookPayload,
  WorkbookRow,
  WorkbookSheet,
} from "@/lib/types";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_CONTEXT_CHARACTERS = 2_000_000;
export const DEFAULT_ANALYSIS_CHUNK_CHARACTERS = 220_000;

const AUTHOR_ALIASES = [
  "author",
  "autor",
  "usuario",
  "user",
  "username",
  "perfil",
  "nome do autor",
];
const TEXT_ALIASES = [
  "text",
  "texto",
  "content",
  "conteudo",
  "post",
  "postagem",
  "comment",
  "comentario",
  "mensagem",
  "full text",
];
const CHANNEL_ALIASES = [
  "channel",
  "canal",
  "source",
  "fonte",
  "rede",
  "rede id",
  "page type",
  "plataforma",
];
const ENGAGEMENT_ALIASES = [
  "engagement score",
  "engagement",
  "engajamento",
  "pontos de engajamento",
  "score",
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/[\t\r\n]+/g, " ").trim();
}

function ensureUniqueHeaders(values: unknown[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const raw = cleanCell(value) || `Coluna ${XLSX.utils.encode_col(index)}`;
    const key = normalize(raw);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? raw : `${raw} (${count + 1})`;
  });
}

function findColumn(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalize);
  return headers.find((header) => {
    const candidate = normalize(header);
    return normalizedAliases.some(
      (alias) => candidate === alias || candidate.includes(alias),
    );
  });
}

function isEmptyRow(row: unknown[]) {
  return row.every((cell) => cleanCell(cell) === "");
}

function hasZipSignature(bytes: Uint8Array) {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(bytes[2]) &&
    [0x04, 0x06, 0x08].includes(bytes[3])
  );
}

function hasOleSignature(bytes: Uint8Array) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return signature.every((value, index) => bytes[index] === value);
}

function hasTextSignature(bytes: Uint8Array) {
  if (!bytes.length) return false;

  let invalidControlCharacters = 0;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(byte)) {
      invalidControlCharacters += 1;
    }
  }

  return invalidControlCharacters <= Math.max(2, bytes.length * 0.01);
}

export function validateWorkbookBytes(
  fileName: string,
  fileSize: number,
  buffer: ArrayBuffer,
  maxFileSize = DEFAULT_MAX_FILE_SIZE_BYTES,
) {
  const extension = fileName.toLowerCase().endsWith(".xlsx")
    ? ".xlsx"
    : fileName.toLowerCase().endsWith(".xls")
      ? ".xls"
      : fileName.toLowerCase().endsWith(".csv")
        ? ".csv"
        : null;

  if (!extension) {
    throw new Error(
      "Formato não permitido. Envie um arquivo .csv, .xlsx ou .xls.",
    );
  }
  if (fileSize === 0 || buffer.byteLength === 0) {
    throw new Error("O arquivo está vazio.");
  }
  if (fileSize > maxFileSize) {
    const limit = Math.round(maxFileSize / 1024 / 1024);
    throw new Error(`O arquivo ultrapassa o limite de ${limit} MB.`);
  }

  const bytes = new Uint8Array(
    buffer.slice(0, Math.min(buffer.byteLength, 8_192)),
  );
  const signatureIsValid =
    (extension === ".xlsx" && hasZipSignature(bytes)) ||
    (extension === ".xls" && hasOleSignature(bytes)) ||
    (extension === ".csv" && hasTextSignature(bytes));

  if (!signatureIsValid) {
    throw new Error(
      "A extensão não corresponde a um arquivo CSV ou Excel válido, ou o arquivo está corrompido.",
    );
  }

  return extension;
}

function sheetFromMatrix(name: string, matrix: unknown[][]): WorkbookSheet | null {
  const nonEmptyRows = matrix.filter((row) => !isEmptyRow(row));
  if (nonEmptyRows.length < 2) return null;

  const headers = ensureUniqueHeaders(nonEmptyRows[0]);
  const detectedColumns = {
    author: findColumn(headers, AUTHOR_ALIASES),
    text: findColumn(headers, TEXT_ALIASES),
    channel: findColumn(headers, CHANNEL_ALIASES),
    engagement: findColumn(headers, ENGAGEMENT_ALIASES),
  };

  const rows: WorkbookRow[] = nonEmptyRows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    values: headers.map((_, columnIndex) => cleanCell(row[columnIndex])),
  }));

  return { name, headers, rows, detectedColumns };
}

function annotateRows(sheets: WorkbookSheet[]) {
  const seen = new Map<string, string>();
  let duplicateCount = 0;
  let corruptedCount = 0;

  for (const sheet of sheets) {
    const authorIndex = sheet.detectedColumns.author
      ? sheet.headers.indexOf(sheet.detectedColumns.author)
      : -1;
    const textIndex = sheet.detectedColumns.text
      ? sheet.headers.indexOf(sheet.detectedColumns.text)
      : -1;
    const channelIndex = sheet.detectedColumns.channel
      ? sheet.headers.indexOf(sheet.detectedColumns.channel)
      : -1;

    for (const row of sheet.rows) {
      const author = authorIndex >= 0 ? row.values[authorIndex] : "";
      const text = textIndex >= 0 ? row.values[textIndex] : "";
      const channel = channelIndex >= 0 ? row.values[channelIndex] : "";
      const rowId = `${sheet.name}!${row.rowNumber}`;

      if (
        (authorIndex >= 0 && !author) ||
        (textIndex >= 0 && !text) ||
        (channelIndex >= 0 && !channel)
      ) {
        row.corrupted = true;
        corruptedCount += 1;
      }

      if (author && text) {
        const duplicateKey = `${normalize(author)}\u0000${normalize(text)}`;
        const original = seen.get(duplicateKey);
        if (original) {
          row.duplicateOf = original;
          duplicateCount += 1;
        } else {
          seen.set(duplicateKey, rowId);
        }
      }
    }
  }

  return { duplicateCount, corruptedCount };
}

function makeContextText(sheets: WorkbookSheet[]) {
  const blocks = sheets.map((sheet) => {
    const detectedHeaders = [
      sheet.detectedColumns.author,
      sheet.detectedColumns.text,
      sheet.detectedColumns.channel,
      sheet.detectedColumns.engagement,
    ].filter((header): header is string => Boolean(header));
    const selectedHeaders = sheet.detectedColumns.text
      ? [...new Set(detectedHeaders)]
      : sheet.headers;
    const selectedIndexes = selectedHeaders.map((header) =>
      sheet.headers.indexOf(header),
    );
    const lines = sheet.rows.map((row) => {
      const flags = [
        row.duplicateOf ? `REPETIDO DE ${row.duplicateOf}` : "",
        row.corrupted ? "POSSÍVEL LINHA CORROMPIDA" : "",
      ].filter(Boolean);
      const values = selectedIndexes.map((index) =>
        (row.values[index] ?? "").replace(/\|/g, "\\|"),
      );
      return `${sheet.name}!${row.rowNumber}${flags.length ? ` [${flags.join("; ")}]` : ""} | ${values.join(" | ")}`;
    });

    return [
      `PLANILHA: ${sheet.name}`,
      `COLUNAS: ${selectedHeaders.join(" | ")}`,
      ...lines,
    ].join("\n");
  });

  return blocks.join("\n\n");
}

export function splitWorkbookContext(
  contextText: string,
  maxChunkCharacters = DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
) {
  if (!Number.isFinite(maxChunkCharacters) || maxChunkCharacters < 10_000) {
    throw new Error("O limite de cada lote da análise é inválido.");
  }
  if (contextText.length <= maxChunkCharacters) return [contextText];

  const chunks: string[] = [];
  const current: string[] = [];
  let activeHeaders: string[] = [];
  let currentLength = 0;

  const pushLine = (line: string) => {
    current.push(line);
    currentLength += line.length + (current.length > 1 ? 1 : 0);
  };
  const flush = () => {
    const value = current.join("\n").trim();
    if (value) chunks.push(value);
    current.length = 0;
    currentLength = 0;
  };

  for (const line of contextText.split("\n")) {
    if (line.startsWith("PLANILHA: ")) {
      activeHeaders = [line];
    } else if (line.startsWith("COLUNAS: ")) {
      activeHeaders = [activeHeaders[0], line].filter(Boolean);
    }

    const continuationHeaders =
      current.length === 0 &&
      !line.startsWith("PLANILHA: ") &&
      !line.startsWith("COLUNAS: ")
        ? activeHeaders
        : [];
    const continuationLength = continuationHeaders.reduce(
      (total, header) => total + header.length + 1,
      0,
    );
    const projected =
      currentLength +
      continuationLength +
      line.length +
      (current.length || continuationHeaders.length ? 1 : 0);

    if (projected > maxChunkCharacters && current.length) {
      flush();
      for (const header of activeHeaders) pushLine(header);
    } else {
      for (const header of continuationHeaders) pushLine(header);
    }

    if (currentLength + line.length + (current.length ? 1 : 0) > maxChunkCharacters) {
      throw new Error(
        "Uma postagem isolada é grande demais para a análise. Reduza apenas essa célula antes de tentar novamente.",
      );
    }
    if (!current.length || current[current.length - 1] !== line) pushLine(line);
  }

  flush();
  return chunks;
}

export function parseWorkbookArrayBuffer(
  buffer: ArrayBuffer,
  metadata: { fileName: string; fileSize: number },
  options?: { maxFileSize?: number; maxContextCharacters?: number },
): WorkbookPayload {
  const extension = validateWorkbookBytes(
    metadata.fileName,
    metadata.fileSize,
    buffer,
    options?.maxFileSize,
  );

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      cellText: true,
      dense: true,
    });
  } catch {
    throw new Error("Não foi possível ler o arquivo. Ele pode estar corrompido.");
  }

  if (!workbook.SheetNames.length) {
    throw new Error("Nenhuma tabela foi encontrada no arquivo.");
  }

  const sheets = workbook.SheetNames.map((name) => {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
      dateNF: "yyyy-mm-dd",
    });
    return sheetFromMatrix(name, matrix);
  }).filter((sheet): sheet is WorkbookSheet => sheet !== null);

  if (!sheets.length) {
    throw new Error("Nenhum dado utilizável foi encontrado nas tabelas.");
  }

  const { duplicateCount, corruptedCount } = annotateRows(sheets);
  const warnings: string[] = [];
  const ignoredSheets = workbook.SheetNames.length - sheets.length;

  if (ignoredSheets) {
    warnings.push(
      `${ignoredSheets} tabela(s) vazia(s) ou sem registros foram desconsideradas.`,
    );
  }
  for (const sheet of sheets) {
    if (!sheet.detectedColumns.text) {
      warnings.push(
        `A coluna de texto não foi identificada automaticamente em “${sheet.name}”. A IA receberá todas as colunas.`,
      );
    }
    if (!sheet.detectedColumns.author) {
      warnings.push(
        `A coluna de autor não foi identificada em “${sheet.name}”; repetidos dessa tabela dependerão da análise da IA.`,
      );
    }
  }
  if (duplicateCount) {
    warnings.push(
      `${duplicateCount} repetição(ões) do mesmo texto pelo mesmo autor foram pré-marcadas.`,
    );
  }
  if (corruptedCount) {
    warnings.push(
      `${corruptedCount} linha(s) com campo essencial vazio foram sinalizadas para revisão.`,
    );
  }

  const contextText = makeContextText(sheets);
  const maxContextCharacters =
    options?.maxContextCharacters ?? DEFAULT_MAX_CONTEXT_CHARACTERS;
  if (contextText.length > maxContextCharacters) {
    throw new Error(
      `O conteúdo reconhecido tem ${contextText.length.toLocaleString("pt-BR")} caracteres e ultrapassa o limite configurado de ${maxContextCharacters.toLocaleString("pt-BR")}. Divida o arquivo ou aumente NEXT_PUBLIC_MAX_CONTEXT_CHARS.`,
    );
  }

  return {
    fileName: metadata.fileName,
    fileSize: metadata.fileSize,
    extension,
    totalSheets: workbook.SheetNames.length,
    usableSheets: sheets.length,
    recordCount: sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
    duplicateCount,
    corruptedCount,
    sheets,
    warnings,
    contextText,
  };
}
