# Job Search Tracker

A free, open-source job search tracker that runs entirely in the browser. It started as a personal Claude artifact and was rebuilt as a standalone static site so anyone can use it.

## Principles

- **Private by default:** all data stays in the person's browser (`localStorage`, key `spt.library`). No accounts, no server, no analytics, no outside requests (fonts and libraries are bundled, not loaded from CDNs). Don't add any of these without a decision recorded in an Issue.
- **Nothing personal built in:** every check and threshold comes from the person's Settings. Never hard-code a name, employer, number, or city.
- **Backups matter:** browser data can be cleared, so keep backup download and restore working, and keep old backups loading. If the saved data's shape changes, raise `SCHEMA_VERSION` in `src/lib/types.ts` and handle older data in `normalize` in `src/lib/storage.ts`.
- **Never lose data silently:** if saved data can't be read, set a copy aside before anything overwrites it, and tell the person.

## Where things live

- `src/lib/`: logic with tests (Markdown, diff, checks, storage and backups, PDF, sample data).
- `src/scripts/app.ts`: the interactive page (rendering and event handling).
- `src/pages/index.astro`: the page shell. `src/styles/app.css`: styles and color tokens.

## Accessibility

Everything must meet **WCAG 2.2 Level AA**: real HTML controls, full keyboard use with visible focus, labels on every field, errors linked to their field with `aria-invalid`, changes announced through the `#status` live region, 4.5:1 text contrast in light and dark mode, never color alone, and no sideways scrolling at 375px. The page redraws its sections, so keep focus on the control the person was using (`render(focusTarget)`). Say what was and wasn't tested.

## Publishing

The live site is <https://natalia-builds.github.io/search-pipeline-and-tracker/>. The GitHub Actions workflow in `.github/workflows/publish.yml` tests and builds every pull request, and publishes to GitHub Pages when something is merged into `main`. Anything merged goes public, so review before merging. The site lives under `/search-pipeline-and-tracker/`, so file addresses must go through `import.meta.env.BASE_URL`, never a bare `/`.

## Workflow

- Never commit directly to `main`. Use a short-lived branch and a pull request with one purpose.
- Run `npm test` and `npm run build` before every commit.
- Check changes in a browser: awkward inputs, a 375px phone width, and dark mode.
- This repository is public. Never commit personal resume data or secrets.

## Explaining the work

The maintainer is learning to code. Explain each step and command in plain language before running it, including why teams work this way.
