# Codex instructions — Masareefi (مصاريفي)

## Project
- Arabic RTL personal and family finance web app, hosted on GitHub Pages.
- Canonical repository: `ashrafv2/masareefi`; production branch: `main`.
- Preserve the existing deployed app behavior and the user's local/cloud financial data.
- Primary entry point is `index.html`; check other repository files before making changes.
- The app currently has a large HTML file with multiple CSS and JS feature sections. Refactor incrementally, never as a destructive rewrite.

## Core safeguards
1. **Never clear, reset, overwrite, migrate destructively, or silently modify persisted user financial data.**
2. Treat `localStorage`, IndexedDB, backups, authentication, device vault, and cloud synchronization as high-risk. Read their implementation and test data preservation before changes.
3. Do not remove `device-vault.js`, `cloud-sync.js`, their integrations, or any synchronization/recovery behavior without explicit approval.
4. Work in a feature branch; submit a pull request and explain risks, tests, and rollback. Do not push feature work directly to `main` unless explicitly requested.
5. Do not commit tokens, credentials, private user data, real transaction exports, or secrets.
6. Keep the app usable in Arabic right-to-left, on iPhone/iPad and small mobile screens, and with offline capabilities where present.
7. Never replace a working feature with a visual mockup or a placeholder.
8. Preserve app colors selected by the user, existing categories, accounts, expenses/income, installments, assets, reports, savings, backups, and installed-app behavior.

## Validation before merging
- Inspect changes for JavaScript syntax and CSS regressions.
- Exercise navigation, add/edit/delete transaction, category picking, saving and restoring, assets, installments, theme selection, reports, and responsive mobile layouts.
- Specifically check cloud conflict resolution and the case where the iPad holds the newest correct data; preserve that data on synchronization.
- Verify the custom 3D SVG icons render, remain clickable, and do not interfere with event handlers or page performance.
- Test initial load with and without existing saved data, and after refresh/offline load when feasible.
- If automated tests are not available, state precisely which checks were not run rather than claiming success.

## First Codex task
Audit the current repository for defects, duplicated/overriding CSS rules, inline JS coupling, save failures, PWA issues, accessibility and performance. Produce a prioritized report and a staged refactor plan **without changing code in the first task**. Identify safe tests that can be added before refactoring.

## Delivery
For each subsequent change, report touched files, user-visible differences, data/sync risk, test evidence, and rollback plan. Prefer small self-contained patches.
