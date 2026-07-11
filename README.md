# Savians Tax Assessment Portal

Production domain: `https://assessments.savians.com`

This repository contains the new Savians Tax Assessment onboarding portal. It is intentionally separated into two deployable applications:

- `frontend/`: Next.js application deployed through GitHub to AWS Amplify.
- `backend/`: TypeScript Lambda services and CDK infrastructure deployed directly with CDK.

Phase 0 architecture decisions are recorded in [`docs/PHASE_0_BASELINE.md`](docs/PHASE_0_BASELINE.md).
Current implementation status and verification are maintained in [`docs/PHASE_3_PROGRESS.md`](docs/PHASE_3_PROGRESS.md) and [`docs/PROJECT_IMPLEMENTATION_DOSSIER.md`](docs/PROJECT_IMPLEMENTATION_DOSSIER.md).

The approved legal source document is stored under `legal/`. It must not be edited as part of application development without explicit legal approval.

## Current state

Phase 3 code, assessment-only database migrations, and legal S3 artifacts are complete. QuickBooks sandbox OAuth renewal and the controlled invoice test remain. Nothing has been deployed. Read `docs/TOMORROW_HANDOFF.md` before continuing work.
