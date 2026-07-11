import "dotenv/config";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
const objects = [
  { key: "assessments/legal/templates/2026-v1.4/source.docx", hash: "566eb770dfff39987de06ce08a0c936235cd5f51bedac657d633e19f9d3de179", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { key: "assessments/legal/templates/2026-v1.4/agreement.pdf", hash: "12b86ceede1bcff2fda8f8489da01e0077d2ee4c145a6132c21f3d0720a98735", type: "application/pdf" }
];
async function main() {
  if (!process.env.S3_DOCUMENTS_BUCKET) throw new Error("S3_DOCUMENTS_BUCKET is required");
  const client = new S3Client({ region: process.env.S3_REGION ?? process.env.AWS_REGION ?? "us-east-1" });
  for (const object of objects) {
    const head = await client.send(new HeadObjectCommand({ Bucket: process.env.S3_DOCUMENTS_BUCKET, Key: object.key }));
    if (head.Metadata?.sha256 !== object.hash || head.Metadata?.legalversion !== "2026-v1.4") throw new Error(`Metadata mismatch: ${object.key}`);
    if (head.ContentType !== object.type || !head.ContentLength) throw new Error(`Content verification failed: ${object.key}`);
    if (!head.ServerSideEncryption) throw new Error(`Server-side encryption is not reported: ${object.key}`);
    console.log(`VERIFIED ${object.key} bytes=${head.ContentLength} encryption=${head.ServerSideEncryption} versioned=${Boolean(head.VersionId)}`);
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode=1; });