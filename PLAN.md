# Rec League Commissioner Dashboard — PLAN.md

## Why We're Building This

The sports league management space has existing players: TeamSnap, LeagueApps, Spond, TeamLinkt, Heja, Stack Team App. Price is no longer the gap — several free options exist.

**The real shortfalls we're solving:**

1. **Every tool requires an app install** — parents and players don't want another app for one recreational league. None of the existing tools offer a dead-simple public web URL that works with no login, no install, no account.

2. **Built for teams, not leagues** — most tools manage one team's roster and attendance. League-level features (round-robin schedule generation across 6-20 teams, cross-team standings, rainout rescheduling) are weak or paywalled.

3. **Too complex for volunteer use cases** — even free tools have onboarding flows, settings menus, feature pages. A volunteer spending 2 hours/week on league management shouldn't need to learn software.

4. **Upsell pressure destroys trust** — TeamSnap reviewers cite ads, accidental subscriptions, constant upsell prompts on the free tier.

**Our differentiator: radical simplicity + no install**
- Commissioner running in under 5 minutes
- Players/parents get a link — no app, no account, no friction
- Does exactly 5 things well, nothing more
- The public URL is the distribution mechanism — commissioners share it with 60-100 people organically

---

## Problem
Volunteer rec league commissioners manage schedules, standings, and rainouts using Google Sheets and group texts. Existing free tools (Spond, TeamLinkt) still require app installs and are too complex for a volunteer running a casual league.

## Solution (V1)
A free web app where a commissioner can:
1. Create a league (name, sport, game nights, fields)
2. Add teams
3. Auto-generate a round-robin schedule
4. Share a public URL — one page showing schedule, standings, results (mobile-friendly)
5. Mark game results in 10 seconds
6. Handle rainouts with a simple reschedule flow

No auth required for viewers. Commissioner gets a magic-link login (no password needed).

## Stack
Next.js 15, TypeScript, Tailwind, SQLite (via Prisma) for V1 local, Vercel for deploy.

---

## Task Dependency Graph

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

| Task | Depends On | Files Touched | Parallel? |
|------|-----------|---------------|-----------|
| A — DB schema (League, Team, Game, Result) | none | prisma/schema.prisma, lib/db.ts | ✅ start here |
| B — Round-robin algorithm | none | lib/schedule.ts | ✅ parallel with A |
| C — League setup UI | A | app/setup/, components/SetupForm.tsx | after A |
| D — Schedule generation API | A + B | app/api/schedule/ | after A + B |
| E — Public league page | A | app/league/[slug]/, components/Standings.tsx, components/Schedule.tsx | after A |
| F — Commissioner dashboard | C + D + E | app/dashboard/, components/ResultForm.tsx | after C+D+E |
| G — Magic-link auth | A | app/api/auth/, lib/auth.ts | after A, parallel with C+D+E |
| H — Deploy | all | vercel.json, .env.example | last |

## Parallel Batches

- **Batch 1 (run together):** A (DB schema) + B (schedule algorithm)
- **Batch 2 (run together):** C (setup UI) + D (schedule API) + E (public page) + G (magic-link auth)
- **Batch 3 (sequential):** F (commissioner dashboard — needs everything working)
- **Batch 4:** H (deploy)

## Out of Scope (V1)
- Native app
- Payments / premium features
- Player profiles or stats beyond W/L/points
- Multi-division leagues
- Team communication / chat
- Notifications / reminders
