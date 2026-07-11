import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AgreementPdfProvider } from "./agreement-service";

export class S3AgreementPdfProvider implements AgreementPdfProvider {
  private readonly client = new S3Client({});
  constructor(private readonly bucket: string) {}
  getReadUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 900 });
  }
}