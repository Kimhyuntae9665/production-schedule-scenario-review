# UI feature inventory

The UI refit retains these original features and decision boundaries:

| Feature | Preserved behavior | New actual frame |
|---|---|---|
| Baseline / typed manual controls | Original A makespan 7; explicit outage or J4 deadline input | 01-base.png |
| Bounded rule / original source | Original text, exact phrase span and source fingerprint; no plan before human confirmation | 02-source-ledger.png |
| Confirmed outage comparison | B makespan 9, same relative-minute axis, downtime band, full-size native scrolling | 03-outage-7-to-9.png |
| Exact-plan review | Separate proposal/plan-fingerprint binding, idempotent review, local receipt and history | 04-review-history.png |
| Replacement proposal | Previous confirmed plan/source retained; new proposal unconfirmed; old receipt historical | 05-unconfirmed-previous-plan.png |
| Explicit deadline | C makespan 8, J4 hard completion at minute 4, native deadline marker | 06-deadline-c-8.png |
| Frozen recorded Qwen | Original rejected raw proposal visible; confirmation disabled; no live inference | 07-archive-rejected.png |
| Incomplete search | UNKNOWN independent from VALID incumbent feasibility; no optimality claim | 08-unknown-incumbent.png |
| Stale source / client | Changed calendar disables confirmation; replaced-proposal inspection returns 409 | 09-stale-source.png |
| Mobile / keyboard | 390px, single-line title, minimum 14px evidence, scrollable chart/ledger, keyboard focus | 10-mobile-390.png |

Solver termination, independent feasibility verification, human interpretation confirmation and exact-plan review remain distinct. All 12 recorded cases, complete/limited/horizon-6 budgets, calendar/reset/reject controls and downloadable receipt remain functional. The browser also checks a minute-30 deadline shared horizon and delayed-response mutation guards. Actual browser assertions are in `artifacts/ui-refit/browser-checks.json`.

No dependencies, backend, model client, evaluation outputs, fixture, prompt, runtime, gold or security rules changed. Existing UI files are outside the frozen source digest set; no overlay is required. Start with `PORT=5157 npm start` on POSIX or set `PORT` then `npm start` on Windows; the default remains 5077. The new browser capture uses the existing project-local ffmpeg runtime and installed Chrome.
