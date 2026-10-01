import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/actions/auth";
import { BrandLink } from "@/app/components/brand-link";
import { getCurrentCommissionerSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { classifyGameState } from "@/lib/game-state";

export const dynamic = "force-dynamic";

export default async function LeaguesDashboardPage() {
  const session = await getCurrentCommissionerSession();
  if (!session) redirect("/manage");

  const now = new Date();
  const [organizedLeagues, managedAssignments] = await Promise.all([
    db.league.findMany({
      where: {
        commissionerEmail: session.email,
        ...(session.scopeLeagueId ? { id: session.scopeLeagueId } : {}),
      },
      orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
      select: {
        _count: {
          select: {
            gameReports: { where: { status: "PENDING" } },
            games: true,
            teams: true,
          },
        },
        archivedAt: true,
        gameDurationMinutes: true,
        games: {
          where: { result: null },
          orderBy: { scheduledAt: "asc" },
          select: { result: { select: { id: true } }, scheduledAt: true, status: true },
        },
        id: true,
        name: true,
        seasonLabel: true,
        slug: true,
        sport: true,
        timezone: true,
      },
    }),
    session.scopeLeagueId
      ? Promise.resolve([])
      : db.teamManager.findMany({
          where: { acceptedAt: { not: null }, email: session.email },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            leagueId: true,
            team: {
              select: {
                _count: {
                  select: { reports: { where: { status: "PENDING" } } },
                },
                id: true,
                leagueId: true,
                name: true,
              },
            },
            league: {
              select: {
                archivedAt: true,
                gameDurationMinutes: true,
                games: {
                  where: {
                    result: null,
                  },
                  orderBy: { scheduledAt: "asc" },
                  select: {
                    awayTeamId: true,
                    homeTeamId: true,
                    result: { select: { id: true } },
                    scheduledAt: true,
                    status: true,
                  },
                },
                id: true,
                name: true,
                seasonLabel: true,
                slug: true,
                sport: true,
                timezone: true,
              },
            },
          },
        }),
  ]);
  const validManagedAssignments = managedAssignments.filter(
    (assignment) =>
      assignment.leagueId === assignment.league.id &&
      assignment.team.leagueId === assignment.league.id,
  );

  return (
    <div className="min-h-screen bg-[#f3f6f2] text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandLink />
          <div className="flex items-center gap-3">
            <Link className="hidden min-h-11 items-center text-sm font-semibold text-[#526159] hover:text-[#0f5138] sm:inline-flex" href="/new">New league</Link>
            <form action={logoutAction}>
              <button className="min-h-11 rounded-lg border border-[#cad7cf] bg-white px-3 text-sm font-semibold text-[#526159] hover:border-[#0f5138] hover:text-[#0f5138]" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">League staff home</p>
            <h1 className="mt-2 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Your league work</h1>
            <p className="mt-3 text-base text-[#627068]">Organizer boards and team-manager desks, separated by role.</p>
          </div>
          <Link className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#0f5138] px-5 py-3 font-bold text-white hover:bg-[#0a3828]" href="/new">Create a league →</Link>
        </div>

        {organizedLeagues.length ? (
          <section className="mt-9">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Organizer</p>
            <h2 className="mt-1 text-2xl font-bold">Leagues you run</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {organizedLeagues.map((league) => (
                <LeagueCard key={league.id} league={league} />
              ))}
            </div>
          </section>
        ) : null}

        {validManagedAssignments.length ? (
          <section className="mt-10 border-t border-[#cad7cf] pt-9">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Team manager</p>
            <h2 className="mt-1 text-2xl font-bold">Teams you represent</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {validManagedAssignments.map((assignment) => {
                const teamGames = assignment.league.games.filter(
                  (game) => game.homeTeamId === assignment.team.id || game.awayTeamId === assignment.team.id,
                );
                const nextGame = findNextGame(
                  teamGames,
                  assignment.league.gameDurationMinutes,
                  now,
                )?.scheduledAt;
                const attentionCount = assignment.league.archivedAt ? 0 : countAttentionGames(
                  teamGames,
                  assignment.league.gameDurationMinutes,
                  now,
                ) + assignment.team._count.reports;
                return (
                  <article className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white shadow-[0_12px_35px_rgba(15,81,56,0.06)]" key={assignment.id}>
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0f6a48]">{assignment.league.name}</p>
                          <h3 className="mt-2 text-2xl font-bold">{assignment.team.name}</h3>
                        </div>
                        <RoleBadge archived={Boolean(assignment.league.archivedAt)} label="Team manager" />
                      </div>
                      <p className={`mt-4 text-sm ${attentionCount ? "font-bold text-amber-800" : "text-[#627068]"}`}>{attentionCount ? `${attentionCount} ${attentionCount === 1 ? "item needs" : "items need"} attention` : nextGame ? `Next game ${formatShortDate(nextGame, assignment.league.timezone)}` : assignment.league.archivedAt ? "Archived season" : "No upcoming game set"}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 border-t border-[#e1e8e3] bg-[#f8faf8] p-4 sm:p-5">
                      <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#0f5138] px-4 py-2 text-sm font-bold text-white" href={`/team/${assignment.team.id}`}>Open team desk</Link>
                      <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bdcbc2] bg-white px-4 py-2 text-center text-sm font-bold text-[#0f5138]" href={`/l/${assignment.league.slug}?team=${assignment.team.id}`}>Public team page</Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {!organizedLeagues.length && !validManagedAssignments.length ? (
          <section className="mt-8 rounded-2xl border border-dashed border-[#afc1b5] bg-white px-6 py-14 text-center">
            <h2 className="text-2xl font-bold">No league roles found</h2>
            <p className="mx-auto mt-2 max-w-md text-[#627068]">Create a league as its organizer, or ask an organizer to invite you to manage a team.</p>
          </section>
        ) : null}
      </main>
    </div>
  );
}

type OrganizedLeague = {
  _count: { gameReports: number; games: number; teams: number };
  archivedAt: Date | null;
  gameDurationMinutes: number;
  games: OperationalGame[];
  id: string;
  name: string;
  seasonLabel: string | null;
  slug: string;
  sport: string | null;
  timezone: string;
};

function LeagueCard({ league }: { league: OrganizedLeague }) {
  const now = new Date();
  const nextGame = findNextGame(league.games, league.gameDurationMinutes, now)?.scheduledAt;
  const attentionCount = league.archivedAt
    ? 0
    : countAttentionGames(league.games, league.gameDurationMinutes, now) +
      league._count.gameReports;
  return (
    <article className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white shadow-[0_12px_35px_rgba(15,81,56,0.06)]">
      <div className="border-b border-[#e1e8e3] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0f6a48]">{[league.sport, league.seasonLabel].filter(Boolean).join(" · ") || "Rec league"}</p>
            <h3 className="mt-2 text-2xl font-bold tracking-tight">{league.name}</h3>
          </div>
          <RoleBadge archived={Boolean(league.archivedAt)} label="Organizer" />
        </div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#627068]">
          <span><strong className="text-[#10231c]">{league._count.teams}</strong> teams</span>
          <span><strong className="text-[#10231c]">{league._count.games}</strong> games</span>
          {attentionCount ? <span className="font-bold text-amber-800">{attentionCount} need attention</span> : null}
          <span>{nextGame ? `Next game ${formatShortDate(nextGame, league.timezone)}` : league.archivedAt ? "Archived season" : "No upcoming game set"}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 bg-[#f8faf8] p-4 sm:p-5">
        <Link className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#0f5138] px-4 py-2 text-center text-sm font-bold text-white" href={attentionCount ? `/dashboard/${league.slug}?view=${league._count.gameReports ? "requests" : "attention"}` : `/dashboard/${league.slug}`}>{attentionCount ? "Review attention" : "Manage league"}</Link>
        <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bdcbc2] bg-white px-4 py-2 text-sm font-bold text-[#0f5138]" href={`/l/${league.slug}`}>Public page</Link>
      </div>
    </article>
  );
}

type OperationalGame = {
  result: { id: string } | null;
  scheduledAt: Date | null;
  status: "COMPLETED" | "RAINED_OUT" | "RESCHEDULED" | "SCHEDULED";
};

function findNextGame(
  games: OperationalGame[],
  durationMinutes: number,
  now: Date,
): OperationalGame | undefined {
  return [...games]
    .filter((game) =>
      ["in-progress", "rescheduled", "scheduled"].includes(
        classifyGameState(game, durationMinutes, now),
      ),
    )
    .sort(
      (left, right) =>
        (left.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )[0];
}

function countAttentionGames(
  games: OperationalGame[],
  durationMinutes: number,
  now: Date,
): number {
  return games.filter((game) =>
    ["rained-out", "result-pending", "tbd"].includes(
      classifyGameState(game, durationMinutes, now),
    ),
  ).length;
}

function RoleBadge({ archived, label }: { archived: boolean; label: string }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${archived ? "bg-amber-100 text-amber-950" : "bg-[#e8f2ec] text-[#0f5138]"}`}>{archived ? `${label} · archived` : label}</span>;
}

function formatShortDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone, year: "numeric" }).format(value);
}
