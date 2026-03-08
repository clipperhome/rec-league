import { notFound } from "next/navigation";

import {
  markRainoutAction,
  rescheduleGameAction,
  submitResultAction,
} from "@/app/actions/game";
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
                      <span
                        className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClassName}`}
                      >
                        {status}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
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
                          className="w-full rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                          type="submit"
                        >
                          Save Result
                        </button>
                      </form>

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
