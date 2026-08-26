import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

export interface ReportPdfSection {
  title: string;
  content: string;
}

export interface ReportPdfInput {
  sections: ReportPdfSection[];
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 52;
const TOP_MARGIN = 52;
const BOTTOM_MARGIN = 52;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const INK = rgb(18 / 255, 29 / 255, 43 / 255);

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
      if (fragment && font.widthOfTextAtSize(next, size) > maxWidth) {
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

function normalizedFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Respostas";
}

export function reportFileName(projectName: string, date = new Date()) {
  return `Respostas_${normalizedFilePart(projectName)}_${date.toISOString().slice(0, 10)}.pdf`;
}

export async function generateReportPdf(input: ReportPdfInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - TOP_MARGIN;

  const nextPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - TOP_MARGIN;
  };
  const ensureSpace = (height: number) => {
    if (y - height < BOTTOM_MARGIN) nextPage();
  };

  for (const section of input.sections) {
    ensureSpace(54);
    for (const line of wrapLine(section.title, bold, 13, CONTENT_WIDTH)) {
      ensureSpace(18);
      page.drawText(line, { x: MARGIN_X, y, size: 13, font: bold, color: INK });
      y -= 18;
    }
    y -= 5;

    const paragraphs = section.content.replace(/\r\n?/g, "\n").split("\n");
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        ensureSpace(8);
        y -= 8;
        continue;
      }
      for (const line of wrapLine(paragraph, regular, 10.5, CONTENT_WIDTH)) {
        ensureSpace(15);
        page.drawText(line, { x: MARGIN_X, y, size: 10.5, font: regular, color: INK });
        y -= 15;
      }
      y -= 4;
    }
    y -= 18;
  }

  return pdf.save({ useObjectStreams: false });
}
