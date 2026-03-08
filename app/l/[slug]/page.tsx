import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { buildStandings } from "@/lib/standings";

export const dynamic = "force-dynamic";

type LeaguePageProps = {
  params: Promise<{
    slug: string;
  }>;
};

type LeagueRecord = NonNullable<Awaited<ReturnType<typeof getLeagueBySlug>>>;
type LeagueGame = LeagueRecord["games"][number];
type GameDisplayStatus = "completed" | "rained_out" | "rescheduled" | "scheduled";

export default async function LeaguePage({ params }: LeaguePageProps) {
  const { slug } = await params;
  const league = await getLeagueBySlug(slug);

  if (!league) {
    notFound();
  }

  const standings = buildStandings(league.teams, league.games);
  const rounds = groupGamesByRound(league.games);
  const leagueMeta = [league.sport, league.seasonLabel ?? league.fieldNames]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <main className="mx-auto max-w-6xl space-y-8 px-4">
        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Public League Page
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
            {league.name}
          </h1>
          {leagueMeta.length > 0 ? (
            <p className="mt-3 text-sm text-zinc-600">
              {leagueMeta.join(" • ")}
            </p>
          ) : null}
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-zinc-900">Standings</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Win = 3 points, Tie = 1 point.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-zinc-200 text-left text-zinc-500">
                  <tr>
                    <th className="px-3 py-3 font-medium">#</th>
                    <th className="px-3 py-3 font-medium">Team</th>
                    <th className="px-3 py-3 font-medium">W</th>
                    <th className="px-3 py-3 font-medium">L</th>
                    <th className="px-3 py-3 font-medium">T</th>
                    <th className="px-3 py-3 font-medium">Pts</th>
                    <th className="px-3 py-3 font-medium">GF</th>
                    <th className="px-3 py-3 font-medium">GA</th>
                    <th className="px-3 py-3 font-medium">GD</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, index) => (
                    <tr
                      className="border-b border-zinc-100 last:border-b-0"
                      key={row.teamId}
                    >
                      <td className="px-3 py-3 text-zinc-500">{index + 1}</td>
                      <td className="px-3 py-3 font-medium text-zinc-900">
                        {row.teamName}
                      </td>
                      <td className="px-3 py-3 text-zinc-600">{row.wins}</td>
                      <td className="px-3 py-3 text-zinc-600">{row.losses}</td>
                      <td className="px-3 py-3 text-zinc-600">{row.ties}</td>
                      <td className="px-3 py-3 font-semibold text-zinc-900">
                        {row.points}
                      </td>
                      <td className="px-3 py-3 text-zinc-600">{row.goalsFor}</td>
                      <td className="px-3 py-3 text-zinc-600">
                        {row.goalsAgainst}
                      </td>
                      <td className="px-3 py-3 text-zinc-600">
                        {row.goalDifferential}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-5">
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-zinc-900">Schedule</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Results appear here as games are reported.
              </p>
            </div>

            {rounds.map(([round, games]) => (
              <div
                className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm"
                key={round}
              >
                <h3 className="text-lg font-semibold text-zinc-900">
                  Round {round}
                </h3>
                <div className="mt-4 space-y-3">
                  {games.map((game) => {
                    const status = getDisplayStatus(game);

                    return (
                      <article
                        className={`rounded-2xl border px-4 py-4 ${getCardClassName(status)}`}
                        key={game.id}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-base font-medium text-zinc-900">
                              {game.homeTeam.name} vs {game.awayTeam.name}
                            </p>
                            <p className="mt-1 text-sm text-zinc-500">
                              {formatGameMeta(game)}
                            </p>
                          </div>
                          <span
                            className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusClassName(status)}`}
                          >
                            {status}
                          </span>
                        </div>

                        {status === "completed" && game.result ? (
                          <p className="mt-3 text-sm font-semibold text-zinc-900">
                            Final score: {game.homeTeam.name} {game.result.homeScore ?? 0}
                            {" - "}
                            {game.result.awayScore ?? 0} {game.awayTeam.name}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}

async function getLeagueBySlug(slug: string) {
  return db.league.findUnique({
    where: {
      slug,
    },
    select: {
      fieldNames: true,
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
              id: true,
              name: true,
            },
          },
          awayTeamId: true,
          fieldName: true,
          homeTeam: {
            select: {
              id: true,
              name: true,
            },
          },
          homeTeamId: true,
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
      sport: true,
      seasonLabel: true,
      teams: {
        orderBy: {
          name: "asc",
        },
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

function groupGamesByRound(games: LeagueGame[]): Array<[number, LeagueGame[]]> {
  const rounds = new Map<number, LeagueGame[]>();

  for (const game of games) {
    const currentGames = rounds.get(game.round);

    if (currentGames) {
      currentGames.push(game);
      continue;
    }

    rounds.set(game.round, [game]);
  }

  return Array.from(rounds.entries());
}

function formatGameMeta(game: LeagueGame): string {
  const details = [];

  if (game.scheduledAt) {
    details.push(
      new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
      }).format(game.scheduledAt),
    );
  }

  if (game.fieldName) {
    details.push(game.fieldName);
  }

  return details.length > 0 ? details.join(" • ") : "Time and field TBD";
}

function getDisplayStatus(game: LeagueGame): GameDisplayStatus {
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

function getCardClassName(status: GameDisplayStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50/40";
    case "rained_out":
      return "border-amber-200 bg-amber-50/40";
    case "rescheduled":
      return "border-blue-200 bg-blue-50/40";
    case "scheduled":
      return "border-zinc-200 bg-white";
  }
}
