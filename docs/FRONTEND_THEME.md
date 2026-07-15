# Frontend Theme System

The client portal supports light and dark themes from the shared application header.

## Behavior

- The toggle is rendered by `frontend/src/components/theme-toggle.tsx` from the root layout, so it is available on every client-facing page.
- The selected theme is stored in browser local storage under `savians-assessment-theme` and therefore survives navigation, reloads, and future visits in the same browser.
- A small script in the root layout applies the stored theme before the page body renders. This avoids a light-theme flash while a dark page loads.
- On a first visit with no saved choice, the portal follows the operating-system/browser color preference.
- Theme styles are centralized in `frontend/src/app/globals.css`. Forms, cards, alerts, borders, text, gradients, and hover states inherit the same theme consistently.

## Verification

- Component coverage verifies switching and persistence.
- The production build, lint, typecheck, and full frontend test suite must pass before deployment.
- Visual QA should include the landing page and at least one form page in both themes.

