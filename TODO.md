# TODO

## Refactoring

- [ ] **URL Routing** — Add `react-router-dom` so each page has its own URL
  (e.g. `/tasks`, `/standup`, `/weekly`, `/status`, `/studio`, `/waiting`)
  - Enables browser back/forward navigation
  - Makes it possible to share/bookmark specific pages
  - Replace the current `activePage` state switch with `<Routes>` + `<Route>` components

- [ ] **Split pages into separate files** — `App.jsx` is a single monolithic file (~2000 lines).
  Each page component should live in its own file under `frontend/src/pages/`:
  - `pages/TasksPage.jsx`
  - `pages/StandupPage.jsx`
  - `pages/WeeklyPage.jsx`
  - `pages/StatusPage.jsx`
  - `pages/StudioPage.jsx`
  - `pages/WaitingPage.jsx`
  - Shared components (TaskDetailModal, sidebar nav, etc.) → `components/`
  - Shared helpers/hooks → `lib/` or `hooks/`

## Features

- [ ] **Fix: Claude refresh should include `in_progress` tasks** — currently `getOpenTexts()` only
  queries `status = 'open'`, so Claude is unaware of in-progress tasks and may duplicate them
  or miss resolving them. Add `in_progress` to the query.
