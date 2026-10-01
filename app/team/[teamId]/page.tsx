import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/actions/auth";
import { submitGameReportAction } from "@/app/actions/manager";
import { BrandLink } from "@/app/components/brand-link";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { Notice } from "@/app/components/notice";
import { ShareButton } from "@/app/components/share-button";
import { SubmitButton } from "@/app/components/submit-button";
import { TeamPortablePanel } from "@/app/components/team-portable-panel";
import { getTeamManagerAuthorization } from "@/lib/auth";
import { db } from "@/lib/db";
import { classifyGameState, type PublicGameState } from "@/lib/game-state";

export const dynamic = "force-dynamic";

type TeamDeskProps = {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
};

type TeamDeskRecord = NonNullable<Awaited<ReturnType<typeof getTeamDesk>>>;
type TeamGame = TeamDeskRecord["league"]["games"][number];

export default async function TeamDeskPage({
  params,
  searchParams,
}: TeamDeskProps) {
  const [{ teamId }, query] = await Promise.all([params, searchParams]);
  const authorization = await getTeamManagerAuthorization(teamId, {
    allowArchived: true,
  });

  if (!authorization) {
    redirect(`/manage?team=${encodeURIComponent(teamId)}`);
  }

  const team = await getTeamDesk(teamId, authorization.leagueId);
  if (!team) redirect("/dashboard");

  const now = new Date();
  const games = sortGames(team.league.games);
  const withState = games.map((game) => ({
    game,
    state: classifyGameState(
      game,
      team.league.gameDurationMinutes,
      now,
    ),
  }));
  const upcoming = withState.filter(({ state }) =>
    ["in-progress", "rescheduled", "scheduled"].includes(state),
  );
  const updates = withState.filter(({ state }) =>
    ["rained-out", "result-pending", "tbd"].includes(state),
  );
  const finals = [...withState]
    .filter(({ state }) => state === "final")
    .sort(
      (left, right) =>
        (right.game.result?.updatedAt.getTime() ?? 0) -
        (left.game.result?.updatedAt.getTime() ?? 0),
    );
  const hero = getTeamHero(
    withState,
    Boolean(team.league.archivedAt),
    team.league.timezone,
  );
  const directionsUrl = getDirectionsUrl(team.league);
  const publicTeamUrl = `/l/${encodeURIComponent(team.league.slug)}?team=${encodeURIComponent(team.id)}`;
  const canReport = !authorization.isCommissioner && !team.league.archivedAt;
  const pendingReportCount = team._count.reports;

  return (
    <div className="min-h-screen bg-[#f3f6f2] pb-24 text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <BrandLink />
          <div className="flex items-center gap-2">
            <Link
              className="hidden min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-[#526159] hover:text-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942] sm:inline-flex"
              href="/dashboard"
            >
              My leagues
            </Link>
            <form action={logoutAction}>
              <button
                className="min-h-11 rounded-lg border border-[#bdcbc2] bg-white px-3 text-sm font-semibold text-[#526159] hover:border-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {query.notice ? (
          <div className="mb-6">
            <Notice
              message={query.notice}
              tone={query.tone === "error" ? "error" : "success"}
            />
          </div>
        ) : null}

        <section className="flex flex-col gap-5 border-b border-[#cad7cf] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">
              {authorization.isCommissioner ? "Organizer view" : "Team manager desk"}
            </p>
            <h1 className="mt-2 break-words text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
              {team.name}
            </h1>
            <p className="mt-3 break-words text-[#627068]">
              {team.league.name}
              {team.league.seasonLabel ? ` · ${team.league.seasonLabel}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AutoRefresh updatedAt={team.league.updatedAt.toISOString()} />
            <ShareButton
              label="Share team page"
              title={`${team.name} · ${team.league.name}`}
              url={publicTeamUrl}
            />
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#bdcbc2] bg-white px-4 py-2.5 text-sm font-bold text-[#0f5138] hover:border-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
              href={publicTeamUrl}
            >
              View public page
            </Link>
          </div>
        </section>

        {team.league.archivedAt ? (
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <strong>Season archived.</strong> This desk is read-only, but the schedule,
            results, and report history remain available.
          </div>
        ) : null}

        {!authorization.isCommissioner && team.reports.length ? (
          <a
            className="mt-6 flex min-h-14 items-center justify-between gap-4 rounded-xl border border-[#cad7cf] bg-white px-4 py-3 text-sm text-[#405149] shadow-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
            href="#reports"
          >
            <span>
              <strong className="block text-[#10231c]">
                {pendingReportCount
                  ? `${pendingReportCount} ${pendingReportCount === 1 ? "report is" : "reports are"} awaiting organizer review`
                  : "Your latest reports have been reviewed"}
              </strong>
              <span className="mt-0.5 block text-[#627068]">
                Check approvals, declines, and submitted details.
              </span>
            </span>
            <span aria-hidden="true" className="font-black text-[#0f5138]">↓</span>
          </a>
        ) : null}

        <section className="mt-7 overflow-hidden rounded-2xl bg-[#10231c] text-white shadow-[0_16px_40px_rgba(16,35,28,0.16)]">
          <div className="border-b border-white/10 px-5 py-4 sm:px-6">
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#8fd1ad]">
              {hero.eyebrow}
            </p>
          </div>
          <div className="p-5 sm:p-7">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {hero.title}
            </h2>
            <p className="mt-2 max-w-2xl text-white/75">{hero.copy}</p>
            {hero.game ? (
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
                <span>{formatDateTime(hero.game.scheduledAt, team.league.timezone)}</span>
                {hero.game.fieldName ? <span>{hero.game.fieldName}</span> : null}
                {team.league.venueName ? <span>{team.league.venueName}</span> : null}
              </div>
            ) : null}
            <p className="mt-4 text-sm font-semibold text-[#8fd1ad]">
              Times shown in {timeZoneLabel(team.league.timezone)}.
            </p>
          </div>
        </section>

        <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,.75fr)] lg:items-start">
          <div className="space-y-7">
            {updates.length ? (
              <GameSection
                canReport={canReport}
                eyebrow="Schedule updates"
                games={updates}
                league={team.league}
                teamId={team.id}
                title="Needs a response"
              />
            ) : null}
            <GameSection
              canReport={canReport}
              eyebrow="Coming up"
              empty="No future games are scheduled right now."
              games={upcoming}
              league={team.league}
              teamId={team.id}
              title="Team schedule"
            />
            {finals.length ? (
              <GameSection
                canReport={canReport}
                eyebrow="Official"
                games={finals}
                league={team.league}
                teamId={team.id}
                title="Latest results"
              />
            ) : null}
          </div>

          <aside className="space-y-5 lg:sticky lg:top-5">
            <section className="rounded-2xl border border-[#cad7cf] bg-white p-5">
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
                Game-day details
              </p>
              <h2 className="mt-1 text-xl font-bold">
                {team.league.venueName ?? "League venue"}
              </h2>
              {team.league.venueAddress ? (
                <p className="mt-2 text-sm leading-6 text-[#627068]">
                  {team.league.venueAddress}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-[#627068]">
                  Field details appear with each game.
                </p>
              )}
              {directionsUrl ? (
                <a
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#bdcbc2] px-4 py-2 text-sm font-bold text-[#0f5138] hover:border-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
                  href={directionsUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Get directions ↗
                </a>
              ) : null}
              <a
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#0f5138] px-4 py-2 text-sm font-bold text-white hover:bg-[#0a3828] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
                href={`/l/${encodeURIComponent(team.league.slug)}/calendar.ics?team=${encodeURIComponent(team.id)}`}
              >
                Download {team.name} calendar
              </a>
            </section>

            <TeamPortablePanel
              archived={Boolean(team.league.archivedAt)}
              canSync={!authorization.isCommissioner}
              teamId={team.id}
              teamName={team.name}
            />

            <section
              className="scroll-mt-5 rounded-2xl border border-[#cad7cf] bg-white p-5"
              id="reports"
            >
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
                Your reports
              </p>
              <h2 className="mt-1 text-xl font-bold">Organizer review</h2>
              {!authorization.isCommissioner ? (
                <p className="mt-2 text-sm leading-6 text-[#627068]">
                  Reports stay private until the organizer approves them.
                </p>
              ) : null}
              {team.reports.length ? (
                <ol className="mt-4 divide-y divide-[#e1e8e3]">
                  {team.reports.map((report) => (
                    <li className="py-3 text-sm" key={report.id}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-semibold">
                          {reportLabel(report.type)} · {report.game.homeTeam.name} vs {report.game.awayTeam.name}
                        </span>
                        <ReportStatus
                          decisionNote={report.decisionNote}
                          status={report.status}
                        />
                      </div>
                      <time
                        className="mt-1 block text-[#627068]"
                        dateTime={report.createdAt.toISOString()}
                      >
                        {formatFullDate(report.createdAt, team.league.timezone)}
                      </time>
                      <p className="mt-1 font-medium text-[#405149]">
                        Submitted: {reportHistorySummary(report, team.league.timezone)}
                      </p>
                      {report.note ? (
                        <p className="mt-1 text-[#526159]">Note: {report.note}</p>
                      ) : null}
                      {report.decisionNote ? (
                        <p className="mt-1 text-[#526159]">{report.decisionNote}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-[#627068]">No reports yet.</p>
              )}
            </section>
          </aside>
        </div>
      </main>

      <nav aria-label="Team-manager shortcuts" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-[#cad7cf] bg-white/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(16,35,28,.08)] backdrop-blur sm:hidden">
        <Link className="flex min-h-12 items-center justify-center rounded-lg px-2 text-center text-xs font-bold text-[#0f5138]" href="/dashboard">My leagues</Link>
        <Link className="flex min-h-12 items-center justify-center rounded-lg px-2 text-center text-xs font-bold text-[#0f5138]" href="#reports">Reports {pendingReportCount}</Link>
        <Link className="flex min-h-12 items-center justify-center rounded-lg px-2 text-center text-xs font-bold text-[#0f5138]" href={publicTeamUrl}>Public team page</Link>
      </nav>
    </div>
  );
}

function GameSection({
  canReport,
  empty,
  eyebrow,
  games,
  league,
  teamId,
  title,
}: {
  canReport: boolean;
  empty?: string;
  eyebrow: string;
  games: Array<{ game: TeamGame; state: PublicGameState }>;
  league: TeamDeskRecord["league"];
  teamId: string;
  title: string;
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{title}</h2>
        </div>
        <span className="text-sm text-[#627068]">{games.length}</span>
      </div>
      {games.length ? (
        <div className="mt-4 divide-y divide-[#e1e8e3] overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
          {games.map(({ game, state }) => (
            <TeamGameRow
              canReport={canReport}
              game={game}
              key={`${game.id}:${game.version}`}
              league={league}
              state={state}
              teamId={teamId}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-[#bdcbc2] bg-white px-5 py-8 text-center text-sm text-[#627068]">
          {empty ?? "Nothing here right now."}
        </div>
      )}
    </section>
  );
}

function TeamGameRow({
  canReport,
  game,
  league,
  state,
  teamId,
}: {
  canReport: boolean;
  game: TeamGame;
  league: TeamDeskRecord["league"];
  state: PublicGameState;
  teamId: string;
}) {
  return (
    <article className="p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center">
        <div>
          <time
            className="font-bold"
            dateTime={game.scheduledAt?.toISOString()}
          >
            {game.scheduledAt
              ? formatCompactDate(game.scheduledAt, league.timezone)
              : "Date TBD"}
          </time>
          <p className="mt-0.5 text-sm text-[#627068]">
            {game.scheduledAt ? formatTime(game.scheduledAt, league.timezone) : `Round ${game.round}`}
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
            {game.result.homeScore}–{game.result.awayScore}
          </p>
        ) : (
          <StateBadge state={state} />
        )}
      </div>

      {canReport && !game.locked ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[#edf1ee] pt-4">
          {reportTypesForState(state).map((type) => (
            <ReportForm
              game={game}
              key={type}
              league={league}
              teamId={teamId}
              type={type}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

type ReportType = "RAINOUT" | "RESCHEDULE" | "SCORE";

function ReportForm({
  game,
  league,
  teamId,
  type,
}: {
  game: TeamGame;
  league: TeamDeskRecord["league"];
  teamId: string;
  type: ReportType;
}) {
  return (
    <details className="group w-full rounded-xl border border-[#cad7cf] bg-[#f8faf8] sm:w-auto sm:min-w-48">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-bold text-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]">
        {type === "SCORE"
          ? game.result
            ? "Correct score"
            : "Report score"
          : type === "RAINOUT"
            ? "Report rainout"
            : "Propose new time"}
        <span aria-hidden="true">＋</span>
      </summary>
      <form action={submitGameReportAction} className="space-y-3 border-t border-[#d9e2dc] bg-white p-3">
        <input name="expectedGameVersion" type="hidden" value={game.version} />
        <input name="gameId" type="hidden" value={game.id} />
        <input name="teamId" type="hidden" value={teamId} />
        <input name="type" type="hidden" value={type} />

        {type === "SCORE" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold">
              <span className="mb-1 block truncate">{game.homeTeam.name}</span>
              <input
                className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base"
                inputMode="numeric"
                max="999"
                min="0"
                name="homeScore"
                required
                type="number"
                defaultValue={game.result?.homeScore ?? ""}
              />
            </label>
            <label className="text-xs font-semibold">
              <span className="mb-1 block truncate">{game.awayTeam.name}</span>
              <input
                className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base"
                inputMode="numeric"
                max="999"
                min="0"
                name="awayScore"
                required
                type="number"
                defaultValue={game.result?.awayScore ?? ""}
              />
            </label>
          </div>
        ) : null}

        {type === "RESCHEDULE" ? (
          <>
            <div className="grid gap-2 min-[360px]:grid-cols-2">
              <label className="text-xs font-semibold">
                <span className="mb-1 block">Date</span>
                <input
                  className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-2 text-base"
                  defaultValue={
                    game.scheduledAt
                      ? dateInputValue(game.scheduledAt, league.timezone)
                      : ""
                  }
                  name="scheduledDate"
                  required
                  type="date"
                />
              </label>
              <label className="text-xs font-semibold">
                <span className="mb-1 block">Time</span>
                <input
                  className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-2 text-base"
                  defaultValue={
                    game.scheduledAt
                      ? timeInputValue(game.scheduledAt, league.timezone)
                      : ""
                  }
                  name="scheduledTime"
                  required
                  type="time"
                />
              </label>
            </div>
            <label className="block text-xs font-semibold">
              <span className="mb-1 block">Field or court</span>
              <input
                className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base"
                defaultValue={game.fieldName ?? ""}
                maxLength={80}
                name="fieldName"
              />
            </label>
          </>
        ) : null}

        <label className="block text-xs font-semibold">
          <span className="mb-1 block">Note to organizer (optional)</span>
          <textarea
            className="min-h-20 w-full rounded-lg border border-[#bdcbc2] px-3 py-2 text-base"
            maxLength={500}
            name="note"
          />
        </label>
        <SubmitButton
          className="min-h-11 w-full rounded-lg bg-[#0f5138] px-3 py-2 text-sm font-bold text-white disabled:bg-[#82968a]"
          idleLabel="Send for approval"
          pendingLabel="Sending…"
        />
      </form>
    </details>
  );
}

function StateBadge({ state }: { state: PublicGameState }) {
  const label: Record<PublicGameState, string> = {
    final: "Final",
    "in-progress": "Playing now",
    "rained-out": "Rained out",
    rescheduled: "Updated",
    "result-pending": "Result pending",
    scheduled: "Scheduled",
    tbd: "TBD",
  };
  const style: Record<PublicGameState, string> = {
    final: "bg-emerald-100 text-emerald-900",
    "in-progress": "bg-[#f4b942] text-[#10231c]",
    "rained-out": "bg-amber-100 text-amber-950",
    rescheduled: "bg-blue-100 text-blue-950",
    "result-pending": "bg-red-100 text-red-900",
    scheduled: "bg-[#e9f0eb] text-[#405149]",
    tbd: "bg-red-100 text-red-900",
  };
  return (
    <span className={`w-fit rounded-lg px-2.5 py-1 text-sm font-bold ${style[state]}`}>
      {label[state]}
    </span>
  );
}

function ReportStatus({ decisionNote, status }: {
  decisionNote: string | null;
  status: "APPROVED" | "PENDING" | "REJECTED";
}) {
  const style = {
    APPROVED: "bg-emerald-100 text-emerald-900",
    PENDING: "bg-amber-100 text-amber-950",
    REJECTED: "bg-slate-200 text-slate-800",
  }[status];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${style}`}>
      {status === "REJECTED"
        ? decisionNote?.startsWith("Replaced by")
          ? "Replaced"
          : decisionNote?.startsWith("Superseded by")
            ? "Superseded"
            : "Declined"
        : titleCase(status)}
    </span>
  );
}

function getTeamHero(
  games: Array<{ game: TeamGame; state: PublicGameState }>,
  archived: boolean,
  timeZone: string,
): { copy: string; eyebrow: string; game?: TeamGame; title: string } {
  if (archived) {
    return {
      copy: "The organizer has closed changes for this season.",
      eyebrow: "Season status",
      title: "Season archived",
    };
  }
  const live = games.find(({ state }) => state === "in-progress");
  if (live) {
    return {
      copy: `${live.game.homeTeam.name} vs ${live.game.awayTeam.name}`,
      eyebrow: "Playing now",
      game: live.game,
      title: "Game in progress",
    };
  }
  const next = games.find(({ state }) =>
    state === "scheduled" || state === "rescheduled",
  );
  if (next) {
    return {
      copy: `${next.game.homeTeam.name} vs ${next.game.awayTeam.name}`,
      eyebrow: "Next game",
      game: next.game,
      title: formatFullDate(next.game.scheduledAt!, timeZone),
    };
  }
  if (games.some(({ state }) => state === "rained-out")) {
    return {
      copy: "The organizer still needs to post a replacement date.",
      eyebrow: "Schedule update",
      title: "Game rained out — new date pending",
    };
  }
  if (games.some(({ state }) => state === "tbd")) {
    return {
      copy: "The organizer is working on the next date and field.",
      eyebrow: "Schedule update",
      title: "Next game is being scheduled",
    };
  }
  if (games.some(({ state }) => state === "result-pending")) {
    return {
      copy: "Send the score to the organizer when it is confirmed.",
      eyebrow: "Latest game",
      title: "Result pending",
    };
  }
  if (games.length && games.every(({ state }) => state === "final")) {
    return {
      copy: "Every scheduled game has an official result.",
      eyebrow: "Season status",
      title: "Season complete",
    };
  }
  return {
    copy: "The organizer has not published games for this team yet.",
    eyebrow: "Team schedule",
    title: "Schedule not posted yet",
  };
}

async function getTeamDesk(teamId: string, leagueId: string) {
  const reportSelect = {
    awayScore: true,
    createdAt: true,
    decisionNote: true,
    game: {
      select: {
        awayTeam: { select: { name: true } },
        homeTeam: { select: { name: true } },
      },
    },
    homeScore: true,
    id: true,
    note: true,
    proposedFieldName: true,
    proposedScheduledAt: true,
    status: true,
    type: true,
  } as const;
  const team = await db.team.findFirst({
    where: { id: teamId, leagueId },
    select: {
      _count: {
        select: {
          reports: { where: { status: "PENDING" } },
        },
      },
      id: true,
      name: true,
      league: {
        select: {
          archivedAt: true,
          gameDurationMinutes: true,
          games: {
            where: { OR: [{ awayTeamId: teamId }, { homeTeamId: teamId }] },
            select: {
              awayTeam: { select: { id: true, name: true } },
              awayTeamId: true,
              fieldName: true,
              homeTeam: { select: { id: true, name: true } },
              homeTeamId: true,
              id: true,
              locked: true,
              result: {
                select: {
                  awayScore: true,
                  homeScore: true,
                  updatedAt: true,
                },
              },
              round: true,
              scheduledAt: true,
              status: true,
              version: true,
            },
          },
          name: true,
          seasonLabel: true,
          slug: true,
          timezone: true,
          updatedAt: true,
          venueAddress: true,
          venueName: true,
          venueUrl: true,
        },
      },
    },
  });
  if (!team) return null;

  const [pendingReports, recentReviewedReports] = await Promise.all([
    db.gameReport.findMany({
      where: { leagueId, teamId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: reportSelect,
    }),
    db.gameReport.findMany({
      where: { leagueId, teamId, status: { not: "PENDING" } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: reportSelect,
    }),
  ]);

  return {
    ...team,
    reports: [...pendingReports, ...recentReviewedReports].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    ),
  };
}

function sortGames(games: TeamGame[]): TeamGame[] {
  return [...games].sort((left, right) => {
    if (left.scheduledAt && right.scheduledAt) {
      return left.scheduledAt.getTime() - right.scheduledAt.getTime();
    }
    if (left.scheduledAt) return -1;
    if (right.scheduledAt) return 1;
    return left.round - right.round || left.id.localeCompare(right.id);
  });
}

function getDirectionsUrl(league: {
  venueAddress: string | null;
  venueUrl: string | null;
}): string | null {
  if (league.venueUrl) {
    try {
      const url = new URL(league.venueUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      // Fall through to an address search.
    }
  }
  return league.venueAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(league.venueAddress)}`
    : null;
}

function formatDateTime(value: Date | null, timeZone: string): string {
  if (!value) return "Date and time to be announced";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(value);
}

function formatFullDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone,
    weekday: "long",
    year: "numeric",
  }).format(value);
}

function formatCompactDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).format(value);
}

function formatTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

function dateInputValue(date: Date, timeZone: string): string {
  const values = dateParts(date, timeZone);
  return `${values.year}-${values.month}-${values.day}`;
}

function timeInputValue(date: Date, timeZone: string): string {
  const values = dateParts(date, timeZone);
  return `${values.hour}:${values.minute}`;
}

function dateParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function reportLabel(type: ReportType): string {
  return { RAINOUT: "Rainout", RESCHEDULE: "New time", SCORE: "Score" }[type];
}

function reportHistorySummary(
  report: TeamDeskRecord["reports"][number],
  timeZone: string,
): string {
  if (report.type === "SCORE") {
    return `${report.game.homeTeam.name} ${report.homeScore}–${report.awayScore} ${report.game.awayTeam.name}`;
  }
  if (report.type === "RAINOUT") return "mark this game as rained out";
  return report.proposedScheduledAt
    ? `${formatDateTime(report.proposedScheduledAt, timeZone)}${report.proposedFieldName ? ` · ${report.proposedFieldName}` : ""}`
    : "new date pending";
}

function reportTypesForState(state: PublicGameState): ReportType[] {
  if (state === "final") return ["SCORE"];
  if (state === "result-pending") return ["SCORE", "RAINOUT", "RESCHEDULE"];
  if (state === "in-progress") return ["SCORE", "RAINOUT", "RESCHEDULE"];
  if (state === "rained-out" || state === "tbd") return ["RESCHEDULE"];
  if (state === "scheduled" || state === "rescheduled") {
    return ["RAINOUT", "RESCHEDULE"];
  }
  return [];
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function timeZoneLabel(timeZone: string): string {
  return timeZone.replaceAll("_", " ");
}
