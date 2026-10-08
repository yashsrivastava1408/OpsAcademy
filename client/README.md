# OpsAcademy web client

React 19 + Vite. The project overview, architecture and measured numbers are in the [main README](../README.md).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173, expects the gateway on http://localhost:4000
```

Point it at another gateway with `VITE_API_URL` (for example in `.env.local`). The value is compiled into the bundle and into the page's Content-Security-Policy, so set it at build time on Vercel or any other host.

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run lint` | oxlint |
| `npm test` | Unit tests for the terminal's local echo (Node's built-in test runner, no browser) |
| `npm run e2e` | Real-browser tests. Builds the client, starts the AI hub and the gateway on spare ports with data in a temp folder, runs every file in `e2e/`, then stops what it started. Needs `npx playwright install chromium` once, and the server and AI hub dependencies installed |
| `npm run e2e -- features` | Only the test files whose name contains `features` |
| `E2E_STORE_DRIVER=sqlite npm run e2e` | The same tests with the gateway on its SQLite store |

## Where things are

```
src/
  App.jsx                 routes; every page is loaded on demand
  styles.js               every stylesheet, in one fixed order (see the comment in it before adding one)
  services/api.js         all API calls, the guest/account identity, the streamed-hint reader
  services/progressService.js   the learner's progress, shared by the navbar and pages
  hooks/usePolling.js     polling that pauses while the tab is hidden
  lib/markdown.jsx        the small Markdown renderer used by lessons and case studies
  components/Terminal/    xterm.js terminal: reconnects by itself, tells the shell its size
    typeahead.js          local echo for slow connections (tested in tests/typeahead.test.js)
  pages/                  one file per page
e2e/
  run.mjs                 starts the throwaway stack and runs the files below
  walkthrough.mjs         a student's visit, from landing page to sign-up
  slow-link.mjs           the same typing on a fast link and a 300 ms link must end identically
  features.mjs            account links, profile, operator page, case studies, phone layout
```

## Two things to know before changing it

- **Stylesheets are not independent.** Classes such as `.spin` and `.pill` are defined in one page's CSS and used by others, so all CSS is imported once, in order, from `src/styles.js`. Add new stylesheets at the end of that file.
- **Public requests carry no token.** `/units`, `/sandbox/stats`, certificate checks and public profiles are sent without one, so opening the landing page or a shared link creates no guest account. Anything personal goes through the identity in `services/api.js`, which creates a guest the first time it is needed.
