"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Info,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AiProvider,
  AnalysisSectionId,
  AnalysisSectionResult,
  ProjectContext,
  WorkbookPayload,
} from "@/lib/types";
import {
  EMPTY_PROJECT_CONTEXT,
  SECTION_DEFINITIONS,
} from "@/lib/types";
import {
  DEFAULT_MAX_CONTEXT_CHARACTERS,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  parseWorkbookArrayBuffer,
} from "@/lib/workbook";

interface ProviderOption {
  id: AiProvider;
  label: string;
  configured: boolean;
  model: string;
}

interface RuntimeLimits {
  maxFileMb: number;
  maxContextCharacters: number;
}

const STEPS = [
  { number: 1, label: "Anexar proposta", short: "Arquivo" },
  { number: 2, label: "Informar contexto", short: "Contexto" },
  { number: 3, label: "Gerar análise", short: "Geração" },
  { number: 4, label: "Revisar resultados", short: "Revisão" },
  { number: 5, label: "Baixar PDF", short: "PDF" },
] as const;

function newSectionResults(): AnalysisSectionResult[] {
  return SECTION_DEFINITIONS.map((definition) => ({
    ...definition,
    content: "",
    originalContent: "",
    status: "idle",
    edited: false,
  }));
}

function bytesLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function fileToDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
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
  return `Analise_${normalized}_${new Date().toISOString().slice(0, 10)}.pdf`;
}

export default function AnalysisWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [workbook, setWorkbook] = useState<WorkbookPayload | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "processing" | "done" | "error"
  >("idle");
  const [uploadError, setUploadError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [project, setProject] = useState<ProjectContext>(EMPTY_PROJECT_CONTEXT);
  const [provider, setProvider] = useState<AiProvider>("xai");
  const [providers, setProviders] = useState<ProviderOption[]>([
    { id: "xai", label: "Grok / xAI", configured: false, model: "grok-4.6" },
    { id: "openai", label: "OpenAI", configured: false, model: "gpt-5.6" },
  ]);
  const [runtimeLimits, setRuntimeLimits] = useState<RuntimeLimits>({
    maxFileMb: DEFAULT_MAX_FILE_SIZE_BYTES / 1024 / 1024,
    maxContextCharacters: DEFAULT_MAX_CONTEXT_CHARACTERS,
  });
  const [sections, setSections] = useState<AnalysisSectionResult[]>(
    newSectionResults,
  );
  const [busy, setBusy] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [editingId, setEditingId] = useState<AnalysisSectionId | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [headerImage, setHeaderImage] = useState<string | undefined>();
  const [headerImageName, setHeaderImageName] = useState("");
  const [imageError, setImageError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const configuredProvider = providers.find((item) => item.id === provider);
  const pageLinkValid =
    !project.pageLink.trim() || /^https?:\/\/\S+$/i.test(project.pageLink.trim());
  const requiredFieldsReady = Boolean(
    project.proposal.trim() &&
      project.subject.trim() &&
      project.context.trim() &&
      pageLinkValid,
  );
  const allSectionsReady = sections.every(
    (section) => section.status === "done" && section.content.trim(),
  );
  const completedSections = sections.filter(
    (section) => section.status === "done",
  ).length;
  const hasManualEdits = sections.some((section) => section.edited);

  useEffect(() => {
    let active = true;
    fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data.providers)) {
          setProviders(data.providers);
          const firstConfigured = data.providers.find(
            (item: ProviderOption) => item.configured,
          );
          if (firstConfigured) setProvider(firstConfigured.id);
        }
        if (data.limits) setRuntimeLimits(data.limits);
      })
      .catch(() => undefined);

    fetch("/report-header.png", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
          return;
        }
        const dataUrl = await fileToDataUrl(await response.blob());
        if (active) {
          setHeaderImage(dataUrl);
          setHeaderImageName("report-header.png");
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const invalidateFinal = useCallback(() => {
    setConfirmed(false);
    setPdfError("");
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl("");
      setPdfName("");
    }
  }, [pdfUrl]);

  const processFile = useCallback(
    async (file?: File) => {
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
        setConfirmed(false);
        setCurrentStep(1);
      } catch (error) {
        setUploadStatus("error");
        setUploadError(
          error instanceof Error
            ? error.message
            : "Falha inesperada ao processar o arquivo.",
        );
      }
    },
    [runtimeLimits],
  );

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
    setCurrentStep(1);
    invalidateFinal();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateProject = (
    field: keyof ProjectContext,
    value: string,
  ) => {
    setProject((current) => ({ ...current, [field]: value }));
    invalidateFinal();
  };

  const handleHeaderImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageError("");
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setImageError("Use uma imagem PNG ou JPG.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError("A imagem deve ter no máximo 5 MB.");
      return;
    }
    try {
      setHeaderImage(await fileToDataUrl(file));
      setHeaderImageName(file.name);
      invalidateFinal();
    } catch (error) {
      setImageError(
        error instanceof Error ? error.message : "Não foi possível ler a imagem.",
      );
    }
  };

  const requestSection = async (
    sectionId: AnalysisSectionId,
    previousResults: Partial<Record<AnalysisSectionId, string>>,
  ) => {
    if (!workbook) throw new Error("Anexe um arquivo Excel antes de continuar.");
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
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
          contextText: workbook.contextText,
        },
        previousResults,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Não foi possível gerar esta seção.");
    }
    return String(payload.content || "").trim();
  };

  const runSequence = async (reset: boolean) => {
    if (!workbook || !requiredFieldsReady || !configuredProvider?.configured) {
      return;
    }
    setBusy(true);
    setGenerationError("");
    setCurrentStep(3);
    invalidateFinal();

    const working = reset ? newSectionResults() : sections.map((item) => ({ ...item }));
    if (reset) setSections(working);
    const previousResults: Partial<Record<AnalysisSectionId, string>> = {};

    try {
      for (const definition of SECTION_DEFINITIONS) {
        const index = working.findIndex((item) => item.id === definition.id);
        if (!reset && working[index].status === "done" && working[index].content) {
          previousResults[definition.id] = working[index].content;
          continue;
        }

        working[index] = {
          ...working[index],
          status: "running",
          error: undefined,
        };
        setSections(working.map((item) => ({ ...item })));

        try {
          const content = await requestSection(definition.id, previousResults);
          working[index] = {
            ...working[index],
            content,
            originalContent: content,
            status: "done",
            edited: false,
            error: undefined,
          };
          previousResults[definition.id] = content;
          setSections(working.map((item) => ({ ...item })));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Falha durante a geração.";
          working[index] = {
            ...working[index],
            status: "error",
            error: message,
          };
          setSections(working.map((item) => ({ ...item })));
          throw new Error(message);
        }
      }
      setCurrentStep(4);
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : "A geração foi interrompida. Seus dados foram preservados.",
      );
    } finally {
      setBusy(false);
    }
  };

  const regenerateOne = async (sectionId: AnalysisSectionId) => {
    if (busy) return;
    setBusy(true);
    setGenerationError("");
    invalidateFinal();
    setSections((current) =>
      current.map((item) =>
        item.id === sectionId
          ? { ...item, status: "running", error: undefined }
          : item,
      ),
    );
    try {
      const previousResults = Object.fromEntries(
        sections
          .filter((item) => item.content)
          .map((item) => [item.id, item.content]),
      ) as Partial<Record<AnalysisSectionId, string>>;
      const content = await requestSection(sectionId, previousResults);
      setSections((current) =>
        current.map((item) =>
          item.id === sectionId
            ? {
                ...item,
                content,
                originalContent: content,
                status: "done",
                edited: false,
                error: undefined,
              }
            : item,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Não foi possível gerar novamente.";
      setSections((current) =>
        current.map((item) =>
          item.id === sectionId
            ? { ...item, status: "error", error: message }
            : item,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (section: AnalysisSectionResult) => {
    setEditingId(section.id);
    setEditDraft(section.content);
  };

  const saveEditing = () => {
    if (!editingId || !editDraft.trim()) return;
    const definition = sections.find((item) => item.id === editingId);
    if (
      definition?.characterLimit &&
      editDraft.length > definition.characterLimit
    ) {
      return;
    }
    setSections((current) =>
      current.map((item) =>
        item.id === editingId
          ? { ...item, content: editDraft.trim(), edited: true, status: "done" }
          : item,
      ),
    );
    setEditingId(null);
    setEditDraft("");
    invalidateFinal();
  };

  const restoreOriginal = (sectionId: AnalysisSectionId) => {
    setSections((current) =>
      current.map((item) =>
        item.id === sectionId
          ? { ...item, content: item.originalContent, edited: false }
          : item,
      ),
    );
    invalidateFinal();
  };

  const regenerateAll = () => {
    if (
      hasManualEdits &&
      !window.confirm(
        "Gerar toda a análise novamente substituirá suas edições manuais. Deseja continuar?",
      )
    ) {
      return;
    }
    void runSequence(true);
  };

  const confirmFinal = () => {
    if (!allSectionsReady) return;
    setConfirmed(true);
    setCurrentStep(5);
  };

  const generatePdf = async () => {
    if (!confirmed || !allSectionsReady) return;
    setPdfBusy(true);
    setPdfError("");
    try {
      const response = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentTitle: "Relatório Câmara nas Redes",
          projectName: project.proposal,
          headerImage,
          sections: sections.map((section) => ({
            title: section.title,
            content: section.content,
          })),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Não foi possível gerar o PDF.");
      }
      const blob = await response.blob();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      const nextUrl = URL.createObjectURL(blob);
      setPdfUrl(nextUrl);
      setPdfName(
        extractPdfFileName(
          response.headers.get("content-disposition"),
          localPdfName(project.proposal),
        ),
      );
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : "Falha inesperada ao gerar o PDF.",
      );
    } finally {
      setPdfBusy(false);
    }
  };

  const stepEnabled = (step: number) => {
    if (step === 1) return true;
    if (step === 2) return Boolean(workbook);
    if (step === 3) return Boolean(workbook && requiredFieldsReady);
    if (step === 4) return allSectionsReady;
    return confirmed;
  };

  const navigateToStep = (step: number) => {
    if (!busy && !pdfBusy && stepEnabled(step)) setCurrentStep(step);
  };

  const fieldClass = (value: string, required = false) =>
    required && !value.trim() ? "field-input field-input-required" : "field-input";

  const providerNotice = useMemo(() => {
    if (configuredProvider?.configured) {
      return `${configuredProvider.label} pronto · ${configuredProvider.model}`;
    }
    return provider === "xai"
      ? "Adicione XAI_API_KEY no .env.local"
      : "Adicione OPENAI_API_KEY no .env.local";
  }, [configuredProvider, provider]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Câmara nas Redes</strong>
            <span>Análise de propostas</span>
          </div>
        </div>

        <nav className="step-navigation" aria-label="Etapas da análise">
          {STEPS.map((step) => {
            const enabled = stepEnabled(step.number);
            const complete =
              step.number < currentStep ||
              (step.number === 1 && Boolean(workbook)) ||
              (step.number === 4 && allSectionsReady) ||
              (step.number === 5 && Boolean(pdfUrl));
            return (
              <button
                type="button"
                key={step.number}
                className={`step-link ${currentStep === step.number ? "active" : ""} ${complete ? "complete" : ""}`}
                onClick={() => navigateToStep(step.number)}
                disabled={!enabled || busy || pdfBusy}
                aria-current={currentStep === step.number ? "step" : undefined}
              >
                <span className="step-number">
                  {complete ? <Check size={14} strokeWidth={3} /> : step.number}
                </span>
                <span className="step-copy">
                  <small>Etapa {step.number}</small>
                  <strong>{step.label}</strong>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-security">
          <ShieldCheck size={18} />
          <div>
            <strong>Processamento seguro</strong>
            <span>As chaves ficam somente no servidor.</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Central de análise</p>
            <h1>{STEPS[currentStep - 1].label}</h1>
          </div>
          <div className={`provider-pill ${configuredProvider?.configured ? "ready" : "warning"}`}>
            <span className="provider-dot" />
            <div>
              <small>Motor ativo</small>
              <strong>{providerNotice}</strong>
            </div>
          </div>
        </header>

        <div className="mobile-steps" aria-label="Progresso">
          {STEPS.map((step) => (
            <button
              type="button"
              key={step.number}
              className={currentStep === step.number ? "active" : ""}
              disabled={!stepEnabled(step.number) || busy || pdfBusy}
              onClick={() => navigateToStep(step.number)}
            >
              <span>{step.number}</span>
              {step.short}
            </button>
          ))}
        </div>

        <div className="workspace-content">
          {currentStep === 1 && (
            <section className="stage" aria-labelledby="upload-title">
              <div className="stage-heading">
                <div>
                  <span className="section-kicker">01 · Proposta</span>
                  <h2 id="upload-title">Anexe a base de postagens</h2>
                  <p>
                    O sistema valida o arquivo, lê todas as planilhas utilizáveis e
                    organiza os registros antes da análise.
                  </p>
                </div>
                <span className="format-chip">XLSX / XLS · até {runtimeLimits.maxFileMb} MB</span>
              </div>

              {!workbook && (
                <div
                  className={`upload-zone ${dragActive ? "drag-active" : ""} ${uploadStatus === "error" ? "has-error" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                >
                  {uploadStatus === "processing" ? (
                    <>
                      <div className="upload-icon processing">
                        <LoaderCircle size={30} className="spin" />
                      </div>
                      <h3>Processando a proposta</h3>
                      <p>Validando planilhas, cabeçalhos, linhas e colunas.</p>
                    </>
                  ) : (
                    <>
                      <div className="upload-icon">
                        <UploadCloud size={30} />
                      </div>
                      <h3>Arraste o Excel para esta área</h3>
                      <p>ou selecione o arquivo no seu computador</p>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <FileSpreadsheet size={18} />
                        Selecionar arquivo
                      </button>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={(event) => void processFile(event.target.files?.[0])}
                    hidden
                  />
                </div>
              )}

              {uploadStatus === "error" && uploadError && (
                <div className="alert alert-error" role="alert">
                  <AlertCircle size={20} />
                  <div>
                    <strong>O arquivo não pôde ser utilizado</strong>
                    <span>{uploadError}</span>
                  </div>
                  <button type="button" onClick={() => setUploadError("")} aria-label="Fechar aviso">
                    <X size={18} />
                  </button>
                </div>
              )}

              {workbook && (
                <div className="file-summary">
                  <div className="file-summary-top">
                    <div className="file-badge"><FileSpreadsheet size={24} /></div>
                    <div className="file-name">
                      <span>Arquivo processado</span>
                      <strong>{workbook.fileName}</strong>
                      <small>{bytesLabel(workbook.fileSize)} · {workbook.extension.toUpperCase().slice(1)}</small>
                    </div>
                    <div className="file-state"><CheckCircle2 size={17} /> Pronto</div>
                    <div className="file-actions">
                      <button type="button" onClick={() => fileInputRef.current?.click()}>
                        <RefreshCw size={16} /> Substituir
                      </button>
                      <button type="button" className="danger" onClick={removeWorkbook}>
                        <Trash2 size={16} /> Remover
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(event) => void processFile(event.target.files?.[0])}
                      hidden
                    />
                  </div>

                  <div className="metrics-grid">
                    <div><span>Planilhas encontradas</span><strong>{workbook.totalSheets}</strong></div>
                    <div><span>Planilhas analisáveis</span><strong>{workbook.usableSheets}</strong></div>
                    <div><span>Registros reconhecidos</span><strong>{workbook.recordCount.toLocaleString("pt-BR")}</strong></div>
                    <div><span>Repetições pré-marcadas</span><strong>{workbook.duplicateCount.toLocaleString("pt-BR")}</strong></div>
                  </div>

                  {workbook.warnings.length > 0 && (
                    <div className="warning-list">
                      <Info size={18} />
                      <div>
                        <strong>Avisos da leitura</strong>
                        <ul>
                          {workbook.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="stage-actions end">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!workbook}
                  onClick={() => setCurrentStep(2)}
                >
                  Continuar para o contexto <ArrowRight size={18} />
                </button>
              </div>
            </section>
          )}

          {currentStep === 2 && (
            <section className="stage" aria-labelledby="context-title">
              <div className="stage-heading">
                <div>
                  <span className="section-kicker">02 · Contexto</span>
                  <h2 id="context-title">Complete as informações do projeto</h2>
                  <p>
                    Os campos abaixo entram no contexto dos sete comandos. Os itens
                    marcados com asterisco são obrigatórios.
                  </p>
                </div>
              </div>

              <div className="context-layout">
                <div className="form-panel">
                  <div className="form-section-heading">
                    <h3>Identificação</h3>
                    <span>Base principal</span>
                  </div>
                  <div className="form-grid">
                    <label>
                      <span>Proposta ou nome do projeto *</span>
                      <input
                        className={fieldClass(project.proposal, true)}
                        value={project.proposal}
                        onChange={(event) => updateProject("proposal", event.target.value)}
                        placeholder="Ex.: PL 1234/2026"
                        maxLength={240}
                      />
                    </label>
                    <label>
                      <span>Tipo ou categoria</span>
                      <input
                        className="field-input"
                        value={project.category}
                        onChange={(event) => updateProject("category", event.target.value)}
                        placeholder="Ex.: Projeto de lei"
                        maxLength={240}
                      />
                    </label>
                    <label className="span-2">
                      <span>Assunto da proposta *</span>
                      <textarea
                        className={fieldClass(project.subject, true)}
                        value={project.subject}
                        onChange={(event) => updateProject("subject", event.target.value)}
                        placeholder="Explique de forma objetiva o tema tratado pela proposta."
                        rows={3}
                        maxLength={2000}
                      />
                    </label>
                    <label>
                      <span>Link da página</span>
                      <input
                        className={`field-input ${pageLinkValid ? "" : "field-input-invalid"}`}
                        type="url"
                        value={project.pageLink}
                        onChange={(event) => updateProject("pageLink", event.target.value)}
                        placeholder="https://www.camara.leg.br/..."
                        maxLength={2000}
                        aria-invalid={!pageLinkValid}
                      />
                      {!pageLinkValid && <small className="field-error">Informe um endereço iniciado por http:// ou https://.</small>}
                    </label>
                    <label>
                      <span>Prazo ou período</span>
                      <input
                        className="field-input"
                        value={project.period}
                        onChange={(event) => updateProject("period", event.target.value)}
                        placeholder="Ex.: 18 a 24 de agosto de 2026"
                        maxLength={500}
                      />
                    </label>
                  </div>

                  <div className="form-section-heading separated">
                    <h3>Situação e objetivo</h3>
                    <span>Contexto analítico</span>
                  </div>
                  <div className="form-grid">
                    <label className="span-2">
                      <span>Contexto que levou à análise *</span>
                      <textarea
                        className={fieldClass(project.context, true)}
                        value={project.context}
                        onChange={(event) => updateProject("context", event.target.value)}
                        placeholder="Descreva por que a proposta está sendo analisada neste período."
                        rows={4}
                        maxLength={8000}
                      />
                    </label>
                    <label>
                      <span>Situação atual</span>
                      <textarea
                        className="field-input"
                        value={project.currentSituation}
                        onChange={(event) => updateProject("currentSituation", event.target.value)}
                        placeholder="Ex.: em discussão, votação prevista..."
                        rows={3}
                        maxLength={2000}
                      />
                    </label>
                    <label>
                      <span>Objetivo principal</span>
                      <textarea
                        className="field-input"
                        value={project.objective}
                        onChange={(event) => updateProject("objective", event.target.value)}
                        placeholder="Qual decisão ou leitura este relatório deve apoiar?"
                        rows={3}
                        maxLength={4000}
                      />
                    </label>
                    <label>
                      <span>Área ou setor responsável</span>
                      <input
                        className="field-input"
                        value={project.responsibleArea}
                        onChange={(event) => updateProject("responsibleArea", event.target.value)}
                        placeholder="Ex.: CCI / Direx"
                        maxLength={500}
                      />
                    </label>
                    <label>
                      <span>Público relacionado</span>
                      <input
                        className="field-input"
                        value={project.relatedAudience}
                        onChange={(event) => updateProject("relatedAudience", event.target.value)}
                        placeholder="Ex.: cidadãos e tomadores de decisão"
                        maxLength={2000}
                      />
                    </label>
                  </div>

                  <div className="form-section-heading separated">
                    <h3>Dados complementares</h3>
                    <span>Comandos 4, 6 e 7</span>
                  </div>
                  <div className="form-grid">
                    <label className="span-2">
                      <span>Tabela de pontos de engajamento por canal</span>
                      <textarea
                        className="field-input mono-input"
                        value={project.engagementByChannel}
                        onChange={(event) => updateProject("engagementByChannel", event.target.value)}
                        placeholder={"Canal | Pontos de engajamento\nInstagram | 12.450\nX/Twitter | 8.320"}
                        rows={5}
                        maxLength={20000}
                      />
                      <small>Cole aqui a tabela recebida por e-mail. Sem ela, o sistema não inventará valores.</small>
                    </label>
                    <label className="span-2">
                      <span>Contexto e fatos do período</span>
                      <textarea
                        className="field-input"
                        value={project.facts}
                        onChange={(event) => updateProject("facts", event.target.value)}
                        placeholder="Inclua acontecimentos que possam ter relação com a mobilização."
                        rows={4}
                        maxLength={12000}
                      />
                    </label>
                    <label className="span-2">
                      <span>Informações complementares</span>
                      <textarea
                        className="field-input"
                        value={project.additionalInfo}
                        onChange={(event) => updateProject("additionalInfo", event.target.value)}
                        placeholder="Orientações adicionais que sejam necessárias para interpretar os dados."
                        rows={3}
                        maxLength={8000}
                      />
                    </label>
                  </div>
                </div>

                <aside className="settings-panel">
                  <div className="setting-card">
                    <div className="setting-icon"><Sparkles size={20} /></div>
                    <h3>Motor de inteligência</h3>
                    <p>Escolha a API que executará os sete comandos no backend.</p>
                    <div className="provider-options">
                      {providers.map((option) => (
                        <label key={option.id} className={provider === option.id ? "selected" : ""}>
                          <input
                            type="radio"
                            name="provider"
                            value={option.id}
                            checked={provider === option.id}
                            onChange={() => setProvider(option.id)}
                          />
                          <span className="radio-visual"><Circle size={12} /></span>
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.model}</small>
                          </span>
                          <em className={option.configured ? "configured" : "not-configured"}>
                            {option.configured ? "Pronto" : "Sem chave"}
                          </em>
                        </label>
                      ))}
                    </div>
                    <div className={`config-note ${configuredProvider?.configured ? "success" : "warning"}`}>
                      <LockKeyhole size={16} /> {providerNotice}
                    </div>
                  </div>

                  <div className="setting-card">
                    <div className="setting-icon"><ImagePlus size={20} /></div>
                    <h3>Cabeçalho do PDF</h3>
                    <p>A imagem será aplicada somente no topo da primeira página.</p>
                    {headerImage ? (
                      <div className="header-preview">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={headerImage} alt="Prévia do cabeçalho do relatório" />
                        <div>
                          <span>{headerImageName}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setHeaderImage(undefined);
                              setHeaderImageName("");
                              if (imageInputRef.current) imageInputRef.current.value = "";
                              invalidateFinal();
                            }}
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="image-upload-button"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        <ImagePlus size={18} /> Selecionar PNG ou JPG
                      </button>
                    )}
                    {headerImage && (
                      <button
                        type="button"
                        className="text-button full"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        Trocar imagem
                      </button>
                    )}
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(event) => void handleHeaderImage(event)}
                      hidden
                    />
                    {imageError && <span className="inline-error">{imageError}</span>}
                  </div>
                </aside>
              </div>

              {!requiredFieldsReady && (
                <div className="alert alert-info">
                  <Info size={20} />
                  <div>
                    <strong>Preenchimento pendente</strong>
                    <span>Informe proposta, assunto e contexto e corrija qualquer campo inválido para liberar a geração.</span>
                  </div>
                </div>
              )}
              {!configuredProvider?.configured && (
                <div className="alert alert-warning">
                  <AlertCircle size={20} />
                  <div>
                    <strong>API ainda não configurada</strong>
                    <span>{providerNotice}. As instruções estão no README do projeto.</span>
                  </div>
                </div>
              )}

              <div className="stage-actions between">
                <button type="button" className="button button-secondary" onClick={() => setCurrentStep(1)}>
                  <ArrowLeft size={18} /> Voltar
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!requiredFieldsReady || !configuredProvider?.configured || busy}
                  onClick={() => void runSequence(true)}
                >
                  <Sparkles size={18} /> Gerar análise
                </button>
              </div>
            </section>
          )}

          {currentStep === 3 && (
            <section className="stage generation-stage" aria-labelledby="generation-title">
              <div className="stage-heading">
                <div>
                  <span className="section-kicker">03 · Processamento</span>
                  <h2 id="generation-title">Executando os sete comandos</h2>
                  <p>
                    As respostas são geradas na ordem correta e cada dependência é
                    repassada somente quando necessária.
                  </p>
                </div>
                <div className="progress-number">
                  <strong>{completedSections}</strong><span>/ 7 concluídos</span>
                </div>
              </div>

              <div className="generation-progress" aria-label={`${completedSections} de 7 comandos concluídos`}>
                <span style={{ width: `${(completedSections / 7) * 100}%` }} />
              </div>

              <div className="command-list">
                {sections.map((section) => (
                  <article key={section.id} className={`command-row ${section.status}`}>
                    <div className="command-status-icon">
                      {section.status === "done" && <CheckCircle2 size={20} />}
                      {section.status === "running" && <LoaderCircle className="spin" size={20} />}
                      {section.status === "error" && <AlertCircle size={20} />}
                      {section.status === "idle" && <Circle size={19} />}
                    </div>
                    <div className="command-copy">
                      <span>Comando {section.command}</span>
                      <strong>{section.title}</strong>
                      <small>
                        {section.status === "running" && "Analisando os dados e preparando a resposta..."}
                        {section.status === "done" && `${section.content.length.toLocaleString("pt-BR")} caracteres gerados`}
                        {section.status === "idle" && "Aguardando a etapa anterior"}
                        {section.status === "error" && section.error}
                      </small>
                    </div>
                    <span className="command-state">
                      {section.status === "done" ? "Concluído" : section.status === "running" ? "Em andamento" : section.status === "error" ? "Falhou" : "Pendente"}
                    </span>
                  </article>
                ))}
              </div>

              {generationError && (
                <div className="alert alert-error" role="alert">
                  <AlertCircle size={20} />
                  <div>
                    <strong>A geração foi interrompida</strong>
                    <span>{generationError} Os dados preenchidos continuam salvos nesta tela.</span>
                  </div>
                </div>
              )}

              <div className="stage-actions between">
                <button type="button" className="button button-secondary" disabled={busy} onClick={() => setCurrentStep(2)}>
                  <ArrowLeft size={18} /> Voltar ao contexto
                </button>
                {!busy && generationError && (
                  <button type="button" className="button button-primary" onClick={() => void runSequence(false)}>
                    <RefreshCw size={18} /> Tentar novamente
                  </button>
                )}
                {!busy && allSectionsReady && (
                  <button type="button" className="button button-primary" onClick={() => setCurrentStep(4)}>
                    Revisar resultados <ArrowRight size={18} />
                  </button>
                )}
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <section className="stage review-stage" aria-labelledby="review-title">
              <div className="stage-heading">
                <div>
                  <span className="section-kicker">04 · Revisão</span>
                  <h2 id="review-title">Revise antes de confirmar</h2>
                  <p>
                    Edite qualquer resposta, restaure o texto gerado ou execute novamente
                    somente a seção necessária.
                  </p>
                </div>
                <button type="button" className="button button-secondary compact" disabled={busy} onClick={regenerateAll}>
                  <RefreshCw size={17} /> Gerar tudo novamente
                </button>
              </div>

              <div className="review-list">
                {sections.map((section) => {
                  const isEditing = editingId === section.id;
                  const overLimit = Boolean(
                    section.characterLimit && editDraft.length > section.characterLimit,
                  );
                  return (
                    <article key={section.id} className="review-card">
                      <header>
                        <div className="review-index">{String(section.command).padStart(2, "0")}</div>
                        <div className="review-title">
                          <div>
                            <h3>{section.title}</h3>
                            {section.edited && <span className="edited-badge">Editado manualmente</span>}
                          </div>
                          <p>{section.description}</p>
                        </div>
                        <div className="review-actions">
                          {!isEditing && (
                            <>
                              <button type="button" onClick={() => startEditing(section)} disabled={busy}>
                                <Pencil size={16} /> Editar
                              </button>
                              <button type="button" onClick={() => void regenerateOne(section.id)} disabled={busy}>
                                <RefreshCw size={16} /> Gerar de novo
                              </button>
                            </>
                          )}
                        </div>
                      </header>

                      {section.status === "running" ? (
                        <div className="review-loading"><LoaderCircle className="spin" size={22} /> Gerando nova resposta...</div>
                      ) : section.status === "error" ? (
                        <div className="review-error"><AlertCircle size={20} /> {section.error}</div>
                      ) : isEditing ? (
                        <div className="editor-wrap">
                          <textarea
                            value={editDraft}
                            onChange={(event) => setEditDraft(event.target.value)}
                            rows={Math.min(22, Math.max(8, editDraft.split("\n").length + 3))}
                            autoFocus
                          />
                          <div className="editor-footer">
                            <span className={overLimit ? "over-limit" : ""}>
                              {editDraft.length.toLocaleString("pt-BR")}
                              {section.characterLimit ? ` / ${section.characterLimit} caracteres` : " caracteres"}
                            </span>
                            <div>
                              <button
                                type="button"
                                className="button button-ghost compact"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditDraft("");
                                }}
                              >
                                <X size={16} /> Cancelar
                              </button>
                              <button
                                type="button"
                                className="button button-primary compact"
                                disabled={!editDraft.trim() || overLimit}
                                onClick={saveEditing}
                              >
                                <Save size={16} /> Salvar edição
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="result-content">
                          <pre>{section.content}</pre>
                          <footer>
                            <span className={section.characterLimit && section.content.length > section.characterLimit ? "over-limit" : ""}>
                              {section.content.length.toLocaleString("pt-BR")}
                              {section.characterLimit ? ` / ${section.characterLimit}` : ""} caracteres
                            </span>
                            {section.edited && (
                              <button type="button" onClick={() => restoreOriginal(section.id)}>
                                Restaurar resposta gerada
                              </button>
                            )}
                          </footer>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="confirmation-panel">
                <div className="confirmation-icon"><FileCheck2 size={24} /></div>
                <div>
                  <h3>Versão pronta para o documento?</h3>
                  <p>O PDF usará somente os sete títulos e as respostas confirmadas acima.</p>
                </div>
                <button type="button" className="button button-primary" disabled={!allSectionsReady || busy || Boolean(editingId)} onClick={confirmFinal}>
                  <CheckCircle2 size={18} /> Confirmar versão final
                </button>
              </div>
            </section>
          )}

          {currentStep === 5 && (
            <section className="stage pdf-stage" aria-labelledby="pdf-title">
              <div className="stage-heading">
                <div>
                  <span className="section-kicker">05 · Documento final</span>
                  <h2 id="pdf-title">Gere e baixe o relatório</h2>
                  <p>
                    O documento A4 contém apenas o cabeçalho, o nome da proposta,
                    os resultados aprovados e a paginação.
                  </p>
                </div>
              </div>

              {!pdfUrl ? (
                <div className="pdf-ready-panel">
                  <div className="pdf-document-icon"><FileText size={34} /></div>
                  <div>
                    <span>Versão final confirmada</span>
                    <h3>{project.proposal}</h3>
                    <ul>
                      <li><Check size={16} /> {sections.length} seções aprovadas</li>
                      <li><Check size={16} /> Layout A4 e páginas numeradas</li>
                      <li><Check size={16} /> Sem prompts, dados brutos ou indicação de IA</li>
                      <li><Check size={16} /> {headerImage ? "Imagem de cabeçalho incluída" : "Cabeçalho tipográfico aplicado"}</li>
                    </ul>
                  </div>
                  <button type="button" className="button button-primary button-large" disabled={pdfBusy} onClick={() => void generatePdf()}>
                    {pdfBusy ? <LoaderCircle className="spin" size={20} /> : <FileText size={20} />}
                    {pdfBusy ? "Criando PDF..." : "Gerar PDF"}
                  </button>
                </div>
              ) : (
                <div className="pdf-result">
                  <div className="pdf-toolbar">
                    <div>
                      <CheckCircle2 size={20} />
                      <span><strong>PDF disponível</strong><small>{pdfName}</small></span>
                    </div>
                    <div>
                      <button type="button" className="button button-secondary compact" onClick={() => void generatePdf()} disabled={pdfBusy}>
                        <RefreshCw size={16} /> Nova versão
                      </button>
                      <a className="button button-primary compact" href={pdfUrl} download={pdfName}>
                        <Download size={17} /> Baixar PDF
                      </a>
                    </div>
                  </div>
                  <div className="pdf-preview">
                    <div className="preview-label"><Eye size={16} /> Visualização do documento</div>
                    <iframe title="Prévia do relatório em PDF" src={pdfUrl} />
                  </div>
                </div>
              )}

              {pdfError && (
                <div className="alert alert-error" role="alert">
                  <AlertCircle size={20} />
                  <div><strong>Falha na criação do PDF</strong><span>{pdfError}</span></div>
                </div>
              )}

              <div className="stage-actions between">
                <button type="button" className="button button-secondary" disabled={pdfBusy} onClick={() => setCurrentStep(4)}>
                  <ArrowLeft size={18} /> Voltar à revisão
                </button>
                {pdfUrl && (
                  <a className="button button-primary" href={pdfUrl} download={pdfName}>
                    <Download size={18} /> Baixar {pdfName}
                  </a>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
