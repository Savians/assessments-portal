# Environment Matrix

| Concern | Local | Staging | Production |
| --- | --- | --- | --- |
| Frontend URL | `http://localhost:3000` | `https://staging.assessments.savians.com` | `https://assessments.savians.com` |
| Frontend hosting | Next dev server | Amplify staging branch | Amplify production branch |
| Backend deployment | None/mock or deployed staging API | CDK staging stack | CDK production stack |
| QuickBooks | Sandbox | Sandbox | Production company |
| QuickBooks base URL | Sandbox API | Sandbox API | Production API |
| Database | Shared RDS, development discipline | Shared RDS, `assessment_*` tables | Shared RDS, `assessment_*` tables |
| Cognito | Shared pool / assessment app client after deploy | Shared pool / staging app client | Shared pool / production app client |
| S3 | Shared bucket / local or staging prefix | `assessments/staging/` | `assessments/production/` |
| Secrets | Ignored backend `.env` | `savians/assessment/staging` | `savians/assessment/production` |
| Email | Disabled/approved test recipient | Resend test/internal recipients | Resend production delivery |
| Reconciliation schedule | Disabled | Disabled until payment QA | Enabled after launch approval |

## Rules

1. Sandbox and production QuickBooks values never cross environments.
2. Production secrets are entered directly into AWS Secrets Manager, not local files or chat.
3. The frontend receives no server secret.
4. CDK synth and diff are reviewed before deployment.
5. Prisma migration SQL is reviewed before touching shared RDS.
6. Staging smoke tests must pass before production promotion.

