# Phase 1 Progress: Repository and Engineering Foundation

Last updated: 2026-07-05  
Phase status: **Complete**  
Deployment status: **Nothing deployed**  
Database status: **No migration created or applied**

## Scope

Phase 1 establishes compilable frontend/backend applications, design and route foundations, a relational schema, assessment-specific infrastructure definitions, automated checks, secret boundaries, and continuation documentation.

## Completed

### Frontend

- Next.js 15.5.20, React 19, strict TypeScript, Tailwind CSS, ESLint, Prettier, and Vitest configuration.
- Savians navy/gold design tokens and mobile-first layout.
- Reusable Button, Input, Select, Checkbox, Card, StatusBadge, Stepper, ErrorAlert, and LoadingOverlay components.
- Route shell for landing, start, agreement, status, recovery, account creation, dashboard, profile, real estate, business/investments, and documents.
- TanStack Query provider and public environment schema.
- Amplify build configuration.
- Production build, TypeScript, and ESLint pass locally.

### Backend

- Node.js/TypeScript package with strict compile and lint rules.
- Foundation HTTP and scheduler handlers with structured/redacted logs.
- Ten assessment-specific Lambda definitions.
- Dedicated assessment HTTP API, Cognito JWT authorizer, assessment app client/group, disabled reconciliation schedule, and least-scope S3 prefix grants.
- Runtime secret boundary points to Secrets Manager instead of embedding values in CDK.
- PostgreSQL/Prisma schema for all 17 `assessment_*` physical tables.
- Schema validation passes.
- TypeScript build and foundation health smoke test pass.
- Shared AWS identifiers were copied from the existing ignored backend environment without printing values.

### Repository operations

- Frontend/backend lockfiles generated.
- GitHub Actions checks defined for both applications.
- Root and application READMEs updated.
- Environment matrix and architecture documentation added.
- Legal agreement and QuickBooks sandbox/production runbooks remain preserved.

## Architecture decision added during Phase 1

Use a dedicated assessment HTTP API rather than attaching routes to the live Referral Portal API. RDS, network, Cognito pool, S3, KMS, and Resend remain shared. This materially reduces the chance that assessment CORS/routes/deployment changes affect live referral users.

## Verification record

| Check | Result |
| --- | --- |
| Frontend install | Passed |
| Frontend TypeScript | Passed |
| Frontend ESLint | Passed |
| Frontend production build | Passed |
| Backend install/audit | Passed; zero reported vulnerabilities |
| Backend TypeScript build | Passed |
| Backend ESLint | Passed |
| Backend health smoke | Passed |
| Prisma schema validation | Passed |
| Prisma migration | Not run by design |
| Frontend Vitest | Passed: 1 test |
| Backend Vitest | Passed: 2 tests |
| Prisma client generation | Passed: Prisma Client 6.19.3 generated |
| CDK synth | Passed; staging template generated and reviewed |
| Synthesized Lambdas/routes | 10 isolated Lambdas, 15 API routes |
| Synthesized RDS resources | 0; shared RDS is not modified by CDK |
| Secret scan of template | Passed; QuickBooks secret values absent |
| Frontend production dependency audit | Passed; 0 vulnerabilities after PostCSS security override |
| AWS deployment | Not attempted |

CDK emits non-blocking warnings because the imported subnet route-table IDs are not currently configured. Lambda VPC placement uses the correct imported subnet IDs. Add the two route-table IDs before deployment if a warning-free synth is required.

## Security observations

- The real assessment `.env` is ignored and not shown in documentation.
- Existing generated Referral Portal CDK artifacts were observed to contain resolved environment values. None were copied. Remediating those old artifacts/rotating affected values is a separate production-security task.
- Frontend initially reported a moderate PostCSS advisory through Next.js. The fixed PostCSS patch is enforced through an npm override; the production audit now reports zero vulnerabilities.
- Sandbox QuickBooks credentials shared through chat should be rotated before long-term reliance.

## Pre-deployment prerequisites

1. Obtain the real existing KMS key ID. The old local configuration contains a placeholder, so staging currently falls back to AWS-managed Lambda environment encryption; production synthesis intentionally refuses an invalid/missing KMS ID.
2. Create `savians/assessment/staging` in AWS Secrets Manager and populate it through an approved secret-management path.
3. Optionally add imported private-subnet route-table IDs to remove CDK annotations.
4. Review `cdk diff` with valid staging identifiers.
5. Initialize/connect the intended frontend GitHub repository only when explicitly authorized.

## Next feature phase

Phase 2 is ready. It implements the public landing/start workflow, annual duplicate/resume rules, secure status-token creation, database migration review, and resume-agreement email. It must not call QuickBooks.
