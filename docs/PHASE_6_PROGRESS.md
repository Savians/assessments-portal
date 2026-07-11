# Phase 6 Progress - Personal and Household Profile

Checkpoint date: 2026-07-06

## Status

Core implementation is complete locally. No database migration was required because the Phase 1 schema already included `assessment_client_profiles` and `assessment_household_members`.

External Cognito/profile-save staging QA is still pending before this should be treated as production-ready. The backend stack is now deployed to staging, and the public assessment start flow has passed a live smoke test.

## Delivered

### Backend

- Implemented protected profile load/save behavior in `backend/src/services/portal/handler.ts`.
- Added `PortalProfileService` with:
  - paid-session profile load;
  - primary taxpayer details from `assessment_sessions`;
  - strict server-side profile validation;
  - married/spouse cross-field enforcement;
  - dependent DOB enforcement;
  - invalid spouse-on-non-married rejection;
  - future DOB rejection;
  - valid state/ZIP enforcement.
- Added `PrismaPortalProfileRepository` with:
  - profile lookup by entitled session;
  - transactional profile upsert;
  - spouse/dependent household-member replacement;
  - eligible session transition to `PROFILE_COMPLETED`;
  - `assessment_status_history` evidence for profile completion.
- Protected profile APIs continue to require:
  - Cognito `email_verified=true`;
  - `ASSESSMENT_CLIENT` group;
  - linked paid/account-created DB entitlement.

### Frontend

- Added concrete `/portal/profile` route.
- Added profile/household form with:
  - primary taxpayer summary;
  - household/address fields;
  - homeowner, marital status, resident status, preferred contact;
  - own-real-estate and own-business gates;
  - conditional spouse section;
  - repeatable dependent rows;
  - derived age display for spouse/dependents;
  - local browser draft autosave.
- Added typed frontend API helpers for protected profile load/save.
- Added a temporary staging/local token bridge because the full login/session-provider UI is not implemented yet. This should be replaced by the real Cognito login/session provider in the later auth UX phase.

## Validation behavior

The backend is the final gate. It rejects:

- missing core address/profile fields;
- invalid state codes;
- invalid ZIP codes;
- missing marital status;
- missing homeowner status;
- missing resident status;
- married profiles without spouse details;
- spouse details when the profile is not married;
- spouse/dependent rows without DOB;
- invalid or future DOB values.

## Verification run

Completed on 2026-07-06:

- Backend typecheck: passed.
- Backend lint: passed.
- Backend build: passed.
- Backend tests: 33 passed.
- Frontend typecheck: passed.
- Frontend lint: passed.
- Frontend tests: 5 passed.
- Frontend production build: passed; `/portal/profile` included in build output.
- CDK synth: passed; only the known imported-subnet route-table warnings appeared.

Additional staging backend verification completed on 2026-07-07:

- Staging CDK deploy succeeded.
- Prisma Lambda packaging was fixed so deployed ARM64 Lambdas include `libquery_engine-linux-arm64-openssl-3.0.x.so.node`.
- Live `POST /api/assessment/start` returned HTTP `200 OK` with `AGREEMENT_PENDING` and `resumed: true` for the approved test email.

## Files added or changed

- `backend/src/services/portal/profile-service.ts`
- `backend/src/services/portal/prisma-profile-repository.ts`
- `backend/src/services/portal/profile-service.test.ts`
- `backend/src/services/portal/handler.ts`
- `frontend/src/services/assessment-api.ts`
- `frontend/src/components/portal-profile-client.tsx`
- `frontend/src/app/portal/profile/page.tsx`
- `docs/PHASE_6_PROGRESS.md`
- `docs/PROJECT_PHASE_ROADMAP.md`
- `docs/TOMORROW_HANDOFF.md`
- `docs/PROJECT_IMPLEMENTATION_DOSSIER.md`

## Not done yet

- No live Cognito browser-login flow was added.
- No external staging profile save was tested against API Gateway/Cognito.
- Dashboard progress is represented by the API completion payload and profile page status, but the full portal dashboard remains a later UI step.
- Phase 4 webhook staging QA and Phase 5 Cognito staging QA are still pending and should be completed before relying on Phase 6 in staging/production.

## Next phase

Phase 7 should add the conditional real-estate and business/investment intake modules using the same protected portal entitlement pattern.
