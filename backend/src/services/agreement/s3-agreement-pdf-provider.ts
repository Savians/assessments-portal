import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AgreementPdfProvider } from "./agreement-service";

export class S3AgreementPdfProvider implements AgreementPdfProvider {
  private readonly client = new S3Client({});
  constructor(private readonly bucket: string) {}
  getReadUrl(key: string, options?: { expiresIn?: number; downloadFileName?: string }): Promise<string> {
    const safeFileName = options?.downloadFileName?.replace(/["\\\r\n]/g, "_");
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: safeFileName ? `attachment; filename="${safeFileName}"` : undefined
      }),
      { expiresIn: options?.expiresIn ?? 900 }
    );
  }
}
