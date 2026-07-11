# Savians Assessments Backend

Node.js/TypeScript Lambda services, Prisma schema, and AWS CDK infrastructure for the Savians Tax Assessment Portal.

## Commands

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run prisma:validate
npm run prisma:generate
npm run cdk:synth
```

CDK deployment is intentionally separate from frontend GitHub/Amplify deployment. Never deploy before reviewing the synthesized template and `cdk diff`.

Runtime secrets are loaded from AWS Secrets Manager. The local `.env` is ignored by Git and used only for development/one-time integration setup.

