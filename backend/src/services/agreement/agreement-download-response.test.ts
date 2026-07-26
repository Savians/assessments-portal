import { describe, expect, it } from "vitest";
import { agreementDownloadRedirect } from "./agreement-download-response";

describe("agreementDownloadRedirect", () => {
  it("redirects to the freshly minted S3 URL without caching it", () => {
    expect(agreementDownloadRedirect("https://s3.example.com/fresh-presigned-url")).toEqual({
      statusCode: 302,
      headers: {
        location: "https://s3.example.com/fresh-presigned-url",
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff"
      }
    });
  });
});
