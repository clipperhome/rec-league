# Rec League

Rec League is a deliberately small operations tool for casual sports leagues. An organizer enters the teams and regular field availability; the app creates a dated round-robin schedule, tracks finals and rainouts, calculates configurable standings, and gives everyone else one public link with no account or app install.

The product has three deliberately different roles:

- **Organizer:** owns league settings, the official schedule and results, team-manager access, and season lifecycle.
- **Team manager:** gets a passwordless, team-scoped desk to report scores or rainouts and propose reschedules. Reports remain private until the organizer approves them.
- **Players and families:** use a public, mobile-first team or league page for the next game, schedule changes, directions, finals, standings, sharing, and a calendar feed.

## Product flow

1. Create a league with its teams, season start, game days, start times, fields, and time zone.
2. Review and operate the season from the organizer board, including batch score entry and an explicit preview-before-apply flow for rebuilding every unplayed game.
3. Invite team managers, then approve or decline their team-scoped reports.
4. Share `/l/[slug]` or a team-filtered URL with players and families.
5. Staff return through one-use passwordless email links. Public viewers never sign in.
6. Archive a completed season without removing its public history.

The schedule engine uses the circle method, supports 2–20 teams, spills rounds across available capacity, accounts for daylight-saving changes, rotates scarce field/time slots, prevents duration-aware team and field overlaps, and preserves finals when filling or rebuilding a schedule.

## Data ownership and offline use

Rec League has two source-of-truth modes:

- **Connected league:** the hosted database is official. An organizer JSON export or
  team packet is a workfile whose typed outbox must be previewed and reconciled by
  the authenticated online league. Schedule rebuilds, roster additions/removals,
  manager invitations, and connected report approval stay online.
- **Local-only league:** the `.rec-league.json` file is official. One trusted
  organizer edits it at a time in the self-contained `rec-league.html` app and
  saves or downloads the JSON after each session.

The webpage contains code; the JSON contains data. Replacing the webpage upgrades
the tool without changing the league. JSON is the only full-fidelity application
format. XLSX and CSV are optional interchange copies, never application storage.

### Connected offline workflow

1. Download `rec-league.html` once and a fresh organizer backup or team packet.
2. Open the HTML directly, open the JSON, prepare changes, and save/download JSON.
3. Return to the authenticated Portable data or team page and upload that workfile.
4. Review each `ready`, `conflict`, `rejected`, or `blocked` item before applying.
5. Download the reconciled JSON. The hosted league remains official throughout.

A family HTML download is a privacy-safe, immutable snapshot. Generate a new one
after schedule or result changes; it does not poll the connected league.

### Local-only workflow and recovery

Create or open a league in `rec-league.html`, then immediately download its first
JSON file. Browsers with the File System Access API can save back to the opened
file; other browsers download a new copy. Session undo is convenience, not backup.

The browser also keeps a clearly labelled recovery copy on that browser and
device. It may contain private league data and can disappear when site data is
cleared, storage is evicted, or the device fails. After recovery, immediately
download a durable JSON file. Avoid simultaneous editors: exchange one current
file and let one organizer make changes at a time.

### Upgrades

Keep the JSON untouched and replace `rec-league.html`. When a supported older
document opens, migration happens to an in-memory copy; the original file is not
overwritten until the user deliberately saves. A newer unsupported schema is
refused so an old app cannot rewrite it. Keep a backup before any import or
migration.

### Export privacy

| Export | Contents and intended use | Handling |
|---|---|---|
| Organizer JSON | Full durable data, organizer/manager emails, report notes, and activity | Private; backup, offline work, or create-copy import |
| XLSX workbook | Editable operational tables plus private Managers, Reports, and Activity sheets | Private; validated analysis/bulk edits, never source of truth |
| Team packet | One team's games and reports plus opponent display names | Private to that manager; excludes other manager identities/history |
| Public JSON / family HTML | Teams, venue, schedule, official results, scoring, and standings | Shareable and read-only |
| CSV table | One privacy-safe Teams, Games, Results, or Standings table | Analysis only; not a backup or import format |

Exports are plaintext, not encrypted. Sessions, magic-link tokens, credentials,
rate-limit records, operation receipts, and internal pending keys are never
exported.

### Spreadsheet workflow

Download the private `.xlsx` workbook from the organizer Portable data page.
Excel and Google Sheets can edit it; Google Sheets can import and export XLSX.
Preserve `record_id` and `record_version`, enter dates/times/IDs as literal text,
and use the explicit `delete` column where supported. Missing rows never delete
records. Formulas and automatically coerced dates are rejected.

Upload the edited XLSX for a before/after preview. Current IDs, versions, locked
games, overlaps, and authority rules are checked again. Nothing is written unless
every proposed change is ready, and all changes commit in one transaction. Some
changes—such as schedule rhythm, time zone, roster rebuilds, and report approval—
must still use their purpose-built online workflow. CSV is export-only. Local-only
organizers can download privacy-safe CSV analysis tables from the offline app, but
must keep JSON as the official file.

## Stack

- Next.js App Router, React, TypeScript, and Tailwind CSS
- Prisma with SQLite for zero-setup local development
- Prisma with PostgreSQL for persistent production hosting
- Resend HTTPS API for production magic-link email

## Local development

Prisma 7.10 requires Node.js 20.19+, 22.12+, or 24+.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). SQLite is selected by the `file:` database URL. In development, sign-in requests print a one-use link to the terminal and also expose it on the confirmation screen; no email provider is needed.

With `REC_LEAGUE_DEV_PROFILE_SWITCHER=1`, a minimized **DEV** control lets you switch a local SQLite league between organizer, team-manager, and public/family views. It is restricted to loopback requests and is never rendered in production or while using PostgreSQL. If a league has no manager, the manager preview creates a clearly marked local test assignment for its first team.

Useful checks:

```bash
npm run schema:generate
npm run schema:check
npm run db:schema:check
npm test
npm run lint
npm run typecheck
npm run portable:build
npm run verify
```

`npm run portable:build` emits the generated `dist/rec-league.html`, verifies its
offline CSP and lack of network dependencies, then copies it to the ignored
`public/downloads/rec-league.html` runtime asset. `npm run build` does this
automatically. Schema generation also publishes the declared static JSON Schema
at `public/schemas/rec-league/v1.json`; `schema:check` prevents drift.

The optimized build is a production check and intentionally requires the
PostgreSQL environment described below.

## Production setup

SQLite files are not durable on serverless hosts, so production should use PostgreSQL. The URL scheme selects the correct Prisma client and migration tree automatically.
The app refuses to start in production if `DATABASE_URL` is missing, uses SQLite, or has an unsupported URL scheme.

Set these environment variables:

```bash
DATABASE_URL=postgresql://user:password@host/rec_league?sslmode=require
DATABASE_POOL_MAX=3
APP_URL=https://your-domain.example
RESEND_API_KEY=re_...
AUTH_FROM_EMAIL="Rec League <leagues@your-domain.example>"
```

Apply the PostgreSQL baseline before the first release, then build:

```bash
DATABASE_URL="$DATABASE_URL" npm run db:migrate
DATABASE_URL="$DATABASE_URL" npm run build
```

The provider-specific migrations create the PostgreSQL schema; they do not copy an
existing SQLite league into PostgreSQL. A complete organizer JSON import creates a
separate league with remapped IDs: the currently verified user becomes organizer,
manager access must be invited again, and imported pending reports become history.
It never overwrites the source league.

`APP_URL` is the trusted redirect origin for magic links. `AUTH_FROM_EMAIL` must be an address accepted by the configured Resend account.
`DATABASE_POOL_MAX` defaults to 3 connections per app instance and can be set from 1–20 to match the database provider's connection budget.

## Project map

- `app/new/` — schedule-first league setup
- `app/manage/` — shared organizer/team-manager magic-link entry
- `app/dashboard/` — role-aware staff home and organizer board
- `app/team/[teamId]/` — authenticated, team-scoped manager desk
- `app/l/[slug]/` — mobile-first public league board and calendar feed
- `app/actions/` — authenticated mutations and setup workflows
- `app/api/leagues/[slug]/portable/` — scoped exports, copy import, reconciliation, family HTML, and spreadsheet preview/apply
- `lib/schedule.ts` — pure round-robin and calendar assignment engine
- `lib/game-state.ts` and `lib/game-conflicts.ts` — shared state and overlap rules
- `lib/standings.ts` and `lib/ics.ts` — standings and calendar generation
- `lib/auth.ts` and `lib/email.ts` — scoped sessions and passwordless access
- `lib/portable/` — browser-safe schema, validation, migrations, projections, commands, CSV, and public HTML
- `lib/portable-server/` — database export/copy, idempotent operations, and reconciliation planning
- `lib/spreadsheet/` — XLSX generation, validation, diff descriptions, and atomic apply
- `portable/` — separate self-contained offline application entry point
- `schemas/` and `public/schemas/` — source and published portable JSON Schema
- `prisma/sqlite/` and `prisma/postgresql/` — provider-specific schemas and migrations

## Release handoff

No production deployment has been performed. Deployment requires explicit user
approval. The remaining release task is to provision PostgreSQL, apply migrations,
configure `APP_URL`, Resend, and the domain, deploy, then live-smoke:

- organizer magic-link return and complete backup;
- team-manager report submission and organizer approval;
- public no-login page and calendar;
- offline app download, save/reopen, reconciliation, and family snapshot;
- workbook/CSV export plus workbook preview and atomic apply.

## V1 boundaries

There are no player accounts, rosters, chat, payments, notifications, divisions, or individual statistics. Team managers report operational facts; they do not get rosters, messaging, or authority over the official league record.
