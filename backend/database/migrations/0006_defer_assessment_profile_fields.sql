-- The public assessment start is intentionally limited to contact information.
-- Identity and assessment context are collected after verified payment.
ALTER TABLE "assessment_sessions"
  ALTER COLUMN "date_of_birth" DROP NOT NULL,
  ALTER COLUMN "client_type" DROP NOT NULL,
  ALTER COLUMN "state" DROP NOT NULL;
