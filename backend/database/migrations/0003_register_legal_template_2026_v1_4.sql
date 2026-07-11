-- Register the visually reviewed immutable 2026 v1.4 agreement artifacts.
INSERT INTO "assessment_agreement_templates" (
  "id", "version", "title", "docx_s3_key", "pdf_s3_key", "docx_sha256", "pdf_sha256",
  "effective_from", "is_active", "source_file_name", "consent_text_version", "created_at"
) VALUES (
  'a5535501-2026-4140-8000-000000000014',
  '2026-v1.4',
  'Tax Assessment Plan Legal Service Agreement',
  'assessments/legal/templates/2026-v1.4/source.docx',
  'assessments/legal/templates/2026-v1.4/agreement.pdf',
  '566eb770dfff39987de06ce08a0c936235cd5f51bedac657d633e19f9d3de179',
  '12b86ceede1bcff2fda8f8489da01e0077d2ee4c145a6132c21f3d0720a98735',
  DATE '2026-01-01', TRUE,
  '2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.docx',
  'agreement-acceptance-v1', NOW()
);