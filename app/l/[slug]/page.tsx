import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BrandLink } from "@/app/components/brand-link";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { db } from "@/lib/db";
import { classifyGameState, type PublicGameState } from "@/lib/game-state";
import { getScoreLabels } from "@/lib/sport-labels";
import { buildStandings } from "@/lib/standings";
import { LeagueRaceGraph } from "@/app/components/league-race-graph";

import { CopyLinkButton } from "./copy-link-button";

export const dynamic = "force-dynamic";

type LeaguePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ team?: string }>;
};

type LeagueRecord = NonNullable<Awaited<ReturnType<typeof getLeagueBySlug>>>;
type LeagueGame = LeagueRecord["games"][number];
type GameWithState = { game: LeagueGame; state: PublicGameState };
const sectionJumpClass =
  "inline-flex min-h-11 shrink-0 items-center rounded-lg border border-[#bdcbc2] bg-white px-3 py-2 text-sm font-bold text-[#0f5138] hover:border-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]";

export async function generateMetadata({ params }: LeaguePageProps): Promise<Metadata> {
  const { slug } = await params;
  const league = await db.league.findUnique({
    where: { slug },
    select: { name: true, seasonLabel: true, showStandings: true, sport: true },
  });
  if (!league) return { title: "League not found" };
  const detail = [league.seasonLabel, league.sport].filter(Boolean).join(" · ");
  const sections = league.showStandings
    ? "schedule, updates, results, and standings"
    : "schedule, updates, and results";
  return {
    title: league.name,
    description: detail
      ? `${detail}. View the ${sections}.`
      : `View ${league.name}'s ${sections}.`,
  };
}

export default async function LeaguePage({ params, searchParams }: LeaguePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const league = await getLeagueBySlug(slug);
  if (!league) notFound();

  const selectedTeam = query.team
    ? league.teams.find((team) => team.id === query.team)
    : null;
  if (query.team && !selectedTeam) redirect(`/l/${encodeURIComponent(slug)}`);

  const now = new Date();
  const visibleGames = sortGames(
    selectedTeam
      ? league.games.filter(
          (game) =>
            game.homeTeamId === selectedTeam.id || game.awayTeamId === selectedTeam.id,
        )
      : league.games,
  );
  const gamesWithState = visibleGames.map((game) => ({
    game,
    state: classifyGameState(game, league.gameDurationMinutes, now),
  }));
  const upcoming = gamesWithState.filter(({ state }) =>
    ["in-progress", "rescheduled", "scheduled"].includes(state),
  );
  const updates = gamesWithState
    .filter(({ state }) =>
      ["rained-out", "result-pending", "tbd"].includes(state),
    )
    .sort(compareUpdates);
  const finals = gamesWithState
    .filter(({ state }) => state === "final")
    .sort((left, right) => {
      const changed =
        (right.game.result?.updatedAt.getTime() ?? 0) -
        (left.game.result?.updatedAt.getTime() ?? 0);
      return changed || compareGamesDescending(left.game, right.game);
    });
  const rainout = updates.find(({ state }) => state === "rained-out");
  const hero = buildHero(
    gamesWithState,
    Boolean(league.archivedAt),
    selectedTeam?.name,
  );
  const standings = buildStandings(league.teams, league.games, {
    lossPoints: league.lossPoints,
    tiePoints: league.tiePoints,
    winPoints: league.winPoints,
  });
  const hasLeagueFinal = league.games.some(
    (game) => game.status === "COMPLETED" && Boolean(game.result),
  );
  const scoreLabels = getScoreLabels(league.sport);
  const directionsUrl = getDirectionsUrl(league);
  const teamQuery = selectedTeam
    ? `?team=${encodeURIComponent(selectedTeam.id)}`
    : "";
  const calendarUrl = `/l/${encodeURIComponent(slug)}/calendar.ics${teamQuery}`;

  return (
    <div className="min-h-screen bg-[#f3f6f2] text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandLink />
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-[#526159] transition hover:text-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
            href={selectedTeam
              ? `/manage?team=${encodeURIComponent(selectedTeam.id)}`
              : `/manage?slug=${encodeURIComponent(slug)}`}
          >
            League staff sign-in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <section className="flex flex-col gap-6 border-b border-[#cad7cf] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">
              League board
            </p>
            <h1 className="mt-2 break-words text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
              {league.name}
            </h1>
            <p className="mt-3 text-base text-[#627068]">
              {[league.sport, league.seasonLabel].filter(Boolean).join(" · ") ||
                "Community league"}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[#627068]">
              <time
                dateTime={league.publicUpdatedAt.toISOString()}
                title={formatExactUpdate(league.publicUpdatedAt, league.timezone)}
              >
                Updated {formatRelativeTime(league.publicUpdatedAt, now)}
              </time>
              <span aria-hidden="true">·</span>
              <span>{timeZoneLabel(league.timezone)}</span>
              <AutoRefresh updatedAt={league.publicUpdatedAt.toISOString()} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#bdcbc2] bg-white px-4 py-2.5 text-sm font-bold text-[#0f5138] hover:border-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
              href={calendarUrl}
            >
              {selectedTeam ? `Download ${selectedTeam.name} calendar` : "Download league calendar"}
            </a>
            <CopyLinkButton />
          </div>
        </section>

        {league.archivedAt ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <strong>Archived season.</strong> Published games and results remain available, but staff changes are closed.
          </div>
        ) : null}

        <form
          action={`/l/${encodeURIComponent(slug)}`}
          className="mt-5 flex items-end gap-2 sm:hidden"
          method="get"
        >
          <label className="min-w-0 flex-1 text-sm font-semibold">
            <span className="mb-1.5 block">Show one team</span>
            <select
              className="min-h-11 w-full rounded-lg border border-[#bdcbc2] bg-white px-3 text-base focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
              defaultValue={selectedTeam?.id ?? ""}
              name="team"
            >
              <option value="">All teams</option>
              {league.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="min-h-11 rounded-lg bg-[#10231c] px-4 text-sm font-bold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
            type="submit"
          >
            Show
          </button>
        </form>

        <nav
          aria-label="Filter schedule by team"
          className="mt-5 hidden overflow-x-auto border-b border-[#cad7cf] pb-4 sm:block"
        >
          <div className="flex min-w-max gap-2">
            <Link
              aria-current={!selectedTeam ? "page" : undefined}
              className={teamFilterClass(!selectedTeam)}
              href={`/l/${encodeURIComponent(slug)}`}
            >
              All teams
            </Link>
            {league.teams.map((team) => (
              <Link
                aria-current={team.id === selectedTeam?.id ? "page" : undefined}
                className={teamFilterClass(team.id === selectedTeam?.id)}
                href={`/l/${encodeURIComponent(slug)}?team=${encodeURIComponent(team.id)}`}
                key={team.id}
              >
                {team.name}
              </Link>
            ))}
          </div>
        </nav>

        {rainout ? (
          <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Game rained out — new date pending</p>
              <p className="mt-1 text-sm leading-6">
                {rainout.game.homeTeam.name} vs {rainout.game.awayTeam.name}
                {rainout.game.scheduledAt
                  ? ` · originally ${formatGameDateTime(rainout.game.scheduledAt, league.timezone)}`
                  : ""}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-amber-200 px-3 py-1 text-sm font-bold">
              Schedule update
            </span>
          </section>
        ) : null}

        <HeroPanel hero={hero} league={league} directionsUrl={directionsUrl} />

        <nav
          aria-label="League page sections"
          className="mt-5 flex gap-2 overflow-x-auto pb-1"
        >
          <a className={sectionJumpClass} href="#schedule">Schedule {upcoming.length}</a>
          {updates.length ? <a className={sectionJumpClass} href="#updates">Updates {updates.length}</a> : null}
          {finals.length ? <a className={sectionJumpClass} href="#results">Results {finals.length}</a> : null}
          {league.showStandings ? <a className={sectionJumpClass} href="#standings">Standings</a> : null}
        </nav>

        <div
          className={`mt-8 grid gap-8 ${
            league.showStandings
              ? "lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,.85fr)] lg:items-start"
              : ""
          }`}
        >
          <div className="space-y-8">
            <GameSection
              emptyCopy="No future games are scheduled right now."
              eyebrow="Schedule"
              games={upcoming}
              id="schedule"
              league={league}
              title={selectedTeam ? `${selectedTeam.name} · upcoming` : "Upcoming games"}
            />

            {updates.length ? (
              <GameSection
                eyebrow="Schedule updates"
                games={updates}
                id="updates"
                league={league}
                title="Dates and results to watch"
              />
            ) : null}

            {finals.length ? (
              <GameSection
                eyebrow="Official finals"
                games={finals}
                id="results"
                league={league}
                title="Latest results"
              />
            ) : null}
          </div>

          {league.showStandings ? (
            <StandingsPanel
              hasFinal={hasLeagueFinal}
              league={league}
              scoreDiffLabel={scoreLabels.scoreDiff}
              selectedTeamId={selectedTeam?.id}
              standings={standings}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function HeroPanel({ directionsUrl, hero, league }: {
  directionsUrl: string | null;
  hero: ReturnType<typeof buildHero>;
  league: LeagueRecord;
}) {
  return (
    <section className="mt-7 overflow-hidden rounded-2xl bg-[#10231c] text-white shadow-[0_16px_40px_rgba(16,35,28,0.16)]">
      <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#8fd1ad]">
          {hero.eyebrow}
        </p>
        <span className="text-sm text-white/70">{timeZoneLabel(league.timezone)}</span>
      </div>
      <div className="p-5 sm:p-7">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{hero.title}</h2>
        <p className="mt-2 max-w-2xl leading-7 text-white/75">{hero.copy}</p>
        {hero.game || league.venueName || league.venueAddress || directionsUrl ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              {hero.game ? (
                <>
                  <p className="text-xl font-bold">
                    {hero.game.homeTeam.name}{" "}
                    <span className="font-normal text-white/60">vs</span>{" "}
                    {hero.game.awayTeam.name}
                  </p>
                  <p className="mt-2 text-sm text-white/75">
                    {hero.game.scheduledAt
                      ? formatGameDateTime(hero.game.scheduledAt, league.timezone)
                      : "Date and time pending"}
                    {hero.game.fieldName ? ` · ${hero.game.fieldName}` : ""}
                  </p>
                </>
              ) : null}
              {league.venueName || league.venueAddress ? (
                <p className={`${hero.game ? "mt-1" : ""} text-sm text-white/75`}>
                  {[league.venueName, league.venueAddress].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            {directionsUrl ? (
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-bold text-[#10231c] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
                href={directionsUrl}
                rel="noreferrer"
                target="_blank"
              >
                Get directions ↗
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GameSection({ emptyCopy, eyebrow, games, id, league, title }: {
  emptyCopy?: string;
  eyebrow: string;
  games: GameWithState[];
  id: string;
  league: LeagueRecord;
  title: string;
}) {
  return (
    <section className="scroll-mt-5" id={id}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">{eyebrow}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{title}</h2>
        </div>
        <p className="text-sm text-[#627068]">
          {games.length} {games.length === 1 ? "game" : "games"}
        </p>
      </div>
      {games.length ? (
        <div className="mt-5 divide-y divide-[#e1e8e3] overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
          {games.map(({ game, state }) => (
            <PublicGameRow game={game} key={game.id} league={league} state={state} />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-[#bdcbc2] bg-white px-6 py-10 text-center">
          <p className="font-bold">Nothing scheduled</p>
          <p className="mt-1 text-sm text-[#627068]">{emptyCopy}</p>
        </div>
      )}
    </section>
  );
}

function PublicGameRow({ game, league, state }: {
  game: LeagueGame;
  league: LeagueRecord;
  state: PublicGameState;
}) {
  return (
    <article className="grid gap-3 px-4 py-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div>
        <time className="font-bold" dateTime={game.scheduledAt?.toISOString()}>
          {game.scheduledAt ? formatGameDate(game.scheduledAt, league.timezone) : "Date TBD"}
        </time>
        <p className="mt-0.5 text-sm text-[#627068]">
          {game.scheduledAt ? formatGameTime(game.scheduledAt, league.timezone) : `Round ${game.round}`}
        </p>
      </div>
      <div className="min-w-0">
        <p className="font-semibold">
          <span className="break-words">{game.homeTeam.name}</span>
          <span className="px-2 font-normal text-[#627068]">vs</span>
          <span className="break-words">{game.awayTeam.name}</span>
        </p>
        <p className="mt-1 text-sm text-[#627068]">
          {[game.fieldName, league.venueName].filter(Boolean).join(" · ") || "Field TBD"}
        </p>
      </div>
      {state === "final" && game.result ? (
        <p className="text-xl font-black tabular-nums">
          <span className="sr-only">Final score: </span>
          {game.result.homeScore}–{game.result.awayScore}
        </p>
      ) : (
        <StatusBadge state={state} />
      )}
    </article>
  );
}

function StandingsPanel({ hasFinal, league, scoreDiffLabel, selectedTeamId, standings }: {
  hasFinal: boolean;
  league: LeagueRecord;
  scoreDiffLabel: string;
  selectedTeamId?: string;
  standings: ReturnType<typeof buildStandings>;
}) {
  return (
    <section className="scroll-mt-5 overflow-hidden rounded-2xl border border-[#cad7cf] bg-white lg:sticky lg:top-5" id="standings">
      <div className="border-b border-[#e1e8e3] p-5">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">League race</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">Standings</h2>
        <p className="mt-1 text-sm text-[#627068]">{scoringRuleLabel(league)}</p>
      </div>
      {hasFinal ? (
        <div>
          <div className="p-4 sm:p-5">
            <LeagueRaceGraph
              differentialLabel={scoreDiffLabel}
              selectedTeamId={selectedTeamId}
              standings={standings}
            />
          </div>
          <details className="group border-t border-[#e1e8e3]">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-bold text-[#0f5138] marker:hidden focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[#f4b942]">
              Full standings table
              <span aria-hidden="true" className="transition group-open:rotate-180">⌄</span>
            </summary>
            <div className="overflow-x-auto border-t border-[#e1e8e3]">
              <table className="min-w-full text-sm">
                <caption className="sr-only">{league.name} standings ordered by points and score differential</caption>
                <thead className="bg-[#f8faf8] text-left text-[#526159]">
                  <tr>
                    <th className="px-4 py-3 font-semibold" scope="col">Rank</th>
                    <th className="px-2 py-3 font-semibold" scope="col">Team</th>
                    <th className="px-2 py-3 text-center font-semibold" scope="col"><abbr title="Played">P</abbr></th>
                    <th className="px-2 py-3 text-center font-semibold" scope="col"><abbr title="Wins, losses, ties">W-L-T</abbr></th>
                    <th className="px-2 py-3 text-center font-semibold" scope="col"><abbr title="Points">Pts</abbr></th>
                    <th className="px-4 py-3 text-right font-semibold" scope="col"><abbr title={scoreDiffLabel}>{scoreDiffLabel}</abbr></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf1ee]">
                  {standings.map((row, index) => {
                    const selected = row.teamId === selectedTeamId;
                    return (
                      <tr className={selected ? "bg-amber-50" : undefined} key={row.teamId}>
                        <td className="px-4 py-3 text-[#526159]">{index + 1}</td>
                        <th className="max-w-44 px-2 py-3 text-left font-semibold" scope="row">
                          <span className="block truncate" title={row.teamName}>{row.teamName}</span>
                          {selected ? <span className="mt-0.5 block text-xs font-bold text-amber-800">Your team</span> : null}
                        </th>
                        <td className="px-2 py-3 text-center text-[#526159]">{row.played}</td>
                        <td className="px-2 py-3 text-center text-[#526159]">{row.wins}-{row.losses}-{row.ties}</td>
                        <td className="px-2 py-3 text-center font-black">{row.points}</td>
                        <td className="px-4 py-3 text-right text-[#526159]">{signedNumber(row.goalDifferential)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ) : (
        <div className="p-6 text-sm leading-6 text-[#627068]">Standings begin after the first official final.</div>
      )}
    </section>
  );
}

function StatusBadge({ state }: { state: PublicGameState }) {
  const styles: Record<PublicGameState, string> = {
    final: "bg-emerald-100 text-emerald-900",
    "in-progress": "bg-[#f4b942] text-[#10231c]",
    "rained-out": "bg-amber-100 text-amber-950",
    rescheduled: "bg-blue-100 text-blue-950",
    "result-pending": "bg-red-100 text-red-900",
    scheduled: "bg-[#e9f0eb] text-[#405149]",
    tbd: "bg-red-100 text-red-900",
  };
  const labels: Record<PublicGameState, string> = {
    final: "Final",
    "in-progress": "Playing now",
    "rained-out": "Rained out",
    rescheduled: "Updated",
    "result-pending": "Result pending",
    scheduled: "Scheduled",
    tbd: "Date TBD",
  };
  return <span className={`w-fit rounded-lg px-2.5 py-1 text-sm font-bold ${styles[state]}`}>{labels[state]}</span>;
}

function buildHero(games: GameWithState[], archived: boolean, selectedTeamName?: string) {
  const live = games.find(({ state }) => state === "in-progress");
  if (live) {
    return { copy: selectedTeamName ? `${selectedTeamName} is on the field now.` : "This game is inside its scheduled playing window.", eyebrow: "Playing now", game: live.game, title: "Game in progress" };
  }
  const next = games.find(({ state }) => state === "scheduled" || state === "rescheduled");
  if (next) {
    return { copy: "Date, time, field, and venue are ready for game day.", eyebrow: selectedTeamName ? `${selectedTeamName} · next game` : "Next on the field", game: next.game, title: next.state === "rescheduled" ? "Schedule updated" : "Next game" };
  }
  const rainout = games.find(({ state }) => state === "rained-out");
  if (rainout) {
    return { copy: "The organizer has not posted a replacement date yet.", eyebrow: "Schedule update", game: rainout.game, title: "Game rained out — new date pending" };
  }
  if (games.some(({ state }) => state === "tbd")) {
    return { copy: "Check back for the confirmed date, time, and field.", eyebrow: "Schedule update", title: "Next game is being scheduled" };
  }
  if (games.some(({ state }) => state === "result-pending")) {
    return { copy: "The game has ended and the organizer has not posted its official score yet.", eyebrow: "Latest game", title: "Result pending" };
  }
  if (archived) {
    return { copy: "The organizer has closed changes for this season. Published games and results remain available below.", eyebrow: "Season status", title: "Season archived" };
  }
  if (games.length && games.every(({ state }) => state === "final")) {
    return { copy: "Every scheduled game has an official final score.", eyebrow: "Season status", title: "Season complete" };
  }
  return { copy: "The organizer has not published the schedule yet.", eyebrow: "League schedule", title: "Schedule not posted yet" };
}

async function getLeagueBySlug(slug: string) {
  return db.league.findUnique({
    where: { slug },
    select: {
      archivedAt: true,
      gameDurationMinutes: true,
      games: {
        select: {
          awayTeam: { select: { id: true, name: true } },
          awayTeamId: true,
          fieldName: true,
          homeTeam: { select: { id: true, name: true } },
          homeTeamId: true,
          id: true,
          result: { select: { awayScore: true, homeScore: true, submittedAt: true, updatedAt: true } },
          round: true,
          scheduledAt: true,
          status: true,
          updatedAt: true,
        },
      },
      lossPoints: true,
      name: true,
      seasonLabel: true,
      showStandings: true,
      slug: true,
      sport: true,
      teams: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      tiePoints: true,
      timezone: true,
      publicUpdatedAt: true,
      venueAddress: true,
      venueName: true,
      venueUrl: true,
      winPoints: true,
    },
  });
}

function sortGames(games: LeagueGame[]): LeagueGame[] {
  return [...games].sort((left, right) => {
    if (left.scheduledAt && right.scheduledAt) return left.scheduledAt.getTime() - right.scheduledAt.getTime();
    if (left.scheduledAt) return -1;
    if (right.scheduledAt) return 1;
    return left.round - right.round || left.id.localeCompare(right.id);
  });
}

function compareGamesDescending(left: LeagueGame, right: LeagueGame): number {
  if (left.scheduledAt && right.scheduledAt) return right.scheduledAt.getTime() - left.scheduledAt.getTime();
  if (left.scheduledAt) return -1;
  if (right.scheduledAt) return 1;
  return right.round - left.round || right.id.localeCompare(left.id);
}

function compareUpdates(left: GameWithState, right: GameWithState): number {
  const priority: Record<PublicGameState, number> = {
    "rained-out": 0,
    "result-pending": 1,
    tbd: 2,
    "in-progress": 3,
    rescheduled: 3,
    scheduled: 3,
    final: 3,
  };
  const stateOrder = priority[left.state] - priority[right.state];
  if (stateOrder) return stateOrder;
  if (left.game.scheduledAt && right.game.scheduledAt) {
    return right.game.scheduledAt.getTime() - left.game.scheduledAt.getTime();
  }
  if (left.game.scheduledAt) return -1;
  if (right.game.scheduledAt) return 1;
  return left.game.round - right.game.round || left.game.id.localeCompare(right.game.id);
}

function getDirectionsUrl(league: { venueAddress: string | null; venueUrl: string | null }): string | null {
  if (league.venueUrl) {
    try {
      const url = new URL(league.venueUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {}
  }
  return league.venueAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(league.venueAddress)}` : null;
}

function teamFilterClass(active: boolean): string {
  return `inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-bold transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942] ${active ? "bg-[#0f5138] text-white" : "border border-[#cad7cf] bg-white text-[#405149] hover:border-[#0f5138] hover:text-[#0f5138]"}`;
}

function formatGameDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone, weekday: "short", year: "numeric" }).format(date);
}

function formatGameTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

function formatGameDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone }).format(date);
}

function formatExactUpdate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long", timeZone }).format(date);
}

function formatRelativeTime(date: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function scoringRuleLabel(league: { lossPoints: number; tiePoints: number; winPoints: number }): string {
  return `${league.winPoints} win · ${league.tiePoints} tie · ${league.lossPoints} loss`;
}

function signedNumber(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function timeZoneLabel(timeZone: string): string {
  const labels: Record<string, string> = { "America/Chicago": "Central time", "America/Denver": "Mountain time", "America/Los_Angeles": "Pacific time", "America/New_York": "Eastern time", UTC: "UTC" };
  return labels[timeZone] ?? timeZone.replaceAll("_", " ");
}
