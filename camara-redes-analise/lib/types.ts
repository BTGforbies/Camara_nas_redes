export type AnalysisSectionId =
  | "classification"
  | "qualitative"
  | "whatTheySay"
  | "featuredChannel"
  | "whoMobilized"
  | "whatMobilized"
  | "executiveSummary";

export type GenerationStatus = "idle" | "running" | "done" | "error";

export interface WorkbookRow {
  rowNumber: number;
  values: string[];
  duplicateOf?: string;
  corrupted?: boolean;
}

export interface WorkbookSheet {
  name: string;
  headers: string[];
  rows: WorkbookRow[];
  detectedColumns: {
    author?: string;
    text?: string;
    channel?: string;
    engagement?: string;
  };
}

export interface WorkbookPayload {
  fileName: string;
  fileSize: number;
  extension: ".xlsx" | ".xls" | ".csv";
  totalSheets: number;
  usableSheets: number;
  recordCount: number;
  duplicateCount: number;
  corruptedCount: number;
  sheets: WorkbookSheet[];
  warnings: string[];
}

export interface ProjectContext {
  projectName: string;
  progressSheet: string;
  situation: string;
  subject: string;
  context: string;
  engagementByChannel: string;
}

export interface AnalysisSectionDefinition {
  id: AnalysisSectionId;
  command: number;
  title: string;
  shortTitle: string;
  description: string;
  characterLimit?: number;
  dependencies: AnalysisSectionId[];
}

export interface AnalysisSectionResult extends AnalysisSectionDefinition {
  content: string;
  originalContent: string;
  status: GenerationStatus;
  edited: boolean;
  validated: boolean;
  error?: string;
}

export interface AnalysisRecord {
  id: string;
  text: string;
}

export type ClassificationStatus = "RELEVANTE" | "OFFTOPIC";
export type AnalysisStance = "POSITIVO" | "NEGATIVO" | "NEUTRO";

export interface ClassifiedRecord {
  id: string;
  status: ClassificationStatus;
  stance: AnalysisStance;
  themes: string[];
}

export interface AnalysisMetrics {
  totalGross: number;
  analyzed: number;
  offTopic: number;
  repeated: number;
  corrupted: number;
  relevant: number;
}

export interface RepresentativePost {
  id: string;
  text: string;
}

export interface ThemeSummary {
  name: string;
  count: number;
  percentage: number;
  candidates: RepresentativePost[];
}

export interface NamedAggregate {
  name: string;
  posts: number;
  engagement: number;
}

export interface AnalysisSummary {
  metrics: AnalysisMetrics;
  stances: Record<AnalysisStance, number>;
  themes: ThemeSummary[];
  otherThemeOccurrences: number;
  channels: NamedAggregate[];
  authors: NamedAggregate[];
}

export type ReportBundle = Record<
  Exclude<AnalysisSectionId, "classification">,
  string
>;

export const REPORT_SECTION_IDS: AnalysisSectionId[] = [
  "qualitative",
  "whatTheySay",
  "featuredChannel",
  "whoMobilized",
  "whatMobilized",
  "executiveSummary",
];

export const SECTION_DEFINITIONS: AnalysisSectionDefinition[] = [
  {
    id: "classification",
    command: 1,
    title: "Tabelas automáticas",
    shortTitle: "Tabelas",
    description:
      "Consolida métricas e termos sem exigir validação manual.",
    dependencies: [],
  },
  {
    id: "qualitative",
    command: 2,
    title: "Ranking dos argumentos",
    shortTitle: "Ranking",
    description:
      "Explica os cinco argumentos mais frequentes com exemplos representativos.",
    dependencies: ["classification"],
  },
  {
    id: "whatTheySay",
    command: 3,
    title: "O que dizem",
    shortTitle: "O que dizem",
    description: "Resumo executivo dos principais achados da análise qualitativa.",
    characterLimit: 400,
    dependencies: ["qualitative"],
  },
  {
    id: "featuredChannel",
    command: 4,
    title: "Canal de destaque",
    shortTitle: "Canal",
    description:
      "Mostra o canal de maior destaque e a contribuição dos demais em pontos de engajamento.",
    characterLimit: 400,
    dependencies: ["classification"],
  },
  {
    id: "whoMobilized",
    command: 5,
    title: "Quem mobilizou",
    shortTitle: "Quem mobilizou",
    description:
      "Resume quais autores concentraram postagens e pontos de engajamento.",
    characterLimit: 400,
    dependencies: ["classification"],
  },
  {
    id: "whatMobilized",
    command: 6,
    title: "O que mobilizou",
    shortTitle: "O que mobilizou",
    description:
      "Relaciona fatos, contexto e conteúdo das postagens aos motivos da participação.",
    characterLimit: 400,
    dependencies: ["classification", "qualitative"],
  },
  {
    id: "executiveSummary",
    command: 7,
    title: "Resumo executivo",
    shortTitle: "Resumo",
    description: "Consolida os resultados em uma narrativa breve, simples e imparcial.",
    characterLimit: 400,
    dependencies: [
      "whatTheySay",
      "featuredChannel",
      "whoMobilized",
      "whatMobilized",
    ],
  },
];

export const EMPTY_PROJECT_CONTEXT: ProjectContext = {
  projectName: "",
  progressSheet: "",
  situation: "",
  subject: "",
  context: "",
  engagementByChannel: "",
};
