-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "assessment_status" AS ENUM ('AGREEMENT_PENDING', 'AGREEMENT_SIGNED', 'QB_CUSTOMER_CREATED', 'INVOICE_CREATED', 'INVOICE_SENT', 'PAYMENT_PENDING', 'PAYMENT_VERIFYING', 'PAID_VERIFIED', 'ACCOUNT_INVITED', 'ACCOUNT_CREATED', 'PROFILE_IN_PROGRESS', 'PROFILE_COMPLETED', 'DOCUMENTS_IN_PROGRESS', 'DOCUMENTS_SUBMITTED', 'ERROR');

-- CreateEnum
CREATE TYPE "assessment_client_type" AS ENUM ('INDIVIDUAL', 'BUSINESS_OWNER', 'REAL_ESTATE_INVESTOR', 'W2_HIGH_EARNER', 'OTHER');

-- CreateEnum
CREATE TYPE "assessment_household_member_type" AS ENUM ('PRIMARY', 'SPOUSE', 'DEPENDENT');

-- CreateEnum
CREATE TYPE "assessment_resident_status" AS ENUM ('US_CITIZEN', 'GREEN_CARD_HOLDER', 'VISA', 'OTHER');

-- CreateEnum
CREATE TYPE "assessment_marital_status" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- CreateEnum
CREATE TYPE "assessment_document_status" AS ENUM ('PENDING', 'UPLOADED', 'QUARANTINED', 'CLEAN', 'REJECTED', 'DELETED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "assessment_document_category" AS ENUM ('TAX_RETURNS', 'W2_INCOME', 'OTHER_INCOME', 'INVESTMENT_PORTFOLIO', 'RETIREMENT_ACCOUNTS', 'MORTGAGE_STATEMENTS', 'BUSINESS_LLC_DOCUMENTS', 'ESTATE_PLAN', 'LIFE_INSURANCE', 'OTHER_ASSESSMENT_DETAILS');

-- CreateEnum
CREATE TYPE "assessment_delivery_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "assessment_webhook_status" AS ENUM ('RECEIVED', 'VERIFIED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "assessment_reconciliation_status" AS ENUM ('PENDING', 'VERIFIED_PAID', 'STILL_OPEN', 'FAILED');

-- CreateTable
CREATE TABLE "assessment_clients" (
    "id" UUID NOT NULL,
    "cognito_user_id" VARCHAR(128),
    "normalized_email" VARCHAR(320) NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_sessions" (
    "id" UUID NOT NULL,
    "client_id" UUID,
    "normalized_email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "middle_name" VARCHAR(60),
    "last_name" VARCHAR(60) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "client_type" "assessment_client_type" NOT NULL,
    "business_name" VARCHAR(255),
    "state" VARCHAR(2) NOT NULL,
    "income_range" VARCHAR(50),
    "estimated_tax_paid_range" VARCHAR(50),
    "consent_accepted_at" TIMESTAMP(3) NOT NULL,
    "consent_version" VARCHAR(50) NOT NULL DEFAULT 'assessment-start-v1',
    "assessment_year" INTEGER NOT NULL,
    "service_code" VARCHAR(50) NOT NULL DEFAULT 'TAX_ASSESSMENT',
    "service_amount" DECIMAL(10,2) NOT NULL DEFAULT 2997,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "status" "assessment_status" NOT NULL DEFAULT 'AGREEMENT_PENDING',
    "status_token_hash" CHAR(64) NOT NULL,
    "status_token_expires_at" TIMESTAMP(3) NOT NULL,
    "qb_customer_id" VARCHAR(64),
    "qb_invoice_id" VARCHAR(64),
    "qb_invoice_number" VARCHAR(64),
    "qb_invoice_balance" DECIMAL(10,2),
    "account_creation_allowed" BOOLEAN NOT NULL DEFAULT false,
    "document_upload_allowed" BOOLEAN NOT NULL DEFAULT false,
    "payment_verified_at" TIMESTAMP(3),
    "retention_until" DATE,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "last_status_checked_at" TIMESTAMP(3),
    "last_resume_email_sent_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_status_history" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "old_status" "assessment_status",
    "new_status" "assessment_status" NOT NULL,
    "reason" TEXT,
    "actor_type" VARCHAR(40) NOT NULL,
    "actor_id" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_agreement_templates" (
    "id" UUID NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "docx_s3_key" VARCHAR(512) NOT NULL,
    "pdf_s3_key" VARCHAR(512) NOT NULL,
    "docx_sha256" CHAR(64) NOT NULL,
    "pdf_sha256" CHAR(64) NOT NULL,
    "effective_from" DATE NOT NULL,
    "deprecated_at" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_agreement_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_agreement_signatures" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "typed_signature_name" VARCHAR(200) NOT NULL,
    "agreement_display_date" DATE NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "evidence_pdf_s3_key" VARCHAR(512),
    "evidence_pdf_sha256" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_agreement_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_account_invites" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_account_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_recovery_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "verification_type" VARCHAR(30) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_recovery_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_client_profiles" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "household_name" VARCHAR(200),
    "home_address" VARCHAR(255) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "zip" VARCHAR(10) NOT NULL,
    "homeowner" BOOLEAN NOT NULL,
    "marital_status" "assessment_marital_status" NOT NULL,
    "preferred_contact" VARCHAR(30),
    "resident_status" "assessment_resident_status" NOT NULL,
    "owns_real_estate" BOOLEAN,
    "owns_business" BOOLEAN,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_household_members" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "member_type" "assessment_household_member_type" NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "middle_name" VARCHAR(60),
    "last_name" VARCHAR(60) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "resident_status" "assessment_resident_status",
    "sex" VARCHAR(30),
    "is_dependent" BOOLEAN,
    "full_time_student" BOOLEAN,
    "lives_with_taxpayer" BOOLEAN,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_properties" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "property_type" VARCHAR(50) NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "full_address" VARCHAR(300) NOT NULL,
    "acquired_year" INTEGER NOT NULL,
    "acquired_method" VARCHAR(40) NOT NULL,
    "purchase_basis" DECIMAL(14,2),
    "current_fmv" DECIMAL(14,2),
    "land_value" DECIMAL(14,2),
    "mortgage_balance" DECIMAL(14,2),
    "monthly_payment" DECIMAL(12,2),
    "mortgage_company" VARCHAR(150),
    "interest_rate" DECIMAL(7,4),
    "mortgage_term_years" INTEGER,
    "tax_year_use" VARCHAR(50) NOT NULL,
    "rental_start_date" DATE,
    "days_rented" INTEGER,
    "personal_use_days" INTEGER,
    "projected_gross_rent" DECIMAL(14,2),
    "prior_interest_paid" DECIMAL(14,2),
    "prior_tax_paid" DECIMAL(14,2),
    "total_expenses" DECIMAL(14,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_property_owners" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_name" VARCHAR(200) NOT NULL,
    "ownership_percentage" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "assessment_property_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_business_investments" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "entity_name" VARCHAR(255) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "ownership_percent" DECIMAL(5,2) NOT NULL,
    "tax_classification" VARCHAR(60) NOT NULL,
    "prior_year_income_loss" DECIMAL(14,2),
    "prior_year" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_business_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_documents" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "profile_id" UUID,
    "category" "assessment_document_category" NOT NULL,
    "status" "assessment_document_status" NOT NULL DEFAULT 'PENDING',
    "original_name" VARCHAR(255) NOT NULL,
    "s3_bucket" VARCHAR(63) NOT NULL,
    "s3_key" VARCHAR(700) NOT NULL,
    "version_id" VARCHAR(255),
    "mime_type" VARCHAR(127) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64),
    "retention_until" DATE NOT NULL,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_audit_logs" (
    "id" UUID NOT NULL,
    "client_id" UUID,
    "session_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(128),
    "actor_type" VARCHAR(40) NOT NULL,
    "actor_id" VARCHAR(128),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_email_events" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "template_key" VARCHAR(100) NOT NULL,
    "recipient_email" VARCHAR(320) NOT NULL,
    "provider_message_id" VARCHAR(255),
    "status" "assessment_delivery_status" NOT NULL DEFAULT 'QUEUED',
    "failure_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_webhook_events" (
    "id" UUID NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "realm_id" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(30) NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "status" "assessment_webhook_status" NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "assessment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_payment_reconciliations" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "status" "assessment_reconciliation_status" NOT NULL DEFAULT 'PENDING',
    "invoice_balance" DECIMAL(10,2),
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error_message" TEXT,

    CONSTRAINT "assessment_payment_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_clients_cognito_user_id_key" ON "assessment_clients"("cognito_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_clients_normalized_email_key" ON "assessment_clients"("normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_status_token_hash_key" ON "assessment_sessions"("status_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_qb_invoice_id_key" ON "assessment_sessions"("qb_invoice_id");

-- CreateIndex
CREATE INDEX "assessment_sessions_status_updated_at_idx" ON "assessment_sessions"("status", "updated_at");

-- CreateIndex
CREATE INDEX "assessment_sessions_client_id_assessment_year_idx" ON "assessment_sessions"("client_id", "assessment_year");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_normalized_email_service_code_assessmen_key" ON "assessment_sessions"("normalized_email", "service_code", "assessment_year");

-- CreateIndex
CREATE INDEX "assessment_status_history_session_id_created_at_idx" ON "assessment_status_history"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_agreement_templates_version_key" ON "assessment_agreement_templates"("version");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_agreement_signatures_session_id_template_id_key" ON "assessment_agreement_signatures"("session_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_account_invites_token_hash_key" ON "assessment_account_invites"("token_hash");

-- CreateIndex
CREATE INDEX "assessment_account_invites_session_id_expires_at_idx" ON "assessment_account_invites"("session_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_recovery_tokens_token_hash_key" ON "assessment_recovery_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "assessment_recovery_tokens_session_id_expires_at_idx" ON "assessment_recovery_tokens"("session_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_client_profiles_session_id_key" ON "assessment_client_profiles"("session_id");

-- CreateIndex
CREATE INDEX "assessment_client_profiles_client_id_idx" ON "assessment_client_profiles"("client_id");

-- CreateIndex
CREATE INDEX "assessment_household_members_profile_id_member_type_idx" ON "assessment_household_members"("profile_id", "member_type");

-- CreateIndex
CREATE INDEX "assessment_properties_profile_id_idx" ON "assessment_properties"("profile_id");

-- CreateIndex
CREATE INDEX "assessment_property_owners_property_id_idx" ON "assessment_property_owners"("property_id");

-- CreateIndex
CREATE INDEX "assessment_business_investments_profile_id_idx" ON "assessment_business_investments"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_documents_s3_key_key" ON "assessment_documents"("s3_key");

-- CreateIndex
CREATE INDEX "assessment_documents_session_id_category_status_idx" ON "assessment_documents"("session_id", "category", "status");

-- CreateIndex
CREATE INDEX "assessment_audit_logs_session_id_created_at_idx" ON "assessment_audit_logs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "assessment_audit_logs_action_created_at_idx" ON "assessment_audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "assessment_email_events_session_id_template_key_idx" ON "assessment_email_events"("session_id", "template_key");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_webhook_events_provider_event_id_key" ON "assessment_webhook_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "assessment_webhook_events_entity_type_entity_id_idx" ON "assessment_webhook_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "assessment_payment_reconciliations_session_id_checked_at_idx" ON "assessment_payment_reconciliations"("session_id", "checked_at");

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "assessment_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_status_history" ADD CONSTRAINT "assessment_status_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_agreement_signatures" ADD CONSTRAINT "assessment_agreement_signatures_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_agreement_signatures" ADD CONSTRAINT "assessment_agreement_signatures_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assessment_agreement_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_account_invites" ADD CONSTRAINT "assessment_account_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_recovery_tokens" ADD CONSTRAINT "assessment_recovery_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_client_profiles" ADD CONSTRAINT "assessment_client_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "assessment_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_client_profiles" ADD CONSTRAINT "assessment_client_profiles_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_household_members" ADD CONSTRAINT "assessment_household_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "assessment_client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_properties" ADD CONSTRAINT "assessment_properties_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "assessment_client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_property_owners" ADD CONSTRAINT "assessment_property_owners_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "assessment_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_business_investments" ADD CONSTRAINT "assessment_business_investments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "assessment_client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_documents" ADD CONSTRAINT "assessment_documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "assessment_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_documents" ADD CONSTRAINT "assessment_documents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_documents" ADD CONSTRAINT "assessment_documents_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "assessment_client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_audit_logs" ADD CONSTRAINT "assessment_audit_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "assessment_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_audit_logs" ADD CONSTRAINT "assessment_audit_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_email_events" ADD CONSTRAINT "assessment_email_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_payment_reconciliations" ADD CONSTRAINT "assessment_payment_reconciliations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
