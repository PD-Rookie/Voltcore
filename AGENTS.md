# AGENTS.md

## Project

VOLTCORE is a static HTML/CSS/JS game with no build step and no external dependencies.

- `index.html` — markup, HUD, overlays
- `style.css` — layout, neon UI, responsive rules
- `script.js` — game engine, rendering, audio, persistence

Open `index.html` directly or serve the folder locally.

## Git workflow

- Never commit new feature work directly to `main`.
- Create a branch named `feature/<short-slug>` from an up-to-date `main`.
- Commit and push the feature branch to `origin`.
- Test the feature branch before merging.
- Merge to `main` only after all checks pass and the user approves.
- Keep `main` deployable; GitHub Pages serves it.

Documentation, config, and small maintenance commits may go to `main` directly unless the user says otherwise.

## Verification

- Run `node --check script.js` after editing JavaScript.
- Run a headless Chrome smoke test against `index.html`: menu, difficulty selection, settings, play, pause, resume, and mobile emulation. Assert no runtime or console errors.
- For layout changes, verify geometry at these viewports: 1280x900 desktop, 390x844 and 320x568 portrait, 844x390 and 568x320 landscape. Check for horizontal overflow and that primary controls are visible.
- After pushing to `main`, confirm the deployed GitHub Pages assets hash-match the local files and run a live smoke test.

## House rules

- Follow the existing vanilla JS/CSS/HTML style; do not add frameworks, build tooling, or external assets.
- Do not add code comments unless asked.
- Never commit secrets, browser profiles, or temporary test harnesses.
