"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  Folder,
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
import { Button, Card, ErrorAlert, LoadingOverlay, StatusBadge, Stepper, cn } from "@/components/ui";

const steps = ["Start", "Agreement & invoice", "Payment & account", "Profile & documents"] as const;
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

export function PortalDocumentsClient({ embedded = false }: { embedded?: boolean }) {
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
  const uploadedCount = uploadedDocuments.length;
  const totalUploadedBytes = useMemo(
    () => uploadedDocuments.reduce((total, document) => total + document.sizeBytes, 0),
    [uploadedDocuments]
  );

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
  const activeDocuments = documentsByCategory.get(activeCategory) ?? [];
  const isDraggingActiveFolder = dragCategory === activeCategory;
  const isUploadingActiveFolder = uploadingCategory === activeCategory;
  const activeInputId = `document-upload-${activeCategory.toLowerCase()}`;

  const resolvePortalToken = useCallback(async () => {
    const freshToken = await getCurrentPortalAccessToken();
    if (!freshToken) throw new AssessmentApiError("Your secure portal session expired. Please sign in again from the profile page.");
    return freshToken;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const activeToken = await resolvePortalToken();
      const response = await loadDocuments(activeToken);
      setDocuments(response.documents);
    } catch (caught) {
      setError(caught instanceof AssessmentApiError ? caught.message : "We could not load your document list.");
    } finally {
      setLoading(false);
    }
  }, [resolvePortalToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

      setDocuments((current) => {
        const uploadedIds = new Set(completedDocuments.map((document) => document.id));
        return [...completedDocuments, ...current.filter((document) => !uploadedIds.has(document.id))];
      });
      setMessage(`${pluralize(completedDocuments.length, "document")} uploaded to ${categoryLabels[category]}.`);
      const firstCompletedDocument = completedDocuments[0];
      if (firstCompletedDocument) await openPreview(firstCompletedDocument);
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
      setDocuments((current) => current.filter((item) => item.id !== document.id));
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
      {embedded ? null : <Stepper current={3} steps={steps} />}

      <Card className={cn(embedded ? "overflow-hidden bg-gradient-to-r from-white via-white to-navy-50/80 p-0" : "mt-8 overflow-hidden bg-gradient-to-r from-white via-white to-navy-50/80 p-0")}>
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <StatusBadge status={uploadedCount > 0 ? "complete" : "active"}>
              {uploadedCount > 0 ? `${uploadedCount} uploaded` : "Ready for documents"}
            </StatusBadge>
            <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-end">
              <h1 className="text-3xl font-bold text-navy-800">Upload Documents</h1>
              <p className="text-sm leading-6 text-slate-600 lg:pb-1">
                Securely upload, preview, and manage your assessment files by category.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
            <div className="rounded-2xl border border-navy-100 bg-white/80 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Files</p>
              <p className="mt-1 text-lg font-bold text-navy-800">{uploadedCount}</p>
            </div>
            <div className="rounded-2xl border border-navy-100 bg-white/80 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Uploaded</p>
              <p className="mt-1 text-lg font-bold text-navy-800">{formatBytes(totalUploadedBytes)}</p>
            </div>
            <div className="rounded-2xl border border-navy-100 bg-white/80 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Limit</p>
              <p className="mt-1 text-lg font-bold text-navy-800">25 MB/file</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-4">
        {error ? <ErrorAlert>{error}</ErrorAlert> : null}
        {message ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 aria-hidden size={18} />
            <span>{message}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[330px_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Document Drive</p>
              <h2 className="mt-2 text-xl font-bold text-navy-800">Categories</h2>
            </div>
            <Button type="button" variant="outline" className="min-h-10 px-3" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw aria-hidden size={16} />
            </Button>
          </div>

          <div className="mt-5 max-h-[calc(100vh-340px)] min-h-[420px] space-y-2 overflow-y-auto pr-1">
            {documentFolders.map((folder) => {
              const folderDocuments = documentsByCategory.get(folder.category) ?? [];
              const isActive = folder.category === activeCategory;
              return (
                <button
                  key={folder.category}
                  className={cn(
                    "focus-ring flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition",
                    isActive
                      ? "border-navy-800 bg-navy-800 text-white shadow-card"
                      : "border-slate-200 bg-white text-navy-800 hover:border-gold-300 hover:bg-gold-50"
                  )}
                  type="button"
                  onClick={() => {
                    setActiveCategory(folder.category);
                    setError(null);
                  }}
                >
                  <span
                    className={cn(
                      "grid size-11 shrink-0 place-items-center rounded-xl",
                      isActive ? "bg-white/15 text-white" : "bg-navy-50 text-navy-800"
                    )}
                  >
                    {isActive ? <FolderOpen aria-hidden size={22} /> : <Folder aria-hidden size={22} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{folder.label}</span>
                    <span className={cn("mt-1 block truncate text-xs", isActive ? "text-white/75" : "text-slate-500")}>
                      {pluralize(folderDocuments.length, "file")} · {folder.helper}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className={cn("shrink-0", isActive ? "text-white" : "text-slate-400")} size={18} />
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 gap-4">
              <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-700">
                <FolderOpen aria-hidden size={34} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">Selected Folder</p>
                <h2 className="mt-2 text-2xl font-bold text-navy-800">{activeFolder.label}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{activeFolder.helper}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <StatusBadge status={activeDocuments.length > 0 ? "complete" : "pending"}>
                {pluralize(activeDocuments.length, "file")}
              </StatusBadge>
              <label
                className="focus-ring inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-700"
                htmlFor={activeInputId}
              >
                <Plus aria-hidden size={17} />
                Add Files
              </label>
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
