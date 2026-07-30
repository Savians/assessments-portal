"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import {
  AssessmentApiError,
  completeDocumentUpload,
  createDocumentPreviewUrl,
  createDocumentUploadUrl,
  loadDocuments,
  removeDocument,
  uploadDocumentFile,
  type AssessmentDocument,
  type DocumentCategory
} from "@/services/assessment-api";
import { getCurrentPortalAccessToken } from "@/services/portal-auth";
import { Button, Card, ErrorAlert, LoadingOverlay, StatusBadge, cn } from "@/components/ui";
import { isRequiredReviewDocument } from "@/lib/review-readiness";

const maxFileSizeBytes = 25 * 1024 * 1024;

const documentFolders: Array<{
  category: DocumentCategory;
  label: string;
  helper: string;
}> = [
  {
    category: "TAX_RETURNS",
    label: "Prior Tax Returns Documents",
    helper: "Last year and any prior returns we should review."
  },
  {
    category: "W2_INCOME",
    label: "W-2 Income Documents",
    helper: "Employer W-2s and salary income documents."
  },
  {
    category: "OTHER_INCOME",
    label: "Other Income Documents",
    helper: "1099s, K-1s, rental, side income, and miscellaneous income."
  },
  {
    category: "INVESTMENT_PORTFOLIO",
    label: "Investment Portfolio Documents",
    helper: "Brokerage, capital gains, dividends, and portfolio statements."
  },
  {
    category: "RETIREMENT_ACCOUNTS",
    label: "Retirement Accounts Documents",
    helper: "IRA, 401(k), pension, rollover, and distribution documents."
  },
  {
    category: "MORTGAGE_STATEMENTS",
    label: "Mortgage Statements Documents",
    helper: "Mortgage interest, property tax, and closing statements."
  },
  {
    category: "BUSINESS_LLC_DOCUMENTS",
    label: "Business / LLC Documents",
    helper: "LLC, S-Corp, partnership, P&L, bookkeeping, and entity records."
  },
  {
    category: "ESTATE_PLAN",
    label: "Estate Plan Documents",
    helper: "Trust, will, estate, gifting, and beneficiary documents."
  },
  {
    category: "LIFE_INSURANCE",
    label: "Life Insurance Documents",
    helper: "Policy documents, premium notices, and cash-value statements."
  },
  {
    category: "OTHER_ASSESSMENT_DETAILS",
    label: "Other Assessment Details Documents",
    helper: "Anything else that may help Savians complete your assessment."
  }
];

const categoryLabels = Object.fromEntries(
  documentFolders.map((folder) => [folder.category, folder.label])
) as Record<DocumentCategory, string>;

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isUploaded(document: AssessmentDocument) {
  return document.status === "UPLOADED" || document.status === "CLEAN";
}

function canInlinePreview(document: AssessmentDocument) {
  return document.mimeType === "application/pdf" || document.mimeType.startsWith("image/");
}

export function PortalDocumentsClient({
  embedded = false,
  onDocumentsChanged
}: {
  embedded?: boolean;
  onDocumentsChanged?: (documents: AssessmentDocument[]) => void;
}) {
  const [documents, setDocuments] = useState<AssessmentDocument[]>([]);
  const [activeCategory, setActiveCategory] = useState<DocumentCategory>("TAX_RETURNS");
  const [dragCategory, setDragCategory] = useState<DocumentCategory | null>(null);
  const [uploadingCategory, setUploadingCategory] = useState<DocumentCategory | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ document: AssessmentDocument; url: string } | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadedDocuments = useMemo(() => documents.filter(isUploaded), [documents]);

  const documentsByCategory = useMemo(() => {
    const grouped = new Map<DocumentCategory, AssessmentDocument[]>();
    for (const folder of documentFolders) grouped.set(folder.category, []);
    for (const document of uploadedDocuments) {
      grouped.set(document.category, [...(grouped.get(document.category) ?? []), document]);
    }
    for (const [category, categoryDocuments] of grouped) {
      grouped.set(
        category,
        categoryDocuments.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      );
    }
    return grouped;
  }, [uploadedDocuments]);

  const activeFolder = documentFolders.find((folder) => folder.category === activeCategory) ?? documentFolders[0]!;
  const activeFolderRequired = isRequiredReviewDocument(activeFolder.category);
  const activeDocuments = documentsByCategory.get(activeCategory) ?? [];
  const isDraggingActiveFolder = dragCategory === activeCategory;
  const isUploadingActiveFolder = uploadingCategory === activeCategory;
  const activeInputId = `document-upload-${activeCategory.toLowerCase()}`;

  const resolvePortalToken = useCallback(async () => {
    const freshToken = await getCurrentPortalAccessToken();
    if (!freshToken) throw new AssessmentApiError("Your secure portal session expired. Please sign in again from the profile page.");
    return freshToken;
  }, []);

  const refresh = useCallback(async (showSuccess = false) => {
    setLoading(true);
    setError(null);
    if (showSuccess) setMessage(null);
    try {
      const activeToken = await resolvePortalToken();
      const response = await loadDocuments(activeToken);
      setDocuments(response.documents);
      onDocumentsChanged?.(response.documents);
      if (showSuccess) setMessage("Documents refreshed.");
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not load your document list.");
    } finally {
      setLoading(false);
    }
  }, [onDocumentsChanged, resolvePortalToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => setMessage(null), 2_000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  async function openPreview(document: AssessmentDocument) {
    setPreviewLoadingId(document.id);
    setError(null);
    try {
      const activeToken = await resolvePortalToken();
      const prepared = await createDocumentPreviewUrl(activeToken, document.id);
      setPreview({ document, url: prepared.previewUrl });
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not open this document preview.");
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function uploadFiles(category: DocumentCategory, rawFiles: FileList | File[]) {
    const files = Array.from(rawFiles).filter(Boolean);
    if (files.length === 0) return;

    const oversized = files.find((selectedFile) => selectedFile.size > maxFileSizeBytes);
    if (oversized) {
      setError(`${oversized.name} is larger than 25 MB. Please upload a smaller file.`);
      setMessage(null);
      return;
    }

    setActiveCategory(category);
    setUploadingCategory(category);
    setError(null);
    setMessage(null);

    const completedDocuments: AssessmentDocument[] = [];
    try {
      const activeToken = await resolvePortalToken();
      for (const selectedFile of files) {
        setUploadingFileName(selectedFile.name);
        const prepared = await createDocumentUploadUrl(activeToken, {
          category,
          fileName: selectedFile.name,
          contentType: selectedFile.type || "application/octet-stream",
          sizeBytes: selectedFile.size
        });
        await uploadDocumentFile(prepared.uploadUrl, selectedFile);
        const completed = await completeDocumentUpload(activeToken, {
          documentId: prepared.documentId,
          sizeBytes: selectedFile.size
        });
        completedDocuments.push(completed.document);
      }

      const uploadedIds = new Set(completedDocuments.map((document) => document.id));
      const nextDocuments = [
        ...completedDocuments,
        ...documents.filter((document) => !uploadedIds.has(document.id))
      ];
      setDocuments(nextDocuments);
      onDocumentsChanged?.(nextDocuments);
      setMessage(`${pluralize(completedDocuments.length, "document")} uploaded to ${categoryLabels[category]}.`);
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not upload this document.");
    } finally {
      setUploadingCategory(null);
      setUploadingFileName(null);
      setDragCategory(null);
    }
  }

  async function handleRemoveDocument(document: AssessmentDocument) {
    setRemovingId(document.id);
    setError(null);
    setMessage(null);
    try {
      const activeToken = await resolvePortalToken();
      await removeDocument(activeToken, document.id);
      const nextDocuments = documents.filter((item) => item.id !== document.id);
      setDocuments(nextDocuments);
      onDocumentsChanged?.(nextDocuments);
      if (preview?.document.id === document.id) setPreview(null);
      setMessage(`${document.originalName} was removed from ${categoryLabels[document.category]}.`);
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not remove this document.");
    } finally {
      setRemovingId(null);
    }
  }

  function handleInputChange(category: DocumentCategory, event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = event.target.files;
    if (selectedFiles) void uploadFiles(category, selectedFiles);
    event.target.value = "";
  }

  function handleDragOver(category: DocumentCategory, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragCategory(category);
  }

  function handleDrop(category: DocumentCategory, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const droppedFiles = event.dataTransfer.files;
    if (droppedFiles) void uploadFiles(category, droppedFiles);
  }

  return (
    <section className={embedded ? "w-full" : "mx-auto min-h-[75vh] w-full max-w-[1500px] px-5 py-12 sm:px-8 sm:py-16"}>
      {(loading || uploadingCategory || previewLoadingId) && (
        <LoadingOverlay
          label={
            uploadingCategory
              ? `Uploading ${uploadingFileName ?? "document"}`
              : previewLoadingId
                ? "Preparing preview"
                : "Loading documents"
          }
        />
      )}
      {error || message ? (
        <div className="grid gap-3">
          {error ? <ErrorAlert>{error}</ErrorAlert> : null}
          {message ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 aria-hidden size={18} />
              <span>{message}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-5 lg:items-stretch lg:grid-cols-[290px_minmax(0,1fr)]",
          (error || message) && "mt-4"
        )}
      >
        <Card className="flex min-h-0 flex-col p-4 lg:[contain:size]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Document Drive</p>
              <h2 className="mt-1 text-lg font-bold text-navy-800">Categories</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Prior Tax Returns and W-2 Income are required before Submit for Review.
              </p>
            </div>
            <Button type="button" variant="outline" className="min-h-10 px-3" onClick={() => void refresh(true)} disabled={loading} aria-label="Refresh document categories">
              <RefreshCw aria-hidden size={16} />
            </Button>
          </div>

          <ol className="mt-4 grid gap-0 lg:min-h-0 lg:flex-1 lg:content-start lg:overflow-y-auto lg:px-1" aria-label="Suggested document upload order">
            {documentFolders.map((folder, index) => {
              const isActive = folder.category === activeCategory;
              const isRequired = isRequiredReviewDocument(folder.category);
              const stepNumber = String(index + 1).padStart(2, "0");
              return (
                <li
                  key={folder.category}
                  className="document-sequence-step relative pb-2 last:pb-0"
                  data-active={isActive ? "true" : "false"}
                >
                  <button
                    className="document-sequence-card focus-ring group grid min-h-14 w-full grid-cols-[36px_minmax(0,1fr)_24px] items-stretch overflow-hidden rounded-[14px] border text-left"
                    type="button"
                    aria-current={isActive ? "step" : undefined}
                    aria-label={`Step ${index + 1} of ${documentFolders.length}: ${folder.label}${isRequired ? " (Required)" : ""}`}
                    data-active={isActive ? "true" : "false"}
                    data-required={isRequired ? "true" : "false"}
                    onClick={() => {
                      setActiveCategory(folder.category);
                      setError(null);
                    }}
                  >
                    <span aria-hidden className="document-sequence-marker grid place-items-center text-[11px] font-extrabold tracking-[0.08em]">
                      {stepNumber}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2.5">
                      <span className="document-sequence-title block text-[13px] font-bold leading-[17px]">{folder.label}</span>
                      {isRequired ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-red-700">
                          Required
                        </span>
                      ) : null}
                    </span>
                    <span aria-hidden className="document-sequence-direction grid place-items-center">
                      <ChevronRight className="document-sequence-chevron" size={17} strokeWidth={2.4} />
                    </span>
                  </button>
                  {index < documentFolders.length - 1 ? (
                    <span
                      aria-hidden
                      className="document-sequence-connector pointer-events-none absolute bottom-0 left-0 h-2 w-9"
                      data-upload-sequence-connector
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-700">
                <FolderOpen aria-hidden size={34} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Selected Folder</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-bold text-navy-800">{activeFolder.label}</h2>
                  {activeFolderRequired ? (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-red-700">
                      Required for review
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{activeFolder.helper}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={activeDocuments.length > 0 ? "complete" : "pending"}>
                {pluralize(activeDocuments.length, "file")}
              </StatusBadge>
              <span className="inline-flex min-h-9 items-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-600">
                Max 25 MB per file
              </span>
              <input
                id={activeInputId}
                className="sr-only"
                type="file"
                multiple
                onChange={(event) => handleInputChange(activeCategory, event)}
              />
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(260px,0.85fr)_minmax(320px,1.15fr)]">
            <div
              className={cn(
                "grid min-h-[440px] place-items-center rounded-3xl border-2 border-dashed p-8 text-center transition",
                isDraggingActiveFolder
                  ? "border-gold-500 bg-gold-50 text-gold-900"
                  : "border-slate-300 bg-gradient-to-b from-slate-50 to-white text-slate-600",
                isUploadingActiveFolder && "border-emerald-300 bg-emerald-50"
              )}
              onDragOver={(event) => handleDragOver(activeCategory, event)}
              onDragLeave={() => setDragCategory(null)}
              onDrop={(event) => handleDrop(activeCategory, event)}
            >
              <div>
                <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white text-navy-800 shadow-sm">
                  <UploadCloud aria-hidden size={34} />
                </span>
                <h3 className="mt-5 text-xl font-bold text-navy-800">
                  {isDraggingActiveFolder ? "Drop Files Here" : "Drag & Drop Files"}
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-6">
                  Add files directly into {activeFolder.label}. PDF, images, spreadsheets, Word documents, and tax/supporting files are accepted.
                </p>
                <label
                  className="focus-ring mt-5 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-navy-800 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 transition hover:bg-navy-50"
                  htmlFor={activeInputId}
                >
                  <Plus aria-hidden size={17} />
                  Browse Files
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-3 px-1">
                <div>
                  <h3 className="font-bold text-navy-800">Uploaded Files</h3>
                  <p className="mt-1 text-xs text-slate-500">Documents in this folder.</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                  {formatBytes(activeDocuments.reduce((total, document) => total + document.sizeBytes, 0))}
                </span>
              </div>

              <div className="mt-4 max-h-[520px] min-h-[360px] space-y-3 overflow-y-auto pr-1">
                {activeDocuments.length === 0 ? (
                  <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
                    <div>
                      <FileText aria-hidden className="mx-auto text-slate-400" size={38} />
                      <h4 className="mt-3 font-bold text-navy-800">No Documents Yet</h4>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        Upload or drag files into this folder and they will appear here.
                      </p>
                    </div>
                  </div>
                ) : (
                  activeDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-gold-300 hover:shadow-card"
                    >
                      <button
                        className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
                        type="button"
                        onClick={() => void openPreview(document)}
                      >
                        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold-50 text-gold-700">
                          <FileText aria-hidden size={20} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-navy-800">{document.originalName}</span>
                          <span className="block text-sm text-slate-600">
                            {formatBytes(document.sizeBytes)} · {document.status} · {formatTimestamp(document.createdAt)}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="focus-ring grid size-10 place-items-center rounded-full border border-navy-800 bg-white text-navy-800 transition hover:bg-navy-50"
                          onClick={() => void openPreview(document)}
                          aria-label={`Preview ${document.originalName}`}
                          title="Preview"
                        >
                          <Eye aria-hidden size={16} />
                        </button>
                        <button
                          type="button"
                          className="focus-ring grid size-10 place-items-center rounded-full border border-red-200 bg-white text-red-700 transition hover:bg-red-50"
                          onClick={() => void handleRemoveDocument(document)}
                          disabled={removingId === document.id}
                          aria-label={`Remove ${document.originalName}`}
                          title="Remove"
                        >
                          <Trash2 aria-hidden size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {preview ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="mx-auto my-8 max-w-6xl overflow-hidden rounded-3xl bg-white shadow-card">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-700">Document Preview</p>
                <h2 className="mt-1 truncate text-xl font-bold text-navy-800">{preview.document.originalName}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {categoryLabels[preview.document.category]} · {formatBytes(preview.document.sizeBytes)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-navy-800 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 transition hover:bg-navy-50"
                  href={preview.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink aria-hidden size={16} />
                  Open In New Tab
                </a>
                <button
                  className="focus-ring grid size-11 place-items-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-50"
                  type="button"
                  onClick={() => setPreview(null)}
                  aria-label="Close preview"
                >
                  <X aria-hidden size={20} />
                </button>
              </div>
            </div>

            <div className="bg-slate-100 p-4">
              {canInlinePreview(preview.document) ? (
                preview.document.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="mx-auto max-h-[72vh] max-w-full rounded-2xl bg-white object-contain shadow-sm"
                    src={preview.url}
                    alt={preview.document.originalName}
                  />
                ) : (
                  <iframe
                    className="h-[72vh] w-full rounded-2xl border border-slate-200 bg-white"
                    src={preview.url}
                    title={preview.document.originalName}
                  />
                )
              ) : (
                <div className="grid min-h-[45vh] place-items-center rounded-2xl border border-slate-200 bg-white p-8 text-center">
                  <div>
                    <FileText aria-hidden className="mx-auto text-gold-600" size={48} />
                    <h3 className="mt-4 text-xl font-bold text-navy-800">Preview Not Available In Browser</h3>
                    <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600">
                      This file type may need Word, Excel, or another desktop app. Use Open In New Tab to view or download it securely.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
