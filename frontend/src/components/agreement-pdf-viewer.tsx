"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, LoaderCircle, Minus, Plus, RefreshCw } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Button, ErrorAlert } from "@/components/ui";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const BASE_PAGE_WIDTH = 680;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.25;

interface AgreementPdfViewerProps {
  pdfUrl: string;
  pdfSha256: string;
  title: string;
  version: string;
  onReadyChange: (ready: boolean) => void;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyPdf(bytes: ArrayBuffer, expectedSha256: string): Promise<void> {
  if (bytes.byteLength === 0) throw new Error("The agreement PDF is empty.");

  const expected = expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected) || !globalThis.crypto?.subtle) return;

  const actual = bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  if (actual !== expected) throw new Error("The agreement PDF could not be verified.");
}

function viewerErrorMessage(): string {
  return "We could not display the complete agreement. Retry below or open the original PDF in a new tab.";
}

export function AgreementPdfViewer({
  pdfUrl,
  pdfSha256,
  title,
  version,
  onReadyChange
}: AgreementPdfViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string>();
  const [loadingSource, setLoadingSource] = useState(true);
  const [error, setError] = useState<string>();
  const [numPages, setNumPages] = useState(0);
  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => new Set());
  const [zoom, setZoom] = useState(1);

  const fileName = useMemo(() => {
    const safeVersion = version.replace(/[^a-z0-9._-]+/gi, "-");
    return `Savians-Tax-Assessment-Agreement-${safeVersion}.pdf`;
  }, [version]);

  const failViewer = useCallback(() => {
    setError(viewerErrorMessage());
    onReadyChange(false);
  }, [onReadyChange]);

  useEffect(() => {
    const controller = new AbortController();
    let createdBlobUrl: string | undefined;
    let active = true;

    setBlobUrl(undefined);
    setLoadingSource(true);
    setError(undefined);
    setNumPages(0);
    setRenderedPages(new Set());
    onReadyChange(false);

    void (async () => {
      try {
        const response = await fetch(pdfUrl, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Agreement PDF request failed with ${response.status}.`);

        const bytes = await response.arrayBuffer();
        await verifyPdf(bytes, pdfSha256);
        createdBlobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        if (!active) {
          URL.revokeObjectURL(createdBlobUrl);
          return;
        }
        setBlobUrl(createdBlobUrl);
        setLoadingSource(false);
      } catch (reason) {
        if (!active || (reason instanceof Error && reason.name === "AbortError")) return;
        setLoadingSource(false);
        failViewer();
      }
    })();

    return () => {
      active = false;
      controller.abort();
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [attempt, failViewer, onReadyChange, pdfSha256, pdfUrl]);

  useEffect(() => {
    onReadyChange(Boolean(blobUrl && !error && numPages > 0 && renderedPages.size === numPages));
  }, [blobUrl, error, numPages, onReadyChange, renderedPages]);

  const handleDocumentLoad = useCallback(({ numPages: loadedPages }: { numPages: number }) => {
    if (!Number.isInteger(loadedPages) || loadedPages < 1) {
      failViewer();
      return;
    }
    setError(undefined);
    setNumPages(loadedPages);
    setRenderedPages(new Set());
  }, [failViewer]);

  const handlePageRender = useCallback((pageNumber: number) => {
    setRenderedPages((current) => {
      if (current.has(pageNumber)) return current;
      const next = new Set(current);
      next.add(pageNumber);
      return next;
    });
  }, []);

  const pageWidth = Math.round(BASE_PAGE_WIDTH * zoom);
  const ready = Boolean(blobUrl && !error && numPages > 0 && renderedPages.size === numPages);
  const statusText = ready
    ? `All ${numPages} pages are ready to review.`
    : numPages > 0
      ? `Preparing all ${numPages} pages (${renderedPages.size} ready).`
      : "Preparing the complete agreement.";

  return (
    <div className="bg-slate-100">
      <div className="grid gap-4 border-b border-slate-200 bg-white p-4 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-navy-800">Complete agreement</p>
          <p className="mt-1 text-xs text-slate-600" aria-live="polite">{statusText}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-navy-800 bg-white px-3 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"
            href={blobUrl ?? pdfUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden size={16} />
            Open PDF
          </a>
          {blobUrl ? (
            <a
              className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-navy-800 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-700"
              download={fileName}
              href={blobUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <Download aria-hidden size={16} />
              Download PDF
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-navy-800 px-3 py-2 text-sm font-semibold text-white opacity-50"
            >
              <Download aria-hidden size={16} />
              Download PDF
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <p className="text-xs leading-5 text-slate-600">
          Scroll down for every page. On a phone, swipe sideways or use the zoom controls to read larger text.
        </p>
        <div className="flex items-center gap-2" aria-label="Agreement zoom controls">
          <Button
            aria-label="Zoom out"
            className="size-11 px-0"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
            type="button"
            variant="outline"
          >
            <Minus aria-hidden size={16} />
          </Button>
          <span className="min-w-12 text-center text-sm font-semibold text-navy-800">{Math.round(zoom * 100)}%</span>
          <Button
            aria-label="Zoom in"
            className="size-11 px-0"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
            type="button"
            variant="outline"
          >
            <Plus aria-hidden size={16} />
          </Button>
        </div>
      </div>

      {loadingSource ? (
        <div className="flex min-h-72 items-center justify-center gap-3 p-6 text-sm font-medium text-navy-800" role="status">
          <LoaderCircle aria-hidden className="animate-spin" size={20} />
          Downloading and verifying the complete agreement…
        </div>
      ) : null}

      {error ? (
        <div className="grid gap-4 p-5">
          <ErrorAlert>{error}</ErrorAlert>
          <Button className="w-full sm:w-fit" onClick={() => setAttempt((value) => value + 1)} type="button" variant="outline">
            <RefreshCw aria-hidden size={16} />
            Retry agreement
          </Button>
        </div>
      ) : null}

      {blobUrl && !error ? (
        <div
          aria-label={`${title}, complete document`}
          className="overflow-x-auto p-3 sm:p-5 xl:max-h-[72vh] xl:min-h-[640px] xl:overflow-auto"
          role="region"
          tabIndex={0}
        >
          <Document
            className="grid min-w-max gap-5"
            error={<ErrorAlert>{viewerErrorMessage()}</ErrorAlert>}
            file={blobUrl}
            loading={(
              <div className="flex min-h-72 items-center justify-center gap-3 text-sm font-medium text-navy-800" role="status">
                <LoaderCircle aria-hidden className="animate-spin" size={20} />
                Preparing every agreement page…
              </div>
            )}
            onLoadError={failViewer}
            onLoadSuccess={handleDocumentLoad}
          >
            {Array.from({ length: numPages }, (_, index) => {
              const pageNumber = index + 1;
              return (
                <figure className="mx-auto w-fit overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" key={pageNumber}>
                  <Page
                    devicePixelRatio={1.5}
                    onLoadError={failViewer}
                    onRenderError={failViewer}
                    onRenderSuccess={() => handlePageRender(pageNumber)}
                    pageNumber={pageNumber}
                    renderAnnotationLayer
                    renderTextLayer
                    width={pageWidth}
                  />
                  <figcaption className="border-t border-slate-200 bg-white px-3 py-2 text-center text-xs font-medium text-slate-600">
                    Page {pageNumber} of {numPages}
                  </figcaption>
                </figure>
              );
            })}
          </Document>
        </div>
      ) : null}

      <p className="border-t border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
        On iPhone or iPad, if the PDF opens instead of downloading, use Share and choose Save to Files.
      </p>
    </div>
  );
}
