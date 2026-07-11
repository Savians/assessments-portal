-- Phase 3 agreement evidence and QuickBooks idempotency fields.
ALTER TABLE "assessment_sessions"
  ADD COLUMN "agreement_signed_at" TIMESTAMPTZ,
  ADD COLUMN "invoice_created_at" TIMESTAMPTZ,
  ADD COLUMN "invoice_sent_at" TIMESTAMPTZ,
  ADD COLUMN "qb_customer_request_id" VARCHAR(64),
  ADD COLUMN "qb_invoice_request_id" VARCHAR(64);

ALTER TABLE "assessment_agreement_templates"
  ADD COLUMN "source_file_name" VARCHAR(255) NOT NULL DEFAULT '2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.docx',
  ADD COLUMN "consent_text_version" VARCHAR(50) NOT NULL DEFAULT 'agreement-acceptance-v1';

ALTER TABLE "assessment_agreement_signatures"
  ADD COLUMN "template_version" VARCHAR(40) NOT NULL,
  ADD COLUMN "template_title" VARCHAR(255) NOT NULL,
  ADD COLUMN "docx_sha256" CHAR(64) NOT NULL,
  ADD COLUMN "pdf_sha256" CHAR(64) NOT NULL,
  ADD COLUMN "consent_text_version" VARCHAR(50) NOT NULL,
  ADD COLUMN "acknowledgement_accepted_at" TIMESTAMPTZ NOT NULL,
  ADD COLUMN "evidence_payload_sha256" CHAR(64) NOT NULL;

CREATE UNIQUE INDEX "assessment_sessions_qb_customer_request_id_key"
  ON "assessment_sessions"("qb_customer_request_id");
CREATE UNIQUE INDEX "assessment_sessions_qb_invoice_request_id_key"
  ON "assessment_sessions"("qb_invoice_request_id");
CREATE UNIQUE INDEX "assessment_agreement_signatures_session_id_key"
  ON "assessment_agreement_signatures"("session_id");