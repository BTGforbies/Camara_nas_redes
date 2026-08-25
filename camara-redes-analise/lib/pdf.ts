import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

export interface ReportPdfSection {
  title: string;
  content: string;
}

export interface ReportPdfInput {
  documentTitle?: string;
  projectName: string;
  generatedAt?: Date;
  headerImage?: string;
  sections: ReportPdfSection[];
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 52;
const TOP_MARGIN = 48;
const BOTTOM_MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const COLORS = {
  navy: rgb(8 / 255, 20 / 255, 38 / 255),
  slate: rgb(66 / 255, 78 / 255, 92 / 255),
  cyan: rgb(40 / 255, 184 / 255, 216 / 255),
  light: rgb(232 / 255, 237 / 255, 242 / 255),
  white: rgb(1, 1, 1),
};

function safePdfText(value: string) {
  return value
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\u0009\u000a\u000d\u0020-\u00ff]/g, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
  if (!match) {
    throw new Error("A imagem do cabeçalho deve ser PNG ou JPEG.");
  }
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { mimeType: match[1], bytes };
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number) {
  const normalized = safePdfText(text);
  if (!normalized) return [""];

  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    let fragment = "";
    for (const character of word) {
      const next = `${fragment}${character}`;
      if (font.widthOfTextAtSize(next, size) > maxWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    current = fragment;
  }

  if (current) lines.push(current);
  return lines;
}

function normalizeContentLines(content: string) {
  return content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

function normalizedFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Projeto";
}

export function reportFileName(projectName: string, date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  return `Analise_${normalizedFilePart(projectName)}_${isoDate}.pdf`;
}

export async function generateReportPdf(input: ReportPdfInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = input.generatedAt ?? new Date();
  let headerImage: PDFImage | null = null;

  if (input.headerImage) {
    const decoded = decodeDataUrl(input.headerImage);
    headerImage =
      decoded.mimeType === "image/png"
        ? await pdf.embedPng(decoded.bytes)
        : await pdf.embedJpg(decoded.bytes);
  }

  const pages: PDFPage[] = [];
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  let y = PAGE_HEIGHT - TOP_MARGIN;

  const addContinuationPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - TOP_MARGIN;
    page.drawText(safePdfText(input.projectName), {
      x: MARGIN_X,
      y,
      size: 8,
      font: bold,
      color: COLORS.slate,
    });
    page.drawLine({
      start: { x: MARGIN_X, y: y - 10 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: y - 10 },
      thickness: 1,
      color: COLORS.light,
    });
    y -= 32;
  };

  const ensureSpace = (height: number) => {
    if (y - height < BOTTOM_MARGIN) addContinuationPage();
  };

  if (headerImage) {
    const dimensions = headerImage.scale(1);
    const scale = Math.min(CONTENT_WIDTH / dimensions.width, 96 / dimensions.height);
    const imageWidth = dimensions.width * scale;
    const imageHeight = dimensions.height * scale;
    page.drawImage(headerImage, {
      x: MARGIN_X + (CONTENT_WIDTH - imageWidth) / 2,
      y: y - imageHeight,
      width: imageWidth,
      height: imageHeight,
    });
    y -= imageHeight + 24;
  } else {
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 6,
      width: 42,
      height: 6,
      color: COLORS.cyan,
    });
    y -= 28;
  }

  const documentTitle = safePdfText(
    input.documentTitle || "Relatório Câmara nas Redes",
  );
  for (const line of wrapLine(documentTitle, bold, 22, CONTENT_WIDTH)) {
    page.drawText(line, {
      x: MARGIN_X,
      y,
      size: 22,
      font: bold,
      color: COLORS.navy,
    });
    y -= 27;
  }

  y -= 4;
  for (const line of wrapLine(input.projectName, regular, 11, CONTENT_WIDTH)) {
    page.drawText(line, {
      x: MARGIN_X,
      y,
      size: 11,
      font: regular,
      color: COLORS.slate,
    });
    y -= 16;
  }
  page.drawText(
    `Gerado em ${generatedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    {
      x: MARGIN_X,
      y: y - 2,
      size: 8.5,
      font: regular,
      color: COLORS.slate,
    },
  );
  y -= 26;
  page.drawLine({
    start: { x: MARGIN_X, y },
    end: { x: PAGE_WIDTH - MARGIN_X, y },
    thickness: 1.2,
    color: COLORS.light,
  });
  y -= 28;

  input.sections.forEach((section, sectionIndex) => {
    ensureSpace(72);
    page.drawText(String(sectionIndex + 1).padStart(2, "0"), {
      x: MARGIN_X,
      y,
      size: 9,
      font: bold,
      color: COLORS.cyan,
    });
    const titleX = MARGIN_X + 28;
    const titleWidth = CONTENT_WIDTH - 28;
    const titleLines = wrapLine(section.title, bold, 15, titleWidth);
    titleLines.forEach((line) => {
      page.drawText(line, {
        x: titleX,
        y,
        size: 15,
        font: bold,
        color: COLORS.navy,
      });
      y -= 20;
    });
    y -= 6;

    const contentLines = normalizeContentLines(section.content);
    for (const rawLine of contentLines) {
      const trimmed = rawLine.trim();
      const isTableLine = trimmed.startsWith("|");
      const isListLine = /^[-*]\s+/.test(trimmed);
      const clean = trimmed.replace(/^[-*]\s+/, "");
      const prefix = isListLine ? "- " : "";
      const size = isTableLine ? 8.5 : 10.5;
      const font = isTableLine ? regular : regular;
      const lines = wrapLine(`${prefix}${clean}`, font, size, CONTENT_WIDTH);

      if (!trimmed) {
        ensureSpace(8);
        y -= 8;
        continue;
      }

      for (const line of lines) {
        ensureSpace(isTableLine ? 12 : 15);
        page.drawText(line, {
          x: MARGIN_X,
          y,
          size,
          font,
          color: isTableLine ? COLORS.slate : COLORS.navy,
        });
        y -= isTableLine ? 12 : 15;
      }
      y -= isTableLine ? 2 : 4;
    }

    y -= 19;
  });

  const totalPages = pages.length;
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: MARGIN_X, y: 38 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: 38 },
      thickness: 0.8,
      color: COLORS.light,
    });
    currentPage.drawText("Câmara nas Redes", {
      x: MARGIN_X,
      y: 23,
      size: 7.5,
      font: regular,
      color: COLORS.slate,
    });
    const pageLabel = `Página ${index + 1} de ${totalPages}`;
    currentPage.drawText(pageLabel, {
      x:
        PAGE_WIDTH -
        MARGIN_X -
        regular.widthOfTextAtSize(pageLabel, 7.5),
      y: 23,
      size: 7.5,
      font: regular,
      color: COLORS.slate,
    });
  });

  return pdf.save({ useObjectStreams: false });
}

