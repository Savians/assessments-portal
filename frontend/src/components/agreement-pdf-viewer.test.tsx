import type { ReactNode } from "react";
import { createHash, webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgreementPdfViewer } from "./agreement-pdf-viewer";

vi.mock("react-pdf", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
    Document: function MockDocument({
      children,
      onLoadSuccess
    }: {
      children: ReactNode;
      onLoadSuccess: (result: { numPages: number }) => void;
    }) {
      const onLoadSuccessRef = useRef(onLoadSuccess);
      useEffect(() => {
        onLoadSuccessRef.current({ numPages: 5 });
      }, []);
      return <div data-testid="pdf-document">{children}</div>;
    },
    Page: function MockPage({
      onRenderSuccess,
      pageNumber,
      width
    }: {
      onRenderSuccess: () => void;
      pageNumber: number;
      width: number;
    }) {
      const onRenderSuccessRef = useRef(onRenderSuccess);
      useEffect(() => {
        onRenderSuccessRef.current();
      }, []);
      return <div data-testid={`pdf-page-${pageNumber}`} data-width={width}>Rendered page {pageNumber}</div>;
    }
  };
});

const pdfBytes = new TextEncoder().encode("%PDF-1.4 complete five-page agreement");
const expectedSha256 = createHash("sha256").update(pdfBytes).digest("hex");
const pdfUrl = "https://documents.example.com/agreement.pdf?signature=test";

function successfulPdfResponse() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => pdfBytes.buffer.slice(0)
  };
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successfulPdfResponse()));
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn().mockReturnValue("blob:https://assessments.savians.com/agreement")
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn()
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("AgreementPdfViewer", () => {
  it("verifies the PDF, renders every page, and provides open and download controls", async () => {
    const onReadyChange = vi.fn();
    const { unmount } = render(
      <AgreementPdfViewer
        onReadyChange={onReadyChange}
        pdfSha256={expectedSha256}
        pdfUrl={pdfUrl}
        title="Tax Assessment Plan Legal Service Agreement"
        version="2026-v1.4"
      />
    );

    expect(screen.getByText("Downloading and verifying the complete agreement…")).toBeInTheDocument();
    expect(await screen.findByText("Page 5 of 5")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^pdf-page-/)).toHaveLength(5);
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true));

    const open = screen.getByRole("link", { name: "Open PDF" });
    const download = screen.getByRole("link", { name: "Download PDF" });
    expect(open).toHaveAttribute("href", "blob:https://assessments.savians.com/agreement");
    expect(download).toHaveAttribute("href", "blob:https://assessments.savians.com/agreement");
    expect(download).toHaveAttribute("download", "Savians-Tax-Assessment-Agreement-2026-v1.4.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "850");

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:https://assessments.savians.com/agreement");
  });

  it("keeps the agreement locked after a fetch failure and recovers on retry", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(successfulPdfResponse() as Response);
    const onReadyChange = vi.fn();

    render(
      <AgreementPdfViewer
        onReadyChange={onReadyChange}
        pdfSha256={expectedSha256}
        pdfUrl={pdfUrl}
        title="Tax Assessment Plan Legal Service Agreement"
        version="2026-v1.4"
      />
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not display the complete agreement");
    expect(onReadyChange).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry agreement" }));

    expect(await screen.findByText("Page 5 of 5")).toBeInTheDocument();
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
