# Release Policy

- Validate every change before release.
- Frontend changes under `frontend/` must be committed and pushed to the repository's configured GitHub upstream.
- Backend and infrastructure changes under `backend/` must never be staged, committed, or pushed to GitHub. Deploy them directly to the configured AWS Lambda/CDK environment and verify the deployment.
- For mixed frontend/backend work, keep the release paths separate: the Git commit must exclude all backend files.
- Never commit environment files, credentials, generated deployment output, or other secrets.
