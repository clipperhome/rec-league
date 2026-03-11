import { notFound, redirect } from "next/navigation";

import {
  markRainoutAction,
  rescheduleGameAction,
  submitResultAction,
  toggleLockAction,
} from "@/app/actions/game";
import { addTeamAction, removeTeamAction } from "@/app/actions/team";
import { getCommissionerSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

type DashboardLeague = NonNullable<Awaited<ReturnType<typeof getDashboardLeague>>>;
type DashboardGame = DashboardLeague["games"][number];
type GameDisplayStatus = "completed" | "rained_out" | "rescheduled" | "scheduled";

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { slug } = await params;

  const session = await getCommissionerSession(slug);

  if (!session) {
    redirect(`/dashboard/${slug}/login`);
  }

  const league = await getDashboardLeague(slug);

  if (!league) {
    notFound();
  }

  const gamesByRound = groupGamesByRound(league.games);

  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <main className="mx-auto max-w-6xl space-y-8 px-4">
        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Commissioner Dashboard
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
            {league.name}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Enter scores, mark rainouts, or reschedule games.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4">
            <a
              className="text-sm text-zinc-500 transition hover:text-zinc-900"
              href={`/l/${slug}`}
            >
              View public page →
            </a>
            <span className="text-zinc-300">|</span>
            <span className="text-sm text-zinc-400">
              Logged in as {session.email}
            </span>
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-zinc-900">Season Overview</h2>
          <div className="mt-5 space-y-4">
            {gamesByRound.map(([round, games]) => (
              <div key={round}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  Round {round}
                </p>
                <div className="flex flex-wrap gap-2">
                  {games.map((g) => {
                    const status = getDisplayStatus(g);
                    const cardStyle = getOverviewCardStyle(status);

                    return (
                      <div
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${cardStyle}`}
                        key={g.id}
                      >
                        <span className="font-semibold">{g.homeTeam.name}</span>
                        {status === "completed" && g.result ? (
                          <span className="rounded-md bg-white/60 px-1.5 py-0.5 font-bold tabular-nums">
                            {g.result.homeScore}–{g.result.awayScore}
                          </span>
                        ) : (
                          <span className="text-[10px] opacity-60">vs</span>
                        )}
                        <span className="font-semibold">{g.awayTeam.name}</span>
                        {status === "rained_out" ? (
                          <span className="ml-1 text-[10px] uppercase opacity-70">☔</span>
                        ) : null}
                        {status === "rescheduled" ? (
                          <span className="ml-1 text-[10px] uppercase opacity-70">🔄</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-zinc-900">Teams</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Add new teams or remove teams that have no games scheduled.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {league.teams.map((team) => {
              const gameCount = league.games.filter(
                (g) => g.homeTeam.name === team.name || g.awayTeam.name === team.name
              ).length;
              return (
                <div
                  className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
                  key={team.id}
                >
                  <span className="font-medium text-zinc-900">{team.name}</span>
                  {gameCount === 0 ? (
                    <form action={removeTeamAction} className="inline">
                      <input name="slug" type="hidden" value={slug} />
                      <input name="teamId" type="hidden" value={team.id} />
                      <button
                        className="text-xs text-red-500 transition hover:text-red-700"
                        title="Remove team"
                        type="submit"
                      >
                        ✕
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs text-zinc-400" title={`${gameCount} game(s) scheduled`}>
                      {gameCount}g
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <form action={addTeamAction} className="mt-4 flex gap-2">
            <input name="slug" type="hidden" value={slug} />
            <input
              className="flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900"
              name="teamName"
              placeholder="New team name"
              required
              type="text"
            />
            <button
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
              type="submit"
            >
              Add Team
            </button>
          </form>
        </section>

        {gamesByRound.map(([round, games]) => (
          <section
            className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm"
            key={round}
          >
            <h2 className="text-xl font-semibold text-zinc-900">Round {round}</h2>
            <div className="mt-4 space-y-4">
              {games.map((game) => {
                const status = getDisplayStatus(game);
                const statusClassName = getStatusClassName(status);

                return (
                  <article
                    className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4"
                    key={game.id}
                  >
                    <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-base font-semibold text-zinc-900">
                          {game.homeTeam.name} vs {game.awayTeam.name}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {formatScheduledAt(game.scheduledAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <form action={toggleLockAction}>
                          <input name="gameId" type="hidden" value={game.id} />
                          <button
                            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${
                              game.locked
                                ? "bg-red-100 text-red-700 hover:bg-red-200"
                                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                            }`}
                            title={game.locked ? "Unlock this game to allow score edits" : "Lock this game to prevent score changes"}
                            type="submit"
                          >
                            {game.locked ? "🔒 Locked" : "🔓 Unlocked"}
                          </button>
                        </form>
                        <span
                          className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClassName}`}
                        >
                          {status}
                        </span>
                      </div>
                    </div>

                    <div className={`mt-4 grid gap-4 lg:grid-cols-3 ${game.locked ? "pointer-events-none opacity-50" : ""}`}>
                      <fieldset disabled={game.locked}>
                      <form
                        action={submitResultAction}
                        className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-3"
                      >
                        <p className="text-sm font-semibold text-zinc-900">
                          Enter / Edit Score
                        </p>
                        <input name="gameId" type="hidden" value={game.id} />
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1 text-xs font-medium text-zinc-600">
                            Home
                            <input
                              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                              defaultValue={game.result?.homeScore ?? ""}
                              min={0}
                              name="homeScore"
                              required
                              step={1}
                              type="number"
                            />
                          </label>
                          <label className="space-y-1 text-xs font-medium text-zinc-600">
                            Away
                            <input
                              className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                              defaultValue={game.result?.awayScore ?? ""}
                              min={0}
                              name="awayScore"
                              required
                              step={1}
                              type="number"
                            />
                          </label>
                        </div>
                        <button
                          className="w-full rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
                          type="submit"
                        >
                          Save Result
                        </button>
                      </form>
                      </fieldset>

                      <form
                        action={markRainoutAction}
                        className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-3"
                      >
                        <p className="text-sm font-semibold text-zinc-900">
                          Mark Rainout
                        </p>
                        <p className="text-xs text-zinc-500">
                          Clears any saved score and sets status to rainout.
                        </p>
                        <input name="gameId" type="hidden" value={game.id} />
                        <button
                          className="w-full rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
                          type="submit"
                        >
                          Mark Rained Out
                        </button>
                      </form>

                      <form
                        action={rescheduleGameAction}
                        className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-3"
                      >
                        <p className="text-sm font-semibold text-zinc-900">
                          Reschedule
                        </p>
                        <input name="gameId" type="hidden" value={game.id} />
                        <label className="space-y-1 text-xs font-medium text-zinc-600">
                          New date / time
                          <input
                            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                            defaultValue={toDateTimeLocalValue(game.scheduledAt)}
                            name="scheduledAt"
                            required
                            type="datetime-local"
                          />
                        </label>
                        <label className="space-y-1 text-xs font-medium text-zinc-600">
                          Round override (optional)
                          <input
                            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                            min={1}
                            name="round"
                            placeholder={`${game.round}`}
                            step={1}
                            type="number"
                          />
                        </label>
                        <button
                          className="w-full rounded-xl bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
                          type="submit"
                        >
                          Save Reschedule
                        </button>
                      </form>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

async function getDashboardLeague(slug: string) {
  return db.league.findUnique({
    where: {
      slug,
    },
    select: {
      games: {
        orderBy: [
          {
            round: "asc",
          },
          {
            id: "asc",
          },
        ],
        select: {
          awayTeam: {
            select: {
              name: true,
            },
          },
          homeTeam: {
            select: {
              name: true,
            },
          },
          id: true,
          locked: true,
          result: {
            select: {
              awayScore: true,
              homeScore: true,
            },
          },
          round: true,
          scheduledAt: true,
          status: true,
        },
      },
      name: true,
      slug: true,
      teams: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

function getDisplayStatus(game: DashboardGame): GameDisplayStatus {
  if (game.status === "COMPLETED" || game.result) {
    return "completed";
  }

  if (game.status === "RAINED_OUT") {
    return "rained_out";
  }

  if (game.status === "RESCHEDULED") {
    return "rescheduled";
  }

  return "scheduled";
}

function getStatusClassName(status: GameDisplayStatus): string {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "rained_out":
      return "bg-amber-100 text-amber-800";
    case "rescheduled":
      return "bg-blue-100 text-blue-800";
    case "scheduled":
      return "bg-zinc-200 text-zinc-700";
  }
}

function getOverviewCardStyle(status: GameDisplayStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "rained_out":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "rescheduled":
      return "border-blue-200 bg-blue-50 text-blue-900";
    case "scheduled":
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
  }
}

function groupGamesByRound(games: DashboardGame[]): Array<[number, DashboardGame[]]> {
  const rounds = new Map<number, DashboardGame[]>();

  for (const game of games) {
    const existing = rounds.get(game.round);

    if (existing) {
      existing.push(game);
      continue;
    }

    rounds.set(game.round, [game]);
  }

  return Array.from(rounds.entries());
}

function formatScheduledAt(date: Date | null): string {
  if (!date) {
    return "Date and time TBD";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toDateTimeLocalValue(date: Date | null): string {
  if (!date) {
    return "";
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}
