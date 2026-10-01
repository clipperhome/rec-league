# Rec League Operations — PLAN.md

## Why We're Building This

The sports league management space has existing players: TeamSnap, LeagueApps, Spond, TeamLinkt, Heja, Stack Team App. Price is no longer the gap — several free options exist.

**The real shortfalls we're solving:**

1. **Every tool requires an app install** — parents and players don't want another app for one recreational league. None of the existing tools offer a dead-simple public web URL that works with no login, no install, no account.

2. **Built for teams, not leagues** — most tools manage one team's roster and attendance. League-level features (round-robin schedule generation across 6-20 teams, cross-team standings, rainout rescheduling) are weak or paywalled.

3. **Too complex for volunteer use cases** — even free tools have onboarding flows, settings menus, feature pages. A volunteer spending 2 hours/week on league management shouldn't need to learn software.

4. **Upsell pressure destroys trust** — TeamSnap reviewers cite ads, accidental subscriptions, constant upsell prompts on the free tier.

**Our differentiator: radical simplicity + no install**
- Organizer running in under 5 minutes
- Players/parents get a link — no app, no account, no friction
- Does exactly 5 things well, nothing more
- The public URL is the distribution mechanism — organizers and managers share it with 60-100 people organically

---

## Problem
Volunteer rec league organizers and team managers coordinate schedules, standings, scores, and rainouts using Google Sheets and group texts. Existing free tools (Spond, TeamLinkt) still require app installs and are too complex for a casual league.

## Solution (V1)
A free web app with three role-shaped experiences:
1. Create a league (name, sport, teams, game days, start times, fields, and time zone)
2. Auto-generate a dated round-robin schedule
3. Adjust teams before results begin and rebuild safely
4. Invite a team manager to submit team-scoped reports for organizer approval
5. Share a public URL — one page showing the next game, schedule updates, directions, results, standings, and calendar feed
6. Mark one or several results quickly
7. Handle rainouts, rescheduling, corrections, and season archiving

No auth is required for viewers. Organizers and invited team managers use one-use magic links; no passwords are stored.

## Stack
Next.js 16, TypeScript, Tailwind, SQLite (via Prisma) locally, PostgreSQL in production, Vercel for deploy.

## Current State — Three-Role and Portability Resets Complete, Awaiting Explicit Deployment

The original local prototype proved the round-robin and standings path, but left most games without dates and had no viable returning-user flow. The product reset keeps the small V1 scope while making the main loop operational:

- Setup now produces a playable calendar, not just pairings.
- Staff have a role-aware home and real production magic-link delivery.
- Organizers have a league-wide control board; team managers have a team-only report desk; families have a no-login public page.
- Reports use explicit invitations, organizer approval, stale-game protection, and transactional league/team/game checks.
- Public game states, venue/directions, freshness polling, native sharing, team filtering, custom scoring, and calendar export are implemented.
- Results, rainouts, rescheduling, schedule rebuilds, team changes, and season archiving enforce server-side ownership and lifecycle rules.
- SQLite and PostgreSQL use matching provider-specific clients and migrations.
- The scheduling domain has automated coverage for pairing completeness, capacity, conflicts, fairness, and time zones.

Local verification now covers the three-role product, portable JSON ownership,
safe connected reconciliation, the replaceable offline app, family snapshots,
XLSX interchange, and CSV analysis exports. Production deployment and live
email/domain configuration remain a separate, explicitly approved release step.

---

## Portability Product Contract

The app has two deliberately different ownership modes:

1. **Connected league:** the hosted database is the official copy. The organizer
   publishes authoritative changes, team managers can submit only team-scoped
   reports, and families have read-only public access.
2. **Local-only league:** a human-readable `.rec-league.json` document is the
   official copy. One trusted organizer operates it in a self-contained offline
   webpage.

The replaceable webpage contains application code only. League data always stays
in a separate versioned JSON document. Replacing the webpage upgrades the app
without replacing or silently rewriting the user's data.

JSON is the only full-fidelity portable data format. Excel (`.xlsx`) is an
optional, validated interchange format for analysis and deliberate bulk edits.
CSV is a one-way, per-table analysis export; neither format is application
storage. Browser storage is crash recovery only, never the sole copy.

A connected copy is reconciled through typed, idempotent operations with version
preconditions. It is never synchronized by uploading a whole document and letting
the last writer win. Imported files never grant organizer or manager authority.

### Portable safety rules

- Export only explicit allowlists. Never export sessions, magic-link tokens,
  rate-limit records, credentials, sync receipts, or derived `pendingKey` values.
- A full backup contains private emails and report notes and must say so clearly.
- Organizer backup, public snapshot, team-manager packet, and spreadsheet
  operations are distinct scopes. A partial scope can never restore a league.
- Imports are bounded, strictly parsed, migrated in memory, fully validated,
  previewed, and applied atomically against the exact revision that was previewed.
- Imported owner emails, accepted manager states, and audit actors are historical
  data only. The currently verified organizer retains authority, and restored
  manager access requires a new invitation.
- Spreadsheets use stable IDs and versions. Missing rows never mean deletion;
  deletion must be explicit. Formula cells and spreadsheet-injection payloads are
  rejected or safely escaped.
- Families receive only data already visible on the public page. Team managers
  never receive another team's private reports or manager identity.
- Newer, unsupported document versions are never rewritten by an older app.

---

## Portability Execution Plan

These tasks are executed in order. A later task may begin only after the preceding
task's acceptance gate passes.

### P1 — Freeze portable format v1

Create a browser-safe portable core with exact TypeScript types, a published JSON
Schema, strict parsing and validation, deterministic serialization, export-scope
projections, and a migration registry.

The v1 document contains stable IDs and record versions for the league, teams,
games, results, manager references, reports, and activity. It stores a monotonic
league `dataRevision`, explicit UTC/local scheduling context, and no authentication
or infrastructure records.

**Acceptance gate:** valid fixtures round-trip deterministically; malformed,
cross-referenced, duplicate, future-version, and private-record fixtures fail with
path-specific errors; scope projections cannot leak private data.

### P2 — Add revisions and idempotent mutation foundations

Add matching SQLite/PostgreSQL migrations for league and record versions plus
operation receipts. Every durable mutation increments the league revision in the
same transaction. A shared coordinator checks role, league/team scope, archive
state, operation ID, and expected record version before applying a change.

**Acceptance gate:** retries do not duplicate writes; stale writes conflict;
unrelated record changes can merge; revoked/out-of-scope managers and archived
leagues cannot mutate; SQLite and PostgreSQL schemas remain equivalent.

### P3 — Deliver JSON ownership in the connected app

Add organizer-only controls and routes for:

- complete JSON backup;
- privacy-safe public JSON;
- team-manager packets;
- create-copy import.

The workflow is: choose file, parse and validate, show its contents and authority
remapping, download the current backup, then confirm atomic copy creation. The
server recomputes the preview from the exact validated document and rejects a
changed target revision. Applying changes to an existing connected league belongs
to P4's typed operation reconciliation.

**Acceptance gate:** database → JSON → fresh database → JSON preserves all domain
data except documented export metadata and authority remapping; corrupt, partial,
stale, or newer files perform zero writes; restored files cannot grant access.

### P4 — Add safe offline reconciliation

Represent offline edits as typed commands with an operation ID, target ID, base
league revision, expected record version, and strictly typed payload. Organizer
commands may reconcile eligible official data; manager commands may append only
team-scoped reports. The server derives identity and scope from the session.

The first sync UX is manual file exchange from the authenticated dashboard. Each
operation returns `applied`, `conflict`, `rejected`, or `blocked-by-dependency`, and
successful reconciliation returns a fresh official document.

**Acceptance gate:** retrying the same file is harmless; online conflicts are
visible and preserved; a manager cannot mutate official games or standings; one
conflict does not discard unrelated edits.

### P5 — Build the replaceable single-file organizer app

Build a separate browser entry point over the portable core and pure domain
commands. A reproducible build emits `dist/rec-league.html` with all JavaScript,
CSS, icons, and fonts embedded and no network dependency.

It supports creating/opening JSON, schedules, scores, rainouts, reschedules,
standings, archive, local-only report review, session undo, clearly labelled
device recovery, in-place save where supported, and download fallback everywhere.
Connected report approval remains an authenticated organizer action online.

**Acceptance gate:** the file opens directly with networking disabled; create,
edit, recover, download, and reopen work; no external requests occur; migration
never alters the only original; replacing the HTML does not touch league data.

### P6 — Add read-only portable family output

Generate a self-contained public HTML snapshot that preserves the current family
experience: next game, filters, updates, directions, schedule, results, and
standings. Embedded data is escaped as inert content.

**Acceptance gate:** the snapshot works offline, has no write path, and automated
tests prove private fields and script-injection payloads cannot appear or execute.

### P7 — Add spreadsheet interchange

Use the same validator, preview engine, conflict rules, and atomic commit path for
validated `.xlsx` import/export. UTF-8 CSV is a deliberately one-way, per-table
analysis export so a lossy flat file can never become application state. Workbooks
contain `README`, `League`, `Teams`, `Games`,
`Results`, `Managers`, `Reports`, `Activity`, and derived `Standings` sheets.

Editable rows include stable `record_id`, `record_version`, and explicit `delete`.
Formulas are rejected on import; timestamps and IDs remain text; missing rows never
delete records; derived sheets are ignored during import.

**Acceptance gate:** a valid edited workbook produces a before/after preview and
commits all ready changes in one transaction; privacy-safe CSV tables open in Excel
and Google Sheets but have no import path;
duplicates, broken references, formulas, coerced dates, overlaps, stale versions,
and locked-game changes block apply; malformed files perform zero writes.

### P8 — Release verification and documentation

Run format, authorization, privacy, injection, rollback, concurrency, schema
parity, offline-build, lint, type, unit, migration, and production-build checks.
Document recovery, upgrades, privacy scopes, and the difference between connected
and local-only ownership.

**Acceptance gate:** all automated checks pass and the remaining deployment step
is documented. Deployment still requires an explicit user request.

**Local verification — 2026-09-15:** `npm run verify` passed schema drift and
provider-parity checks, 82 unit/integration/security tests, lint, both TypeScript
targets, and the single-file offline build verifier. A fresh SQLite database
applied all 12 migrations and produced no schema diff. The optimized Next.js build
passed with a PostgreSQL-shaped production environment, and `npm audit` reported
zero vulnerabilities. No deployment or live external-service mutation was run.

---

## Original Product Task Dependency Graph

```
[A] DB schema + Prisma setup
[B] Round-robin schedule algorithm          (independent)
[C] League setup UI (create league, add teams)    (needs A)
[D] Schedule generation API                 (needs A + B)
[E] Public league page (schedule + standings)     (needs A)
[F] Commissioner dashboard (mark results, rainouts) (needs C + D + E)
[G] Magic-link auth                         (needs A)
[H] Deploy to Vercel + env setup            (needs everything)
```

## Tasks

| Task | Depends On | Primary Files | Status |
|------|-----------|---------------|--------|
| A — Provider-compatible DB schema | none | prisma/, lib/db.ts | Complete |
| B — Round-robin + calendar engine | none | lib/schedule.ts | Complete + tested |
| C — League setup UI | A | app/new/ | Complete |
| D — Schedule generation workflow | A + B | app/actions/league.ts, app/actions/schedule.ts | Complete |
| E — Public league page | A | app/l/[slug]/ | Complete |
| F — Organizer and manager operations | C + D + E | app/dashboard/, app/team/ | Complete |
| G — Magic-link auth | A | app/manage/, app/api/auth/, lib/auth.ts | Complete |
| P1 — Portable format v1 | A–G | lib/portable/, schemas/ | Complete + tested |
| P2 — Revisions + idempotency | P1 | prisma/, app/actions/, lib/ | Complete + tested |
| P3 — JSON ownership | P1 + P2 | app/api/, app/dashboard/, lib/portable/ | Complete + tested |
| P4 — Offline reconciliation | P2 + P3 | app/api/, lib/portable/ | Complete + tested |
| P5 — Single-file offline app | P1 + P4 | portable/, scripts/, dist/ | Complete + tested |
| P6 — Public offline snapshot | P1 + P5 | lib/portable/, app/api/, portable/ | Complete + tested |
| P7 — Spreadsheet interchange | P3 | lib/spreadsheet/, app/api/, app/components/ | Complete + tested |
| P8 — Verification + docs | P1–P7 | tests, README.md | Complete + verified locally |
| H — Deploy and live smoke test | P8 | hosting + environment configuration | Pending explicit deployment |

## Parallel Batches

- **Batch 1 (run together):** A (DB schema) + B (schedule algorithm)
- **Batch 2 (run together):** C (setup UI) + D (schedule API) + E (public page) + G (magic-link auth)
- **Batch 3 (sequential):** F (commissioner dashboard — needs everything working)
- **Portability program:** P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8
- **Release:** H (deploy, only after explicit approval)

## Out of Scope (V1)
- Native app
- Payments / premium features
- Player profiles or stats beyond W/L/points
- Multi-division leagues
- Team communication / chat
- Notifications / reminders
