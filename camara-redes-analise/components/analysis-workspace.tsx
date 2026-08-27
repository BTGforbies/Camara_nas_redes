"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Info,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { groupByCharacterLimit, wrapPartialResults } from "@/lib/batching";
import type {
  AnalysisSectionId,
  AnalysisSectionResult,
  ProjectContext,
  WorkbookPayload,
} from "@/lib/types";
import {
  EMPTY_PROJECT_CONTEXT,
  REPORT_SECTION_IDS,
  SECTION_DEFINITIONS,
} from "@/lib/types";
import {
  DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
  DEFAULT_MAX_CONTEXT_CHARACTERS,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  MIN_ANALYSIS_CHUNK_CHARACTERS,
  parseWorkbookArrayBuffer,
  splitWorkbookContext,
} from "@/lib/workbook";

interface RuntimeLimits {
  maxFileMb: number;
  maxContextCharacters: number;
  maxChunkCharacters: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const STEPS = [
  { number: 1, label: "Anexar proposta", short: "Arquivo" },
  { number: 2, label: "Informar contexto", short: "Contexto" },
  { number: 3, label: "Gerar e validar", short: "Validação" },
  { number: 4, label: "Conferir respostas", short: "Conferência" },
  { number: 5, label: "Baixar PDF", short: "PDF" },
] as const;

class AnalysisRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AnalysisRequestError";
  }
}

function isRequestTooLarge(error: unknown) {
  return error instanceof AnalysisRequestError && error.status === 413;
}

function safeInitialChunkLimit(configured: number) {
  if (!Number.isFinite(configured)) return DEFAULT_ANALYSIS_CHUNK_CHARACTERS;
  return Math.min(
    Math.max(configured, MIN_ANALYSIS_CHUNK_CHARACTERS),
    DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
  );
}

function splitRejectedChunk(contextText: string) {
  if (contextText.length <= MIN_ANALYSIS_CHUNK_CHARACTERS) {
    throw new Error(
      "A API recusou até o menor lote automático. Aguarde um instante e tente novamente.",
    );
  }
  const smallerLimit = Math.max(
    MIN_ANALYSIS_CHUNK_CHARACTERS,
    Math.floor(contextText.length / 2),
  );
  const smallerChunks = splitWorkbookContext(contextText, smallerLimit);
  if (smallerChunks.length < 2) {
    throw new Error(
      "Não foi possível reduzir automaticamente o lote recusado.",
    );
  }
  return smallerChunks;
}

function visibleAnalysisContent(content: string) {
  return content
    .replace(/<!--\s*DADOS_INTERNOS[\s\S]*?(?:-->|$)/gi, "")
    .trim();
}

function inlineTableValue(value: string) {
  const trimmed = value.trim();
  const bold = trimmed.match(/^\*\*(.+)\*\*$/);
  return bold ? <strong>{bold[1]}</strong> : trimmed;
}

function StructuredResult({ content }: { content: string }) {
  const lines = visibleAnalysisContent(content).split("\n");
  const elements: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(<h4 key={`heading-${index}`}>{line.slice(4)}</h4>);
      index += 1;
      continue;
    }
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      const rows = tableLines.map((row) =>
        row.slice(1, -1).split("|").map((cell) => cell.trim()),
      );
      const headers = rows[0] ?? [];
      const body = rows.slice(1).filter((row) =>
        !row.every((cell) => /^:?-{3,}:?$/.test(cell)),
      );
      elements.push(
        <div className="automatic-table-scroll" key={`table-${index}`}>
          <table className="automatic-table">
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{inlineTableValue(cell)}</th>)}</tr></thead>
            <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineTableValue(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    elements.push(<p key={`text-${index}`}>{line}</p>);
    index += 1;
  }

  return <div className="structured-result">{elements}</div>;
}

function newSectionResults(): AnalysisSectionResult[] {
  return SECTION_DEFINITIONS.map((definition) => ({
    ...definition,
    content: "",
    originalContent: "",
    status: "idle",
    edited: false,
    validated: false,
  }));
}

function bytesLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function extractPdfFileName(header: string | null, fallback: string) {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] || fallback;
}

function localPdfName(projectName: string) {
  const normalized = projectName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "Projeto";
  return `Respostas_${normalized}_${new Date().toISOString().slice(0, 10)}.pdf`;
}

export default function AnalysisWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [workbook, setWorkbook] = useState<WorkbookPayload | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [uploadError, setUploadError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [project, setProject] = useState<ProjectContext>(EMPTY_PROJECT_CONTEXT);
  const [runtimeLimits, setRuntimeLimits] = useState<RuntimeLimits>({
    maxFileMb: DEFAULT_MAX_FILE_SIZE_BYTES / 1024 / 1024,
    maxContextCharacters: DEFAULT_MAX_CONTEXT_CHARACTERS,
    maxChunkCharacters: DEFAULT_ANALYSIS_CHUNK_CHARACTERS,
  });
  const [sections, setSections] = useState<AnalysisSectionResult[]>(newSectionResults);
  const [busy, setBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [activeChatId, setActiveChatId] = useState<AnalysisSectionId | null>(null);
  const [chatMessages, setChatMessages] = useState<Partial<Record<AnalysisSectionId, ChatMessage[]>>>({});
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const requiredFieldsReady = Boolean(
    project.projectName.trim() && project.subject.trim() && project.context.trim(),
  );
  const allSectionsReady = sections.every(
    (section) => section.status === "done" && section.content.trim(),
  );
  const reportSections = useMemo(
    () => REPORT_SECTION_IDS.map((id) => sections.find((section) => section.id === id)).filter(Boolean) as AnalysisSectionResult[],
    [sections],
  );
  const allReportSectionsValidated =
    reportSections.length === REPORT_SECTION_IDS.length && reportSections.every((section) => section.validated);
  const completedSections = sections.filter((section) => section.status === "done").length;
  const validatedCount = reportSections.filter((section) => section.validated).length;
  const automaticSection = sections.find((section) => section.id === "classification");
  const activeChatSection = sections.find((section) => section.id === activeChatId);
  const activeMessages = useMemo(
    () => (activeChatId ? chatMessages[activeChatId] ?? [] : []),
    [activeChatId, chatMessages],
  );

  useEffect(() => {
    fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (data.limits) setRuntimeLimits(data.limits);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages, chatBusy]);

  const invalidateFinal = useCallback(() => {
    setConfirmed(false);
    setPdfError("");
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl("");
      setPdfName("");
    }
  }, [pdfUrl]);

  const processFile = useCallback(async (file?: File) => {
    if (!file) return;
    setUploadStatus("processing");
    setUploadError("");
    setWorkbook(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseWorkbookArrayBuffer(
        buffer,
        { fileName: file.name, fileSize: file.size },
        {
          maxFileSize: runtimeLimits.maxFileMb * 1024 * 1024,
          maxContextCharacters: runtimeLimits.maxContextCharacters,
        },
      );
      setWorkbook(parsed);
      setUploadStatus("done");
      setSections(newSectionResults());
      setChatMessages({});
      setActiveChatId(null);
      invalidateFinal();
    } catch (error) {
      setUploadStatus("error");
      setUploadError(error instanceof Error ? error.message : "Falha inesperada ao processar o arquivo.");
    }
  }, [invalidateFinal, runtimeLimits]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void processFile(event.dataTransfer.files[0]);
  };

  const removeWorkbook = () => {
    setWorkbook(null);
    setUploadStatus("idle");
    setUploadError("");
    setSections(newSectionResults());
    setChatMessages({});
    setActiveChatId(null);
    setCurrentStep(1);
    invalidateFinal();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateProject = (field: keyof ProjectContext, value: string) => {
    setProject((current) => ({ ...current, [field]: value }));
    setSections((current) => current.map((item) => ({ ...item, validated: false })));
    invalidateFinal();
  };

  const requestSection = async (
    sectionId: AnalysisSectionId,
    previousResults: Partial<Record<AnalysisSectionId, string>>,
  ) => {
    if (!workbook) throw new Error("Anexe um arquivo CSV ou Excel antes de continuar.");

    const postRequest = async (
      contextText: string,
      chunk?: {
        index: number;
        total: number;
        aggregation: boolean;
        finalAggregation: boolean;
      },
    ) => {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          project,
          workbook: {
            fileName: workbook.fileName,
            totalSheets: workbook.totalSheets,
            usableSheets: workbook.usableSheets,
            recordCount: workbook.recordCount,
            duplicateCount: workbook.duplicateCount,
            corruptedCount: workbook.corruptedCount,
            warnings: workbook.warnings,
            contextText,
          },
          previousResults,
          chunk,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new AnalysisRequestError(
          payload.error || "Não foi possível gerar esta resposta.",
          response.status,
        );
      }
      return String(payload.content || "").trim();
    };

    if (sectionId !== "classification") {
      return postRequest("Base consolidada no comando 1.");
    }

    const initialLimit = safeInitialChunkLimit(
      runtimeLimits.maxChunkCharacters,
    );
    const chunks = splitWorkbookContext(
      workbook.contextText,
      initialLimit,
    );
    const partialResults: string[] = [];
    try {
      for (let index = 0; index < chunks.length;) {
        setBatchProgress({ current: index + 1, total: chunks.length });
        try {
          partialResults.push(
            await postRequest(chunks[index], {
              index: index + 1,
              total: chunks.length,
              aggregation: false,
              finalAggregation: false,
            }),
          );
          index += 1;
        } catch (error) {
          if (!isRequestTooLarge(error)) throw error;
          const smallerChunks = splitRejectedChunk(chunks[index]);
          chunks.splice(index, 1, ...smallerChunks);
          setBatchProgress({ current: index + 1, total: chunks.length });
        }
      }
      setBatchProgress({ current: chunks.length, total: chunks.length });
      let consolidationLevel = partialResults;
      let aggregationLimit = initialLimit;
      while (consolidationLevel.length > 1) {
        const groups = groupByCharacterLimit(
          consolidationLevel,
          aggregationLimit,
        );
        if (groups.length >= consolidationLevel.length) {
          throw new Error(
            "Os resultados parciais não puderam ser reduzidos com segurança.",
          );
        }

        if (groups.length === 1) {
          try {
            return await postRequest(wrapPartialResults(groups[0]), {
              index: 1,
              total: 1,
              aggregation: true,
              finalAggregation: true,
            });
          } catch (error) {
            if (!isRequestTooLarge(error)) throw error;
            const smallerLimit = Math.max(
              MIN_ANALYSIS_CHUNK_CHARACTERS,
              Math.floor(aggregationLimit / 2),
            );
            if (smallerLimit === aggregationLimit) {
              throw new Error(
                "A consolidação mínima foi recusada pela API. Tente novamente em instantes.",
              );
            }
            aggregationLimit = smallerLimit;
            continue;
          }
        }

        const nextLevel: string[] = [];
        let retryWithSmallerGroups = false;
        for (let index = 0; index < groups.length; index += 1) {
          try {
            nextLevel.push(
              await postRequest(wrapPartialResults(groups[index]), {
                index: index + 1,
                total: groups.length,
                aggregation: true,
                finalAggregation: false,
              }),
            );
          } catch (error) {
            if (!isRequestTooLarge(error)) throw error;
            const smallerLimit = Math.max(
              MIN_ANALYSIS_CHUNK_CHARACTERS,
              Math.floor(aggregationLimit / 2),
            );
            if (smallerLimit === aggregationLimit) {
              throw new Error(
                "A consolidação mínima foi recusada pela API. Tente novamente em instantes.",
              );
            }
            aggregationLimit = smallerLimit;
            retryWithSmallerGroups = true;
            break;
          }
        }
        if (retryWithSmallerGroups) continue;
        consolidationLevel = nextLevel;
      }

      return postRequest(wrapPartialResults(consolidationLevel), {
        index: 1,
        total: 1,
        aggregation: true,
        finalAggregation: true,
      });
    } finally {
      setBatchProgress(null);
    }
  };

  const runSequence = async (reset: boolean) => {
    if (!workbook || !requiredFieldsReady) return;
    setBusy(true);
    setGenerationError("");
    setCurrentStep(3);
    setActiveChatId(null);
    invalidateFinal();
    const working = reset ? newSectionResults() : sections.map((item) => ({ ...item, validated: false }));
    if (reset) {
      setSections(working);
      setChatMessages({});
    }
    const previousResults: Partial<Record<AnalysisSectionId, string>> = {};
    try {
      for (const definition of SECTION_DEFINITIONS) {
        const index = working.findIndex((item) => item.id === definition.id);
        if (!reset && working[index].status === "done" && working[index].content) {
          previousResults[definition.id] = working[index].content;
          continue;
        }
        working[index] = { ...working[index], status: "running", error: undefined };
        setSections(working.map((item) => ({ ...item })));
        try {
          const content = await requestSection(definition.id, previousResults);
          working[index] = {
            ...working[index],
            content,
            originalContent: content,
            status: "done",
            edited: false,
            validated: false,
            error: undefined,
          };
          previousResults[definition.id] = content;
          setSections(working.map((item) => ({ ...item })));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Falha durante a geração.";
          working[index] = { ...working[index], status: "error", error: message };
          setSections(working.map((item) => ({ ...item })));
          throw new Error(message);
        }
      }
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "A geração foi interrompida. Seus dados foram preservados.");
    } finally {
      setBusy(false);
    }
  };

  const regenerateAll = () => void runSequence(true);

  const openChat = (sectionId: AnalysisSectionId) => {
    setActiveChatId(sectionId);
    setChatInput("");
    setChatError("");
  };

  const sendChatMessage = async () => {
    if (!activeChatId || !activeChatSection || !chatInput.trim() || chatBusy) return;
    const instruction = chatInput.trim();
    const history = chatMessages[activeChatId] ?? [];
    setChatMessages((current) => ({
      ...current,
      [activeChatId]: [...history, { role: "user", content: instruction }],
    }));
    setChatInput("");
    setChatError("");
    setChatBusy(true);
    try {
      const response = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: activeChatId,
          currentContent: activeChatSection.content,
          instruction,
          history,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível revisar a resposta.");
      const revisedContent = String(payload.revisedContent || "").trim();
      setSections((current) => current.map((item) =>
        item.id === activeChatId
          ? { ...item, content: revisedContent, edited: true, validated: false }
          : item,
      ));
      setChatMessages((current) => ({
        ...current,
        [activeChatId]: [
          ...(current[activeChatId] ?? []),
          { role: "assistant", content: String(payload.message || "Resposta ajustada.") },
        ],
      }));
      invalidateFinal();
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Falha inesperada na revisão.");
    } finally {
      setChatBusy(false);
    }
  };

  const validateSection = (sectionId: AnalysisSectionId) => {
    setSections((current) => current.map((item) =>
      item.id === sectionId ? { ...item, validated: true } : item,
    ));
    if (activeChatId === sectionId) setActiveChatId(null);
  };

  const confirmFinal = () => {
    if (!allReportSectionsValidated) return;
    setConfirmed(true);
    setCurrentStep(5);
  };

  const generatePdf = async () => {
    if (!confirmed || !allReportSectionsValidated) return;
    setPdfBusy(true);
    setPdfError("");
    try {
      const response = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: project.projectName,
          sections: reportSections
            .filter((section) => section.validated)
            .map((section) => ({ title: section.title, content: section.content })),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Não foi possível gerar o PDF.");
      }
      const blob = await response.blob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      setPdfName(extractPdfFileName(response.headers.get("content-disposition"), localPdfName(project.projectName)));
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "Falha inesperada ao gerar o PDF.");
    } finally {
      setPdfBusy(false);
    }
  };

  const stepEnabled = (step: number) => {
    if (step === 1) return true;
    if (step === 2) return Boolean(workbook);
    if (step === 3) return Boolean(workbook && requiredFieldsReady);
    if (step === 4) return allReportSectionsValidated;
    return confirmed;
  };

  const navigateToStep = (step: number) => {
    if (!busy && !chatBusy && !pdfBusy && stepEnabled(step)) setCurrentStep(step);
  };

  const fieldClass = (value: string, required = false) =>
    required && !value.trim() ? "field-input field-input-required" : "field-input";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>Câmara nas Redes</strong><span>Análise de propostas</span></div>
        </div>
        <nav className="step-navigation" aria-label="Etapas da análise">
          {STEPS.map((step) => {
            const enabled = stepEnabled(step.number);
            const complete =
              step.number < currentStep ||
              (step.number === 1 && Boolean(workbook)) ||
              (step.number === 3 && allReportSectionsValidated) ||
              (step.number === 5 && Boolean(pdfUrl));
            return (
              <button
                type="button"
                key={step.number}
                className={`step-link ${currentStep === step.number ? "active" : ""} ${complete ? "complete" : ""}`}
                onClick={() => navigateToStep(step.number)}
                disabled={!enabled || busy || chatBusy || pdfBusy}
                aria-current={currentStep === step.number ? "step" : undefined}
              >
                <span className="step-number">{complete ? <Check size={14} strokeWidth={3} /> : step.number}</span>
                <span className="step-copy"><small>Etapa {step.number}</small><strong>{step.label}</strong></span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-security">
          <ShieldCheck size={18} />
          <div><strong>Processamento seguro</strong><span>A chave fica somente no servidor.</span></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">Central de análise</p><h1>{STEPS[currentStep - 1].label}</h1></div>
        </header>
        <div className="mobile-steps" aria-label="Progresso">
          {STEPS.map((step) => (
            <button
              type="button"
              key={step.number}
              className={currentStep === step.number ? "active" : ""}
              disabled={!stepEnabled(step.number) || busy || chatBusy || pdfBusy}
              onClick={() => navigateToStep(step.number)}
            ><span>{step.number}</span>{step.short}</button>
          ))}
        </div>

        <div className="workspace-content">
          {currentStep === 1 && (
            <section className="stage" aria-labelledby="upload-title">
              <div className="stage-heading">
                <div><span className="section-kicker">01 · Proposta</span><h2 id="upload-title">Anexe a base de postagens</h2><p>O sistema valida arquivos CSV ou Excel, lê todas as tabelas utilizáveis e organiza os registros antes da análise.</p></div>
                <span className="format-chip">CSV / XLSX / XLS · até {runtimeLimits.maxFileMb} MB</span>
              </div>
              {!workbook && (
                <div
                  className={`upload-zone ${dragActive ? "drag-active" : ""} ${uploadStatus === "error" ? "has-error" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                >
                  {uploadStatus === "processing" ? (
                    <><div className="upload-icon processing"><LoaderCircle size={30} className="spin" /></div><h3>Processando a proposta</h3><p>Validando tabelas, cabeçalhos, linhas e colunas.</p></>
                  ) : (
                    <><div className="upload-icon"><UploadCloud size={30} /></div><h3>Arraste o CSV ou Excel para esta área</h3><p>ou selecione o arquivo no seu computador</p><button type="button" className="button button-primary" onClick={() => fileInputRef.current?.click()}><FileSpreadsheet size={18} /> Selecionar arquivo</button></>
                  )}
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => void processFile(event.target.files?.[0])} hidden />
                </div>
              )}
              {uploadStatus === "error" && uploadError && (
                <div className="alert alert-error" role="alert"><AlertCircle size={20} /><div><strong>O arquivo não pôde ser utilizado</strong><span>{uploadError}</span></div><button type="button" onClick={() => setUploadError("")} aria-label="Fechar aviso"><X size={18} /></button></div>
              )}
              {workbook && (
                <div className="file-summary">
                  <div className="file-summary-top">
                    <div className="file-badge"><FileSpreadsheet size={24} /></div>
                    <div className="file-name"><span>Arquivo processado</span><strong>{workbook.fileName}</strong><small>{bytesLabel(workbook.fileSize)} · {workbook.extension.toUpperCase().slice(1)}</small></div>
                    <div className="file-state"><CheckCircle2 size={17} /> Pronto</div>
                    <div className="file-actions"><button type="button" onClick={() => fileInputRef.current?.click()}><RefreshCw size={16} /> Substituir</button><button type="button" className="danger" onClick={removeWorkbook}><Trash2 size={16} /> Remover</button></div>
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/csv" onChange={(event) => void processFile(event.target.files?.[0])} hidden />
                  </div>
                  <div className="metrics-grid">
                    <div><span>Tabelas encontradas</span><strong>{workbook.totalSheets}</strong></div>
                    <div><span>Tabelas analisáveis</span><strong>{workbook.usableSheets}</strong></div>
                    <div><span>Registros reconhecidos</span><strong>{workbook.recordCount.toLocaleString("pt-BR")}</strong></div>
                    <div><span>Repetições pré-marcadas</span><strong>{workbook.duplicateCount.toLocaleString("pt-BR")}</strong></div>
                  </div>
                  {workbook.warnings.length > 0 && <div className="warning-list"><Info size={18} /><div><strong>Avisos da leitura</strong><ul>{workbook.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div>}
                </div>
              )}
              <div className="stage-actions end"><button type="button" className="button button-primary" disabled={!workbook} onClick={() => setCurrentStep(2)}>Continuar para o contexto <ArrowRight size={18} /></button></div>
            </section>
          )}

          {currentStep === 2 && (
            <section className="stage" aria-labelledby="context-title">
              <div className="stage-heading"><div><span className="section-kicker">02 · Contexto</span><h2 id="context-title">Complete as informações do projeto</h2><p>Os seis campos abaixo dão contexto à análise. Os itens com asterisco são obrigatórios.</p></div></div>
              <div className="context-layout context-layout-single">
                <div className="form-panel">
                  <div className="form-section-heading"><h3>Informações essenciais</h3><span>6 campos</span></div>
                  <div className="form-grid">
                    <label className="span-2"><span>Nome do projeto *</span><input className={fieldClass(project.projectName, true)} value={project.projectName} onChange={(event) => updateProject("projectName", event.target.value)} placeholder="Ex.: PL 1234/2026" maxLength={240} /></label>
                    <label className="span-2"><span>Ficha de tramitação</span><textarea className="field-input" value={project.progressSheet} onChange={(event) => updateProject("progressSheet", event.target.value)} placeholder="Cole o link ou as principais informações da ficha de tramitação." rows={3} maxLength={12000} /></label>
                    <label><span>Situação</span><textarea className="field-input" value={project.situation} onChange={(event) => updateProject("situation", event.target.value)} placeholder="Ex.: em discussão, votação prevista ou aguardando parecer." rows={3} maxLength={8000} /></label>
                    <label><span>Assunto *</span><textarea className={fieldClass(project.subject, true)} value={project.subject} onChange={(event) => updateProject("subject", event.target.value)} placeholder="Explique de forma objetiva o tema tratado pelo projeto." rows={3} maxLength={8000} /></label>
                    <label className="span-2"><span>Contexto *</span><textarea className={fieldClass(project.context, true)} value={project.context} onChange={(event) => updateProject("context", event.target.value)} placeholder="Descreva por que o projeto está sendo analisado neste período." rows={4} maxLength={12000} /></label>
                    <label className="span-2"><span>Quadro de engajamento por canal</span><textarea className="field-input mono-input" value={project.engagementByChannel} onChange={(event) => updateProject("engagementByChannel", event.target.value)} placeholder={"Canal | Pontos de engajamento\nInstagram | 12.450\nX/Twitter | 8.320"} rows={5} maxLength={20000} /><small>Usado diretamente no 4º comando. Sem esse quadro, o sistema não estimará valores.</small></label>
                  </div>
                </div>
              </div>
              {!requiredFieldsReady && <div className="alert alert-info"><Info size={20} /><div><strong>Preenchimento pendente</strong><span>Informe nome do projeto, assunto e contexto para liberar a geração.</span></div></div>}
              <div className="stage-actions between"><button type="button" className="button button-secondary" onClick={() => setCurrentStep(1)}><ArrowLeft size={18} /> Voltar</button><button type="button" className="button button-primary" disabled={!requiredFieldsReady || busy} onClick={() => void runSequence(true)}><Sparkles size={18} /> Gerar respostas</button></div>
            </section>
          )}

          {currentStep === 3 && (
            <section className="stage generation-stage" aria-labelledby="generation-title">
              <div className="stage-heading">
                <div><span className="section-kicker">03 · Geração e validação</span><h2 id="generation-title">Revise as respostas antes de avançar</h2><p>As duas tabelas aparecem automaticamente. A validação começa no ranking dos argumentos e continua nas cinco análises finais.</p></div>
                <div className="progress-number"><strong>{busy ? completedSections : validatedCount}</strong><span>{busy ? "/ 7 comandos" : "/ 6 validadas"}</span></div>
              </div>
              {busy && <><div className="generation-progress" aria-label={`${completedSections} de 7 comandos concluídos`}><span style={{ width: `${(completedSections / 7) * 100}%` }} /></div><div className="command-list">{sections.map((section) => <article key={section.id} className={`command-row ${section.status}`}><div className="command-status-icon">{section.status === "done" && <CheckCircle2 size={20} />}{section.status === "running" && <LoaderCircle className="spin" size={20} />}{section.status === "error" && <AlertCircle size={20} />}{section.status === "idle" && <span className="idle-dot" />}</div><div className="command-copy"><span>Comando {section.command}</span><strong>{section.title}</strong><small>{section.status === "running" ? batchProgress && section.id === "classification" ? `Analisando lote ${batchProgress.current} de ${batchProgress.total}...` : "Analisando os dados..." : section.status === "done" ? "Concluído" : section.status === "error" ? section.error : "Aguardando"}</small></div></article>)}</div></>}
              {generationError && <div className="alert alert-error" role="alert"><AlertCircle size={20} /><div><strong>A geração foi interrompida</strong><span>{generationError} Os dados continuam salvos.</span></div></div>}

              {!busy && allSectionsReady && (
                <div className={`review-with-chat ${activeChatId ? "chat-open" : ""}`}>
                  <div className="review-list">
                    {automaticSection?.content && (
                      <article className="review-card automatic-results-card">
                        <header>
                          <div className="review-index">01</div>
                          <div className="review-title"><div><h3>{automaticSection.title}</h3><span className="automatic-badge"><Check size={12} /> Automáticas</span></div><p>Duas tabelas consolidadas pelo sistema. Não exigem conversa nem validação manual.</p></div>
                        </header>
                        <div className="result-content"><StructuredResult content={automaticSection.content} /></div>
                      </article>
                    )}
                    {reportSections.map((section) => (
                      <article key={section.id} className={`review-card validation-card ${section.validated ? "is-validated" : ""}`}>
                        <header>
                          <div className="review-index">{String(section.command).padStart(2, "0")}</div>
                          <div className="review-title"><div><h3>{section.title}</h3>{section.edited && <span className="edited-badge">Resposta ajustada</span>}{section.validated && <span className="validated-badge"><Check size={12} /> Validada</span>}</div><p>{section.description}</p></div>
                        </header>
                        <div className="result-content"><pre>{section.content}</pre><footer><span>{section.content.length.toLocaleString("pt-BR")}{section.characterLimit ? ` / ${section.characterLimit}` : ""} caracteres</span></footer></div>
                        <div className="validation-actions">
                          <button type="button" className="button button-secondary compact" onClick={() => openChat(section.id)} disabled={chatBusy}><MessageSquareText size={16} /> Ajustar resposta</button>
                          <button type="button" className="button button-primary compact" onClick={() => validateSection(section.id)} disabled={section.validated || chatBusy}><CheckCircle2 size={16} /> {section.validated ? "Resposta validada" : "Validar resposta"}</button>
                        </div>
                      </article>
                    ))}
                  </div>

                  {activeChatSection && (
                    <aside className="chat-panel" aria-label={`Conversa para revisar ${activeChatSection.title}`}>
                      <header><div><span>Revisão assistida</span><h3>{activeChatSection.title}</h3></div><button type="button" onClick={() => setActiveChatId(null)} aria-label="Fechar conversa"><X size={18} /></button></header>
                      <div className="chat-current"><small>Versão em revisão</small><p>{activeChatSection.content}</p></div>
                      <div className="chat-messages" aria-live="polite">
                        {activeMessages.length === 0 && <div className="chat-empty"><MessageSquareText size={22} /><strong>O que precisa mudar?</strong><p>Peça para resumir, alterar o tom, dar mais clareza ou reorganizar a resposta. O texto não pode ser editado manualmente.</p></div>}
                        {activeMessages.map((message, index) => <div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}><span>{message.role === "user" ? "Você" : "Assistente"}</span><p>{message.content}</p></div>)}
                        {chatBusy && <div className="chat-thinking"><LoaderCircle className="spin" size={16} /> Preparando uma nova versão...</div>}
                        <div ref={chatEndRef} />
                      </div>
                      {chatError && <div className="chat-error"><AlertCircle size={15} /> {chatError}</div>}
                      <div className="chat-compose"><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChatMessage(); } }} placeholder="Ex.: deixe mais direto e mantenha apenas os dois achados principais" rows={3} maxLength={8000} /><button type="button" className="button button-primary compact" onClick={() => void sendChatMessage()} disabled={!chatInput.trim() || chatBusy}><Send size={16} /> Enviar</button></div>
                    </aside>
                  )}
                </div>
              )}

              <div className="stage-actions between">
                <button type="button" className="button button-secondary" disabled={busy || chatBusy} onClick={() => setCurrentStep(2)}><ArrowLeft size={18} /> Voltar ao contexto</button>
                {!busy && generationError && <button type="button" className="button button-primary" onClick={() => void runSequence(false)}><RefreshCw size={18} /> Tentar novamente</button>}
                {!busy && allSectionsReady && <div className="generation-final-actions"><button type="button" className="button button-secondary" onClick={regenerateAll} disabled={chatBusy}><RefreshCw size={17} /> Gerar tudo novamente</button><button type="button" className="button button-primary" disabled={!allReportSectionsValidated || chatBusy} onClick={() => setCurrentStep(4)}>Conferir respostas validadas <ArrowRight size={18} /></button></div>}
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <section className="stage review-stage" aria-labelledby="review-title">
              <div className="stage-heading"><div><span className="section-kicker">04 · Conferência</span><h2 id="review-title">Respostas validadas</h2><p>Confira a versão definitiva. São exatamente estes textos que irão para o arquivo A4.</p></div></div>
              <div className="review-list compact-review">{reportSections.map((section) => <article key={section.id} className="review-card is-validated"><header><div className="review-index"><Check size={16} /></div><div className="review-title"><div><h3>{section.title}</h3><span className="validated-badge">Validada</span></div></div></header><div className="result-content"><pre>{section.content}</pre></div></article>)}</div>
              <div className="confirmation-panel"><div className="confirmation-icon"><FileCheck2 size={24} /></div><div><h3>Versão pronta para o documento</h3><p>O PDF terá o ranking e as cinco análises validadas, sem as tabelas automáticas, capa, cabeçalho ou rodapé.</p></div><button type="button" className="button button-primary" onClick={confirmFinal}><CheckCircle2 size={18} /> Confirmar e ir para o PDF</button></div>
              <div className="stage-actions"><button type="button" className="button button-secondary" onClick={() => setCurrentStep(3)}><ArrowLeft size={18} /> Voltar à validação</button></div>
            </section>
          )}

          {currentStep === 5 && (
            <section className="stage pdf-stage" aria-labelledby="pdf-title">
              <div className="stage-heading"><div><span className="section-kicker">05 · Documento final</span><h2 id="pdf-title">Gere e baixe as respostas</h2><p>O documento A4 é cru: contém o ranking e as cinco análises validadas.</p></div></div>
              {!pdfUrl ? (
                <div className="pdf-ready-panel"><div className="pdf-document-icon"><FileText size={34} /></div><div><span>Versão final confirmada</span><h3>{project.projectName}</h3><ul><li><Check size={16} /> Ranking + 5 análises</li><li><Check size={16} /> Formato A4</li><li><Check size={16} /> Sem métricas ou dados intermediários</li><li><Check size={16} /> Sem capa, cabeçalho ou rodapé</li></ul></div><button type="button" className="button button-primary button-large" disabled={pdfBusy} onClick={() => void generatePdf()}>{pdfBusy ? <LoaderCircle className="spin" size={20} /> : <FileText size={20} />}{pdfBusy ? "Criando PDF..." : "Gerar PDF"}</button></div>
              ) : (
                <div className="pdf-result"><div className="pdf-toolbar"><div><CheckCircle2 size={20} /><span><strong>PDF disponível</strong><small>{pdfName}</small></span></div><div><button type="button" className="button button-secondary compact" onClick={() => void generatePdf()} disabled={pdfBusy}><RefreshCw size={16} /> Nova versão</button><a className="button button-primary compact" href={pdfUrl} download={pdfName}><Download size={17} /> Baixar PDF</a></div></div><div className="pdf-preview"><div className="preview-label"><Eye size={16} /> Visualização do documento</div><iframe title="Prévia das respostas em PDF" src={pdfUrl} /></div></div>
              )}
              {pdfError && <div className="alert alert-error" role="alert"><AlertCircle size={20} /><div><strong>Falha na criação do PDF</strong><span>{pdfError}</span></div></div>}
              <div className="stage-actions between"><button type="button" className="button button-secondary" disabled={pdfBusy} onClick={() => setCurrentStep(4)}><ArrowLeft size={18} /> Voltar à conferência</button>{pdfUrl && <a className="button button-primary" href={pdfUrl} download={pdfName}><Download size={18} /> Baixar {pdfName}</a>}</div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
