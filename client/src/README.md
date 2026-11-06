# Client source layout

One folder per feature, plus a `shared` folder for what several features use. A feature owns its pages, its
components, its styles and the hooks that only it needs; nothing outside `shared` is imported by `shared`.

```
src/
  main.jsx, App.jsx          entry point and the route table (every page is its own lazy chunk)
  features/
    auth/                    sign-in, Lab login, session, Supabase identity   (AuthPage, AuthContext, useAuth, ...)
    landing/                 the public landing page and its hero demo
    dashboard/               a learner's home: unit cards, progress, lab slots, certificates
    learn/                   theory lessons, quizzes, markdown rendering
    prepare/                 interview prep and flashcards
    case-studies/            real-world case studies
    roadmap/                 the 13-week roadmap as stage cards
    lab/                     Lab Studio (topic list), the lab itself (terminal, inspector, mentor),
                             slot and queue screens, access state (useLabAvailability)
    admin/                   platform admin: operator overview, Lab IDs, capacity plan, funnel
    college/                 college staff: weekly slot patterns, slots, per-student changes
    profile/                 public learner profiles
    certificates/            public certificate check
  shared/
    components/Navbar/       the top bar and the Theory / Lab Studio switch
    hooks/                   usePolling, useProgress
    lib/                     apiBase, safePath
    services/                api.js (the one axios client and every endpoint), progressService
    styles/                  index.css (design tokens and base), ExtraPages.css, styles.js (loads every stylesheet in order)
```

Conventions
- Pages are default exports named `<Thing>Page`; a feature's pages are listed in `App.jsx`.
- All server calls go through `shared/services/api.js`; pages never call axios directly.
- Shared card styles (`.oa-card`, `.oa-grid`) live in `shared/styles/index.css` and match the landing page.
- Lab access is enforced by the server. The client only explains it (`features/lab/LabHomePage.jsx`, `SlotBanner.jsx`).
