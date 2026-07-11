import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const root = path.resolve(__dirname, "../..");
const artifacts = [
  { path: path.join(root, "legal/2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.docx"), key: "assessments/legal/templates/2026-v1.4/source.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", expected: "566eb770dfff39987de06ce08a0c936235cd5f51bedac657d633e19f9d3de179" },
  { path: path.join(root, "legal/rendered/2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.pdf"), key: "assessments/legal/templates/2026-v1.4/agreement.pdf", contentType: "application/pdf", expected: "12b86ceede1bcff2fda8f8489da01e0077d2ee4c145a6132c21f3d0720a98735" }
];
async function main() {
  const bucket = process.env.S3_DOCUMENTS_BUCKET;
  if (!bucket) throw new Error("S3_DOCUMENTS_BUCKET is required");
  const client = new S3Client({ region: process.env.S3_REGION ?? process.env.AWS_REGION ?? "us-east-1" });
  for (const artifact of artifacts) {
    const body = await readFile(artifact.path); const actual = createHash("sha256").update(body).digest("hex");
    if (actual !== artifact.expected) throw new Error(`Hash mismatch for ${artifact.path}`);
    let existing;
    try { existing = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: artifact.key })); }
    catch (error) { if (!(error instanceof Error) || error.name !== "NotFound") throw error; }
    if (existing && existing.Metadata?.sha256 !== actual) throw new Error(`Immutable legal key already exists with a different hash: ${artifact.key}`);
    if (!existing) await client.send(new PutObjectCommand({ Bucket: bucket, Key: artifact.key, Body: body, ContentType: artifact.contentType, CacheControl: "private, max-age=300", Metadata: { sha256: actual, legalversion: "2026-v1.4" } }));
    const head = existing ?? await client.send(new HeadObjectCommand({ Bucket: bucket, Key: artifact.key }));
    if (head.Metadata?.sha256 !== actual) throw new Error(`S3 verification failed for ${artifact.key}`);
    console.log(`PUBLISHED ${artifact.key} ${actual}`);
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });