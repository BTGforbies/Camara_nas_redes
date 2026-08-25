export type AiProvider = "xai" | "openai";

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
  contextText: string;
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
  error?: string;
}

export interface AnalyzeRequest {
  provider: AiProvider;
  sectionId: AnalysisSectionId;
  project: ProjectContext;
  workbook: Pick<
    WorkbookPayload,
    | "fileName"
    | "totalSheets"
    | "usableSheets"
    | "recordCount"
    | "duplicateCount"
    | "corruptedCount"
    | "warnings"
    | "contextText"
  >;
  previousResults: Partial<Record<AnalysisSectionId, string>>;
}

export const SECTION_DEFINITIONS: AnalysisSectionDefinition[] = [
  {
    id: "classification",
    command: 1,
    title: "Classificação, contagens e ranking",
    shortTitle: "Classificação",
    description:
      "Separa postagens relevantes, offtopic e repetidas, calcula posições, termos, canais e transparência.",
    dependencies: [],
  },
  {
    id: "qualitative",
    command: 2,
    title: "Análise qualitativa dos argumentos",
    shortTitle: "Argumentos",
    description:
      "Explica os cinco argumentos mais frequentes e as demais opiniões com exemplos representativos.",
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
