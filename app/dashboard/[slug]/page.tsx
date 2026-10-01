import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  logoutAction,
  sendVerificationLinkAction,
} from "@/app/actions/auth";
import {
  markRainoutAction,
  submitBatchResultsAction,
  submitResultAction,
  toggleLockAction,
  updateGameScheduleAction,
} from "@/app/actions/game";
import {
  changeOrganizerEmailAction,
  toggleLeagueArchiveAction,
  updateLeagueSettingsAction,
} from "@/app/actions/league";
import {
  inviteTeamManagerAction,
  reviewGameReportAction,
  revokeTeamManagerAction,
} from "@/app/actions/manager";
import {
  applyScheduleSettingsAction,
  rebuildUnplayedScheduleAction,
} from "@/app/actions/schedule";
import {
  addTeamAction,
  removeTeamAction,
  renameTeamAction,
} from "@/app/actions/team";
import { BrandLink } from "@/app/components/brand-link";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { ConfirmSubmitButton } from "@/app/components/confirm-submit-button";
import { Notice } from "@/app/components/notice";
import { PortableDataPanel } from "@/app/components/portable-data-panel";
import { SubmitButton } from "@/app/components/submit-button";
import { getCommissionerSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { classifyGameState } from "@/lib/game-state";
import { parseScheduleFormFields } from "@/lib/schedule-form";
import {
  buildRebuildSchedulePlan,
  schedulePreviewFingerprint,
} from "@/lib/schedule-rebuild";

import { CopyPublicLinkButton } from "./copy-public-link-button";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    devInvite?: string;
    devOrganizerLink?: string;
    devVerify?: string;
    draftDays?: string;
    draftDuration?: string;
    draftFields?: string;
    draftStartDate?: string;
    draftTimes?: string;
    draftTimezone?: string;
    notice?: string;
    previewRebuild?: string;
    scheduleDraft?: string;
    scores?: string;
    tone?: "error" | "success";
    view?: string;
  }>;
};

type DashboardLeague = NonNullable<Awaited<ReturnType<typeof getDashboardLeague>>>;
type DashboardGame = DashboardLeague["games"][number];
type ReviewedReport = Awaited<ReturnType<typeof getRecentReviewedReports>>[number];
type ScheduleRebuildPreview = NonNullable<
  ReturnType<typeof getScheduleRebuildPreview>
>;
type GameView =
  | "all"
  | "attention"
  | "data"
  | "requests"
  | "results"
  | "scores"
  | "settings"
  | "teams"
  | "upcoming";
type DisplayStatus = "completed" | "in-progress" | "overdue" | "rained-out" | "rescheduled" | "scheduled" | "tbd";

export default async function DashboardPage({ params, searchParams }: DashboardPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const session = await getCommissionerSession(slug);

  if (!session) {
    redirect(`/manage?slug=${encodeURIComponent(slug)}`);
  }

  const league = await getDashboardLeague(slug);

  if (!league) {
    notFound();
  }

  const now = new Date();
  const games = sortGames(league.games);
  const completedGames = games
    .filter((game) => getDisplayStatus(game, league.gameDurationMinutes) === "completed")
    .sort(
      (left, right) =>
        (right.result?.updatedAt.getTime() ?? 0) -
        (left.result?.updatedAt.getTime() ?? 0),
    );
  const attentionGames = games.filter((game) => {
    const status = getDisplayStatus(game, league.gameDurationMinutes);
    return status === "tbd" || status === "overdue" || status === "rained-out";
  });
  const upcomingGames = games.filter((game) => {
    const status = getDisplayStatus(game, league.gameDurationMinutes);
    return status === "scheduled" || status === "rescheduled" || status === "in-progress";
  });
  const pendingReports = league.gameReports;
  const view = normalizeView(query.view);
  const reviewedReports =
    view === "requests" ? await getRecentReviewedReports(league.id) : [];
  const showAllScoreGames = query.scores === "all";
  const scoreReadyGames = games.filter((game) =>
    isReadyForScoreSheet(game, league.timezone, now),
  );
  const visibleGames =
    view === "results"
      ? completedGames
      : view === "attention"
        ? attentionGames
        : view === "all"
          ? games
          : upcomingGames;
  const canEditTeams = completedGames.length === 0;
  const isArchived = Boolean(league.archivedAt);
  const rebuildableCount = games.filter((game) => !game.result && !game.locked).length;
  const completionPercent = games.length
    ? Math.round((completedGames.length / games.length) * 100)
    : 0;
  const storedGameDays = parseNumberList(league.gameDays, [6]);
  const storedTimes = parseTextList(league.gameTimes, ["09:00", "10:30"]);
  const storedFields = parseTextList(league.fieldNames, ["Field 1"]);
  const scheduleDraft = getScheduleDraft(query);
  const rebuildPreview =
    query.previewRebuild === "1" && scheduleDraft
      ? getScheduleRebuildPreview(league, scheduleDraft)
      : null;
  const scheduleFormValues = {
    fieldNames: scheduleDraft?.fieldNames ?? storedFields,
    gameDays: scheduleDraft?.gameDays ?? storedGameDays,
    gameDurationMinutes:
      scheduleDraft?.gameDurationMinutes ?? league.gameDurationMinutes,
    gameTimes: scheduleDraft?.gameTimes ?? storedTimes,
    startDate: scheduleDraft?.startDate ?? league.scheduleStartDate ?? "",
    timeZone: scheduleDraft?.timeZone ?? league.timezone,
  };
  const localInviteUrl = getDevelopmentInviteUrl(query.devInvite);
  const localOrganizerLink = getDevelopmentInviteUrl(query.devOrganizerLink);
  const localVerificationUrl = getDevelopmentInviteUrl(query.devVerify);

  return (
    <div className="min-h-screen bg-[#f3f6f2] text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <BrandLink />
          <div className="flex items-center gap-4">
            <Link className="hidden min-h-11 items-center text-sm font-semibold text-[#627068] hover:text-[#0f5138] sm:inline-flex" href="/dashboard">
              My leagues
            </Link>
            <form action={logoutAction}>
              <button className="min-h-11 rounded-lg px-1 text-sm font-semibold text-[#627068] hover:text-[#0f5138]" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 pb-28 sm:px-6 sm:py-10 sm:pb-28 xl:pb-10">
        <section className="grid gap-6 border-b border-[#cad7cf] pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">Organizer board</p>
            <h1 className="mt-2 break-words text-4xl font-bold tracking-[-0.04em] sm:text-5xl">{league.name}</h1>
            <p className="mt-3 text-base text-[#627068]">
              {[league.sport, league.seasonLabel].filter(Boolean).join(" · ") || "Season in progress"}
              {isArchived ? " · Archived" : ""}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <AutoRefresh updatedAt={league.updatedAt.toISOString()} />
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#bdcbc2] bg-white px-4 py-2.5 text-sm font-bold text-[#0f5138] hover:border-[#0f5138]"
              href={`/l/${slug}`}
              rel="noreferrer"
              target="_blank"
            >
              Preview public page ↗
            </a>
            <CopyPublicLinkButton slug={slug} />
          </div>
        </section>

        <div className="mt-6">
          <Notice message={query.notice} tone={query.tone} />
        </div>
        {localInviteUrl ? (
          <section className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950">
            <p className="font-bold">Local team-manager test link</p>
            <p className="mt-1 text-sm leading-6">Email delivery is replaced by this link during local development.</p>
            <a className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-blue-900 px-4 py-2 text-sm font-bold text-white" href={localInviteUrl}>Open invitation →</a>
          </section>
        ) : null}
        {localVerificationUrl ? (
          <section className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950">
            <p className="font-bold">Local organizer verification link</p>
            <p className="mt-1 text-sm leading-6">Email delivery is replaced by this link during local development.</p>
            <a className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-blue-900 px-4 py-2 text-sm font-bold text-white" href={localVerificationUrl}>Verify organizer access →</a>
          </section>
        ) : null}
        {localOrganizerLink ? (
          <section className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950">
            <p className="font-bold">Local organizer email link</p>
            <p className="mt-1 text-sm leading-6">Email delivery is replaced by this link during local development.</p>
            <a className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-blue-900 px-4 py-2 text-sm font-bold text-white" href={localOrganizerLink}>Open organizer email link →</a>
          </section>
        ) : null}

        {isArchived ? (
          <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 sm:p-6">
            <p className="font-black">This season is archived and read-only.</p>
            <p className="mt-1 text-sm leading-6">The public page remains available. Reopen the season from Settings before changing schedules, teams, managers, or scores.</p>
          </section>
        ) : null}

        {session.scopeLeagueId && !isArchived ? (
          <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="max-w-2xl">
              <p className="font-bold">Protect your return access</p>
              <p className="mt-1 text-sm leading-6 text-blue-900/75">
                This browser can manage the new league now. Verify the organizer email so a future sign-in can recover it and show every league you own.
              </p>
            </div>
            <form action={sendVerificationLinkAction}>
              <input name="slug" type="hidden" value={slug} />
              <SubmitButton
                className="min-h-11 w-full whitespace-nowrap rounded-lg bg-blue-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-950 disabled:opacity-60"
                idleLabel="Email verification link"
                pendingLabel="Sending…"
              />
            </form>
          </section>
        ) : null}

        <section className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-[#cad7cf] bg-[#cad7cf] sm:grid-cols-3">
          <div className="bg-white p-5">
            <p className="text-sm font-semibold text-[#627068]">Next games</p>
            <p className="mt-2 text-3xl font-black tracking-tight">{upcomingGames.length}</p>
            <p className="mt-1 text-sm text-[#526159]">dated and ready</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-sm font-semibold text-[#627068]">Needs attention</p>
            <p className={`mt-2 text-3xl font-black tracking-tight ${attentionGames.length || pendingReports.length ? "text-amber-700" : ""}`}>{attentionGames.length + pendingReports.length}</p>
            <p className="mt-1 text-sm text-[#526159]">games plus {pendingReports.length} manager {pendingReports.length === 1 ? "request" : "requests"}</p>
          </div>
          <div className="bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#627068]">Season complete</p>
              <p className="text-sm font-black">{completionPercent}%</p>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e1e8e3]">
              <div className="h-full rounded-full bg-[#0f6a48]" style={{ width: `${completionPercent}%` }} />
            </div>
            <p className="mt-3 text-sm text-[#526159]">{completedGames.length} of {games.length} finals</p>
          </div>
        </section>

        {pendingReports.length ? (
          <Link
            className="mt-6 flex min-h-16 flex-col justify-center gap-1 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950 transition hover:bg-amber-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942] sm:flex-row sm:items-center sm:justify-between"
            href={`/dashboard/${slug}?view=requests`}
          >
            <span>
              <strong>{pendingReports.length} team-manager {pendingReports.length === 1 ? "report is" : "reports are"} waiting</strong>
              <span className="mt-1 block text-sm">Scores, rainouts, and proposed times stay private until you decide.</span>
            </span>
            <span className="font-bold">Review requests →</span>
          </Link>
        ) : null}

        {!isArchived && view !== "settings" && attentionGames.some((game) => !game.scheduledAt) ? (
          <section className="mt-8 overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-sm">
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-4 sm:px-6">
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-amber-800">Finish the schedule</p>
              <h2 className="mt-1 text-2xl font-bold">Put every TBD game on the calendar</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900/70">Choose your regular availability once. Existing finals and manually scheduled games will be preserved.</p>
            </div>
            <ScheduleSettingsForm
              {...scheduleFormValues}
              finalCount={completedGames.length}
              previewFingerprint={rebuildPreview?.fingerprint}
              rebuildableCount={rebuildableCount}
              slug={slug}
            />
          </section>
        ) : null}

        <section className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
          <div className="min-w-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Game desk</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">{viewTitle(view)}</h2>
              </div>
              <nav aria-label="Game views" className="-mx-4 max-w-full overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <div className="flex min-w-max gap-2">
                  <ViewLink active={view === "upcoming"} count={upcomingGames.length} href={`/dashboard/${slug}`} label="Upcoming" />
                  <ViewLink active={view === "attention"} count={attentionGames.length} href={`/dashboard/${slug}?view=attention`} label="Attention" />
                  <ViewLink active={view === "requests"} count={pendingReports.length} href={`/dashboard/${slug}?view=requests`} label="Requests" />
                  <ViewLink active={view === "scores"} count={scoreReadyGames.length} href={`/dashboard/${slug}?view=scores`} label="Score sheet" />
                  <ViewLink active={view === "results"} count={completedGames.length} href={`/dashboard/${slug}?view=results`} label="Results" />
                  <ViewLink active={view === "all"} count={games.length} href={`/dashboard/${slug}?view=all`} label="All" />
                  <ViewLink active={view === "teams"} count={league.teams.length} href={`/dashboard/${slug}?view=teams`} label="Teams" />
                  <ViewLink active={view === "data"} count={0} href={`/dashboard/${slug}?view=data`} label="Portable data" hideCount />
                  <ViewLink active={view === "settings"} count={0} href={`/dashboard/${slug}?view=settings`} label="Settings" hideCount />
                </div>
              </nav>
            </div>

            {view === "requests" ? (
              <ReportQueue
                archived={isArchived}
                league={league}
                reports={pendingReports}
                reviewedReports={reviewedReports}
                slug={slug}
              />
            ) : view === "scores" ? (
              <BatchScoreSheet
                archived={isArchived}
                games={showAllScoreGames ? games : scoreReadyGames}
                league={league}
                showAll={showAllScoreGames}
                slug={slug}
              />
            ) : view === "teams" ? (
              <TeamOperationsPanel
                archived={isArchived}
                canEditTeams={canEditTeams}
                league={league}
                slug={slug}
              />
            ) : view === "data" ? (
              <PortableDataPanel
                dataRevision={league.dataRevision}
                slug={slug}
                teams={league.teams.map(({ id, name }) => ({ id, name }))}
                verified={session.scopeLeagueId === null}
              />
            ) : view === "settings" ? (
              <div className="mt-5 space-y-5">
                <section className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
                  <div className="border-b border-[#e1e8e3] p-5 sm:p-6">
                    <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Schedule rhythm</p>
                    <h3 className="mt-1 text-2xl font-bold">Dates, times, fields, and duration</h3>
                    <p className="mt-2 text-sm leading-6 text-[#627068]">Fill only TBD games, or deliberately rebuild every unplayed and unlocked game. Official finals stay fixed.</p>
                  </div>
                  {!isArchived ? (
                    <>
                      {rebuildPreview ? (
                        <ScheduleRebuildPreview
                          league={league}
                          preview={rebuildPreview}
                        />
                      ) : null}
                      <ScheduleSettingsForm {...scheduleFormValues} finalCount={completedGames.length} previewFingerprint={rebuildPreview?.fingerprint} rebuildableCount={rebuildableCount} slug={slug} />
                    </>
                  ) : (
                    <ScheduleSettingsSummary
                      fieldNames={storedFields}
                      gameDays={storedGameDays}
                      gameDurationMinutes={league.gameDurationMinutes}
                      gameTimes={storedTimes}
                      startDate={league.scheduleStartDate}
                      timeZone={league.timezone}
                    />
                  )}
                </section>
                <LeagueSettingsPanel league={league} slug={slug} />
              </div>
            ) : visibleGames.length ? (
              <div className="mt-5 space-y-3">
                {visibleGames.map((game) => (
                  <GameManagerCard archived={isArchived} game={game} key={`${game.id}:${game.version}`} league={league} slug={slug} />
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-[#bdcbc2] bg-white px-6 py-12 text-center">
                <p className="font-bold">Nothing here right now</p>
                <p className="mt-1 text-sm text-[#627068]">Choose another view to see the rest of the season.</p>
              </div>
            )}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-5">
            <div className={view === "teams" ? "hidden" : "hidden xl:block"}>
              <TeamOperationsPanel
                archived={isArchived}
                canEditTeams={canEditTeams}
                compact
                league={league}
                slug={slug}
              />
            </div>

            <details className={view === "settings" ? "hidden" : "group hidden overflow-hidden rounded-2xl border border-[#cad7cf] bg-white xl:block"}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 font-bold marker:hidden">
                Schedule settings
                <span aria-hidden="true" className="transition group-open:rotate-180">⌄</span>
              </summary>
              <div className="border-t border-[#e1e8e3] p-5">
                <p className="mb-4 text-sm leading-6 text-[#627068]">Use these settings to fill any remaining TBD games. Existing dates stay untouched.</p>
                {!isArchived ? (
                  <ScheduleSettingsForm {...scheduleFormValues} compact finalCount={completedGames.length} previewFingerprint={rebuildPreview?.fingerprint} rebuildableCount={rebuildableCount} slug={slug} />
                ) : (
                  <p className="text-sm text-[#627068]">Reopen the season to change its schedule.</p>
                )}
              </div>
            </details>

            <section className="hidden rounded-2xl border border-[#cad7cf] bg-white p-5 xl:block">
              <p className="font-bold">League tools</p>
              <div className="mt-3 grid gap-2">
                <Link className="inline-flex min-h-11 items-center rounded-lg border border-[#bdcbc2] px-3 text-sm font-bold text-[#0f5138] hover:border-[#0f5138]" href={`/dashboard/${slug}?view=settings`}>League settings</Link>
                <Link className="inline-flex min-h-11 items-center rounded-lg border border-[#bdcbc2] px-3 text-sm font-bold text-[#0f5138] hover:border-[#0f5138]" href={`/dashboard/${slug}?view=requests`}>Manager requests <span className="ml-auto">{pendingReports.length}</span></Link>
                <Link className="inline-flex min-h-11 items-center rounded-lg border border-[#bdcbc2] px-3 text-sm font-bold text-[#0f5138] hover:border-[#0f5138]" href={`/dashboard/${slug}?view=data`}>Portable data</Link>
              </div>
            </section>
          </aside>
        </section>
      </main>

      <nav aria-label="Organizer shortcuts" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[#cad7cf] bg-white/95 px-1 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(16,35,28,.08)] backdrop-blur xl:hidden">
        <MobileNavLink href="/dashboard" label="My leagues" />
        <MobileNavLink active={view === "attention"} href={`/dashboard/${slug}?view=attention`} label={`Attention ${attentionGames.length}`} />
        <MobileNavLink active={view === "requests"} href={`/dashboard/${slug}?view=requests`} label={`Requests ${pendingReports.length}`} />
        <MobileNavLink active={view === "scores"} href={`/dashboard/${slug}?view=scores`} label="Scores" />
        <MobileNavLink active={view === "settings"} href={`/dashboard/${slug}?view=settings`} label="Settings" />
      </nav>
    </div>
  );
}

function GameManagerCard({
  archived,
  game,
  league,
  slug,
}: {
  archived: boolean;
  game: DashboardGame;
  league: DashboardLeague;
  slug: string;
}) {
  const status = getDisplayStatus(game, league.gameDurationMinutes);
  const dateValue = game.scheduledAt ? dateInputValue(game.scheduledAt, league.timezone) : "";
  const timeValue = game.scheduledAt ? timeInputValue(game.scheduledAt, league.timezone) : "";
  const fieldNames = parseTextList(league.fieldNames, []);

  return (
    <article className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
      <div className="grid gap-4 p-4 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:p-5">
        <div>
          <p className="font-black">{game.scheduledAt ? formatShortDate(game.scheduledAt, league.timezone) : `Round ${game.round}`}</p>
          <p className="mt-0.5 text-sm text-[#627068]">{game.scheduledAt ? formatTime(game.scheduledAt, league.timezone) : "Date TBD"}</p>
        </div>
        <div className="min-w-0">
          <p className="break-words text-base font-bold sm:truncate">{game.homeTeam.name} <span className="px-1 font-normal text-[#627068]">vs</span> {game.awayTeam.name}</p>
          <p className="mt-1 text-sm text-[#526159]">{game.fieldName ?? "Field TBD"}</p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          {game.result ? <p className="text-xl font-black tabular-nums">{game.result.homeScore}–{game.result.awayScore}</p> : <StatusBadge status={status} />}
        </div>
      </div>
      {!archived ? <details className="group border-t border-[#edf1ee]">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-[#0f5138] marker:hidden sm:px-5">Edit this game <span aria-hidden="true" className="ml-1 inline-block transition group-open:rotate-180">⌄</span></summary>
        <div className="grid gap-4 border-t border-[#edf1ee] bg-[#f8faf8] p-4 lg:grid-cols-3 sm:p-5">
          <div className="rounded-xl border border-[#d9e2dc] bg-white p-4">
            <p className="font-bold">Final score</p>
            <form action={submitResultAction}>
              <input name="expectedGameVersion" type="hidden" value={game.version} />
              <input name="gameId" type="hidden" value={game.id} />
              <input name="slug" type="hidden" value={slug} />
              <fieldset className="mt-3" disabled={game.locked}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-sm font-semibold">
                    <span className="block truncate" title={game.homeTeam.name}>{game.homeTeam.name}</span>
                    <input className="w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base" defaultValue={game.result?.homeScore ?? ""} max={999} min={0} name="homeScore" required step={1} type="number" />
                  </label>
                  <label className="space-y-1 text-sm font-semibold">
                    <span className="block truncate" title={game.awayTeam.name}>{game.awayTeam.name}</span>
                    <input className="w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base" defaultValue={game.result?.awayScore ?? ""} max={999} min={0} name="awayScore" required step={1} type="number" />
                  </label>
                </div>
                <SubmitButton className="mt-3 min-h-11 w-full rounded-lg bg-[#0f5138] px-3 py-2 text-sm font-bold text-white hover:bg-[#0a3828] disabled:bg-[#82968a]" idleLabel={game.result ? "Update final" : "Post final"} pendingLabel="Saving…" />
              </fieldset>
            </form>
            {game.result ? (
              <form action={toggleLockAction} className="mt-2">
                <input name="expectedGameVersion" type="hidden" value={game.version} />
                <input name="gameId" type="hidden" value={game.id} />
                <input name="lockAction" type="hidden" value={game.locked ? "unlock" : "lock"} />
                <input name="slug" type="hidden" value={slug} />
                <button className="w-full py-1 text-xs font-semibold text-[#627068] hover:text-[#0f5138]" type="submit">{game.locked ? "Unlock score editing" : "Lock this final score"}</button>
              </form>
            ) : null}
          </div>

          <form action={updateGameScheduleAction} className="rounded-xl border border-[#d9e2dc] bg-white p-4">
            <input name="expectedGameVersion" type="hidden" value={game.version} />
            <input name="gameId" type="hidden" value={game.id} />
            <input name="slug" type="hidden" value={slug} />
            <input name="timezone" type="hidden" value={league.timezone} />
            <p className="font-bold">Date and field</p>
            <div className="mt-3 grid gap-3 min-[360px]:grid-cols-2">
              <label className="space-y-1 text-sm font-semibold">Date<input className="w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base" defaultValue={dateValue} name="scheduledDate" required type="date" /></label>
              <label className="space-y-1 text-sm font-semibold">Time<input className="w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base" defaultValue={timeValue} name="scheduledTime" required type="time" /></label>
            </div>
            <label className="mt-3 block space-y-1 text-sm font-semibold">Field or court
              <input className="w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base" defaultValue={game.fieldName ?? ""} list={`fields-${game.id}`} name="fieldName" placeholder="Field 1" />
              <datalist id={`fields-${game.id}`}>{fieldNames.map((field) => <option key={field} value={field} />)}</datalist>
            </label>
            <SubmitButton className="mt-3 min-h-11 w-full rounded-lg border border-[#0f5138] px-3 py-2 text-sm font-bold text-[#0f5138] hover:bg-[#e9f0eb] disabled:opacity-50" idleLabel={game.scheduledAt ? "Save new details" : "Schedule game"} pendingLabel="Saving…" />
          </form>

          <div className="rounded-xl border border-[#d9e2dc] bg-white p-4">
            <p className="font-bold">Game status</p>
            <p className="mt-2 text-sm leading-6 text-[#627068]">A rainout removes any final score and moves this game to Needs attention.</p>
            <form action={markRainoutAction} className="mt-4">
              <input name="expectedGameVersion" type="hidden" value={game.version} />
              <input name="gameId" type="hidden" value={game.id} />
              <input name="slug" type="hidden" value={slug} />
              <ConfirmSubmitButton className="min-h-11 w-full rounded-lg border border-amber-500 px-3 py-2 text-sm font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-50" confirmMessage={`Mark ${game.homeTeam.name} vs ${game.awayTeam.name} as rained out? Any saved score will be removed.`} label="Mark rained out" pendingLabel="Updating…" />
            </form>
          </div>
        </div>
      </details> : null}
    </article>
  );
}

function ReportQueue({ archived, league, reports, reviewedReports, slug }: {
  archived: boolean;
  league: DashboardLeague;
  reports: DashboardLeague["gameReports"];
  reviewedReports: ReviewedReport[];
  slug: string;
}) {
  return (
    <section className="mt-5">
      <div className="rounded-2xl border border-[#cad7cf] bg-white p-5 sm:p-6">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Approval queue</p>
        <h3 className="mt-1 text-2xl font-bold">Team-manager reports</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#627068]">Managers can report only for their assigned team. Nothing here changes the public schedule or standings until you approve it.</p>
      </div>

      {reports.length ? (
        <div className="mt-4 space-y-3">
          {reports.map((report) => {
            const stale = report.gameVersion !== report.game.version;
            return (
              <article className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white" key={report.id}>
                <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-950">{reportTypeLabel(report.type)}</span>
                      <span className="text-sm font-bold text-[#0f6a48]">{report.team.name}</span>
                      {stale ? <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-900">Official game changed</span> : null}
                    </div>
                    <h4 className="mt-3 text-lg font-bold">{report.game.homeTeam.name} vs {report.game.awayTeam.name}</h4>
                    <p className="mt-1 text-sm text-[#627068]">
                      Current: {report.type === "SCORE"
                        ? report.game.result
                          ? `${report.game.homeTeam.name} ${report.game.result.homeScore}–${report.game.result.awayScore} ${report.game.awayTeam.name}`
                          : "No official score yet"
                        : `${report.game.scheduledAt ? `${formatShortDate(report.game.scheduledAt, league.timezone)} · ${formatTime(report.game.scheduledAt, league.timezone)}` : "Date TBD"}${report.game.fieldName ? ` · ${report.game.fieldName}` : ""}`}
                    </p>
                    <p className="mt-3 font-semibold">Requested: {reportSummary(report, league.timezone)}</p>
                    {report.note ? <p className="mt-2 rounded-lg bg-[#f3f6f2] px-3 py-2 text-sm leading-6">“{report.note}”</p> : null}
                    <p className="mt-2 text-xs text-[#627068]">Submitted by {report.submittedByEmail} · <time dateTime={report.createdAt.toISOString()}>{formatFullDate(report.createdAt, league.timezone)}</time></p>
                  </div>

                  {!archived ? (
                    <form action={reviewGameReportAction} className="w-full space-y-2 sm:w-56">
                      <input name="reportId" type="hidden" value={report.id} />
                      <input name="slug" type="hidden" value={slug} />
                      <label className="block text-xs font-semibold">
                        <span className="mb-1 block">Review note (optional)</span>
                        <textarea className="min-h-16 w-full rounded-lg border border-[#bdcbc2] px-3 py-2 text-base" maxLength={500} name="decisionNote" />
                      </label>
                      <button className="min-h-11 w-full rounded-lg bg-[#0f5138] px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={stale} name="decision" type="submit" value="approve">Approve official update</button>
                      <button className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 py-2 text-sm font-bold text-red-800 hover:border-red-500" name="decision" type="submit" value="reject">Decline report</button>
                    </form>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-[#bdcbc2] bg-white px-6 py-12 text-center">
          <p className="font-bold">No manager reports waiting</p>
          <p className="mt-1 text-sm text-[#627068]">New score, rainout, and reschedule reports will appear here.</p>
        </div>
      )}

      {reviewedReports.length ? (
        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Audit trail</p>
              <h3 className="mt-1 text-xl font-bold">Recent decisions</h3>
            </div>
            <span className="text-sm text-[#627068]">Latest {reviewedReports.length}</span>
          </div>
          <ol className="mt-4 divide-y divide-[#e1e8e3] overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
            {reviewedReports.map((report) => (
              <li className="p-4 sm:p-5" key={report.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${report.status === "APPROVED" ? "bg-emerald-100 text-emerald-900" : "bg-[#edf1ee] text-[#526159]"}`}>
                    {reviewedReportStatusLabel(report)}
                  </span>
                  <span className="text-sm font-bold text-[#0f6a48]">{report.team.name}</span>
                  <span className="text-sm text-[#627068]">{reportTypeLabel(report.type)}</span>
                </div>
                <p className="mt-2 font-semibold">{report.game.homeTeam.name} vs {report.game.awayTeam.name}</p>
                <p className="mt-1 text-sm text-[#405149]">Submitted: {reportSummary(report, league.timezone)}</p>
                {report.note ? <p className="mt-1 text-sm text-[#627068]">Manager note: {report.note}</p> : null}
                {report.decisionNote ? <p className="mt-1 text-sm text-[#627068]">Decision note: {report.decisionNote}</p> : null}
                {report.reviewedAt ? (
                  <p className="mt-2 text-xs text-[#627068]">
                    Reviewed {formatFullDate(report.reviewedAt, league.timezone)}
                    {report.reviewedByEmail ? ` by ${report.reviewedByEmail}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  );
}

function BatchScoreSheet({ archived, games, league, showAll, slug }: {
  archived: boolean;
  games: DashboardGame[];
  league: DashboardLeague;
  showAll: boolean;
  slug: string;
}) {
  const scorable = games.filter(
    (game) => !game.result && !game.locked && game.status !== "RAINED_OUT",
  );
  const groupedGames = groupScoreSheetGames(scorable, league.timezone);

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
      <div className="border-b border-[#e1e8e3] p-5 sm:p-6">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Game-night score sheet</p>
        <h3 className="mt-1 text-2xl font-bold">Enter several finals at once</h3>
        <p className="mt-2 text-sm leading-6 text-[#627068]">Leave untouched games blank. Home is always the first team and away is the second. The default view includes today and earlier games only.</p>
        <Link
          className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-[#0f5138]"
          href={showAll ? `/dashboard/${slug}?view=scores` : `/dashboard/${slug}?view=scores&scores=all`}
        >
          {showAll ? "Show game-day games only" : "Show future and TBD games"} →
        </Link>
      </div>
      {archived ? (
        <p className="p-6 text-sm text-[#627068]">Reopen the season to edit scores.</p>
      ) : !scorable.length ? (
        <p className="p-6 text-sm text-[#627068]">Every playable game already has a final score or is locked.</p>
      ) : (
        <form action={submitBatchResultsAction}>
          <input name="slug" type="hidden" value={slug} />
          <div className="divide-y divide-[#cad7cf]">
            {groupedGames.map(([groupLabel, groupGames]) => (
              <section key={groupLabel}>
                <h4 className="bg-[#f3f6f2] px-4 py-2 text-sm font-black text-[#405149] sm:px-5">{groupLabel}</h4>
                <div className="divide-y divide-[#e1e8e3]">
                  {groupGames.map((game) => (
                    <fieldset className="grid gap-3 p-4 sm:grid-cols-[9rem_minmax(0,1fr)_7rem_7rem] sm:items-end sm:p-5" disabled={game.locked} key={`${game.id}:${game.version}`}>
                      <input name={`expectedGameVersion:${game.id}`} type="hidden" value={game.version} />
                      <input name="gameId" type="hidden" value={game.id} />
                      <div className="text-sm">
                        <p className="font-bold">{game.scheduledAt ? formatShortDate(game.scheduledAt, league.timezone) : `Round ${game.round}`}</p>
                        <p className="text-[#627068]">{game.scheduledAt ? formatTime(game.scheduledAt, league.timezone) : "Date TBD"}</p>
                      </div>
                      <p className="font-semibold"><span className="break-words">{game.homeTeam.name}</span> <span className="font-normal text-[#627068]">vs</span> <span className="break-words">{game.awayTeam.name}</span></p>
                      <label className="text-xs font-semibold"><span className="mb-1 block truncate">Home · {game.homeTeam.name}</span><input className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base" inputMode="numeric" max={999} min={0} name={`homeScore:${game.id}`} type="number" /></label>
                      <label className="text-xs font-semibold"><span className="mb-1 block truncate">Away · {game.awayTeam.name}</span><input className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base" inputMode="numeric" max={999} min={0} name={`awayScore:${game.id}`} type="number" /></label>
                    </fieldset>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="sticky bottom-20 flex justify-end border-t border-[#cad7cf] bg-[#f8faf8]/95 p-4 backdrop-blur xl:bottom-0">
            <SubmitButton className="min-h-12 w-full rounded-lg bg-[#0f5138] px-5 py-3 font-bold text-white disabled:bg-[#82968a] sm:w-auto" idleLabel="Save entered finals" pendingLabel="Saving all scores…" />
          </div>
        </form>
      )}
    </section>
  );
}

function TeamOperationsPanel({ archived, canEditTeams, compact = false, league, slug }: {
  archived: boolean;
  canEditTeams: boolean;
  compact?: boolean;
  league: DashboardLeague;
  slug: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-[#cad7cf] bg-white ${compact ? "" : "mt-5"}`}>
      <div className="border-b border-[#e1e8e3] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Teams and access</p>
            <h3 className="mt-1 text-xl font-bold">{league.teams.length} teams</h3>
          </div>
          {!compact ? <Link className="text-sm font-bold text-[#0f5138]" href={`/dashboard/${slug}?view=settings`}>League settings →</Link> : null}
        </div>
        <p className="mt-2 text-sm leading-6 text-[#627068]">Invite a manager to report scores, rainouts, and proposed times for one team. You still approve every official change.</p>
      </div>
      <div className="divide-y divide-[#e1e8e3]">
        {league.teams.map((team) => (
          <article className="p-4 sm:p-5" key={team.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-bold">{team.name}</h4>
              <Link className="text-sm font-bold text-[#0f5138]" href={`/team/${team.id}`}>Open team desk →</Link>
            </div>

            {!archived ? (
              <form action={renameTeamAction} className="mt-3 flex gap-2">
                <input name="slug" type="hidden" value={slug} />
                <input name="teamId" type="hidden" value={team.id} />
                <label className="min-w-0 flex-1"><span className="sr-only">Rename {team.name}</span><input className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base" defaultValue={team.name} maxLength={60} name="teamName" required /></label>
                <button className="min-h-11 rounded-lg border border-[#bdcbc2] px-3 text-sm font-bold text-[#0f5138]" type="submit">Rename</button>
              </form>
            ) : null}

            {team.managers.length ? (
              <ul className="mt-3 space-y-2">
                {team.managers.map((manager) => (
                  <li className="flex flex-wrap items-center gap-2 rounded-lg bg-[#f3f6f2] px-3 py-2 text-sm" key={manager.id}>
                    <span className="min-w-0 flex-1 truncate">{manager.email}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${manager.acceptedAt ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"}`}>{manager.acceptedAt ? "Active" : "Invite pending"}</span>
                    {!archived ? (
                      <>
                        <form action={inviteTeamManagerAction}>
                          <input name="email" type="hidden" value={manager.email} />
                          <input name="slug" type="hidden" value={slug} />
                          <input name="teamId" type="hidden" value={team.id} />
                          <button className="min-h-11 px-2 text-sm font-bold text-[#0f5138]" type="submit">Resend</button>
                        </form>
                        <form action={revokeTeamManagerAction}>
                          <input name="managerId" type="hidden" value={manager.id} />
                          <input name="slug" type="hidden" value={slug} />
                          <ConfirmSubmitButton className="min-h-11 px-2 text-sm font-bold text-red-800" confirmMessage={`Remove ${manager.email} from ${team.name}? Their access ends immediately.`} label="Remove" pendingLabel="…" />
                        </form>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-[#627068]">No team manager yet.</p>}

            {!archived ? (
              <form action={inviteTeamManagerAction} className="mt-3 flex gap-2">
                <input name="slug" type="hidden" value={slug} />
                <input name="teamId" type="hidden" value={team.id} />
                <label className="min-w-0 flex-1"><span className="sr-only">Manager email for {team.name}</span><input className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base" name="email" placeholder="manager@example.com" required type="email" /></label>
                <SubmitButton className="min-h-11 rounded-lg bg-[#10231c] px-3 text-sm font-bold text-white disabled:opacity-50" idleLabel="Invite" pendingLabel="Sending…" />
              </form>
            ) : null}

            {!archived && canEditTeams && league.teams.length > 2 ? (
              <form action={removeTeamAction} className="mt-3">
                <input name="slug" type="hidden" value={slug} />
                <input name="teamId" type="hidden" value={team.id} />
                <ConfirmSubmitButton className="min-h-11 rounded-lg px-2 text-sm font-bold text-red-800" confirmMessage={`Remove ${team.name} and all of its games? Other matchups keep their dates and fields.`} label="Remove team and games" pendingLabel="Removing…" />
              </form>
            ) : null}
          </article>
        ))}
      </div>
      {!archived && canEditTeams ? (
        <form action={addTeamAction} className="border-t border-[#e1e8e3] bg-[#f8faf8] p-5">
          <input name="slug" type="hidden" value={slug} />
          <label className="block text-sm font-semibold" htmlFor={`teamName-${compact ? "compact" : "full"}`}>Add a team</label>
          <div className="mt-2 flex gap-2">
            <input className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#bdcbc2] px-3 text-base" id={`teamName-${compact ? "compact" : "full"}`} maxLength={60} name="teamName" placeholder="Team name" required />
            <SubmitButton className="rounded-lg bg-[#0f5138] px-3 text-sm font-bold text-white disabled:opacity-50" idleLabel="Add" pendingLabel="…" />
          </div>
          <p className="mt-2 text-xs leading-5 text-[#627068]">Adding and removing teams closes after the first final. Renaming stays available.</p>
        </form>
      ) : null}
    </section>
  );
}

function LeagueSettingsPanel({ league, slug }: { league: DashboardLeague; slug: string }) {
  return (
    <div className="mt-5 space-y-4">
      {!league.archivedAt ? (
        <form action={updateLeagueSettingsAction} className="rounded-2xl border border-[#cad7cf] bg-white p-5 sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">League settings</p>
          <h3 className="mt-1 text-2xl font-bold">Public details and scoring</h3>
          <input name="slug" type="hidden" value={slug} />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <SettingsInput defaultValue={league.name} label="League name" maxLength={80} name="name" required />
            <SettingsInput defaultValue={league.seasonLabel ?? ""} label="Season label" maxLength={60} name="seasonLabel" />
            <SettingsInput defaultValue={league.sport ?? ""} label="Sport" maxLength={60} name="sport" />
            <SettingsInput defaultValue={league.venueName ?? ""} label="Primary venue" maxLength={80} name="venueName" />
            <div className="sm:col-span-2"><SettingsInput defaultValue={league.venueAddress ?? ""} label="Public venue address" maxLength={180} name="venueAddress" /></div>
            <div className="sm:col-span-2"><SettingsInput defaultValue={league.venueUrl ?? ""} label="Directions link (optional)" name="venueUrl" placeholder="https://…" type="url" /></div>
          </div>
          <p className="mt-2 text-xs text-[#627068]">Venue details appear publicly and in calendar events. This version supports one primary venue.</p>

          <fieldset className="mt-6 rounded-xl border border-[#d9e2dc] p-4">
            <legend className="px-1 font-bold">Standings rules</legend>
            <div className="grid gap-3 min-[360px]:grid-cols-3">
              <SettingsInput defaultValue={league.winPoints} label="Win" max={99} min={0} name="winPoints" required type="number" />
              <SettingsInput defaultValue={league.tiePoints} label="Tie" max={99} min={0} name="tiePoints" required type="number" />
              <SettingsInput defaultValue={league.lossPoints} label="Loss" max={99} min={0} name="lossPoints" required type="number" />
            </div>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-semibold"><input className="h-5 w-5 accent-[#0f5138]" defaultChecked={league.showStandings} name="showStandings" type="checkbox" />Show standings on the public page</label>
          </fieldset>
          <SubmitButton className="mt-5 min-h-11 w-full rounded-lg bg-[#0f5138] px-5 py-2.5 font-bold text-white disabled:bg-[#82968a] sm:w-auto" idleLabel="Save league settings" pendingLabel="Saving…" />
        </form>
      ) : (
        <section className="rounded-2xl border border-[#cad7cf] bg-white p-5 sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">Stored league settings</p>
          <h3 className="mt-1 text-2xl font-bold">Public details and scoring</h3>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <ReadOnlySetting label="League name" value={league.name} />
            <ReadOnlySetting label="Season" value={league.seasonLabel ?? "Not set"} />
            <ReadOnlySetting label="Sport" value={league.sport ?? "Not set"} />
            <ReadOnlySetting label="Primary venue" value={league.venueName ?? "Not set"} />
            <ReadOnlySetting label="Venue address" value={league.venueAddress ?? "Not set"} />
            <ReadOnlySetting label="Directions link" value={league.venueUrl ?? "Not set"} />
            <ReadOnlySetting label="Standings points" value={`${league.winPoints} win · ${league.tiePoints} tie · ${league.lossPoints} loss`} />
            <ReadOnlySetting label="Public standings" value={league.showStandings ? "Shown" : "Hidden"} />
            <ReadOnlySetting label="Organizer email" value={league.commissionerEmail ?? "Not set"} />
          </dl>
          <p className="mt-5 text-sm text-[#627068]">Reopen the season to edit these values.</p>
        </section>
      )}

      {!league.archivedAt ? (
        <form action={changeOrganizerEmailAction} className="rounded-2xl border border-[#cad7cf] bg-white p-5 sm:p-6">
          <p className="font-bold">Organizer email</p>
          <p className="mt-1 text-sm leading-6 text-[#627068]">Current: {league.commissionerEmail}. A verified organizer keeps access until the replacement address accepts the transfer.</p>
          <input name="slug" type="hidden" value={slug} />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#bdcbc2] px-3 text-base" name="organizerEmail" placeholder="new-organizer@example.com" required type="email" />
            <SubmitButton className="min-h-11 rounded-lg border border-[#0f5138] px-4 text-sm font-bold text-[#0f5138] disabled:opacity-50" idleLabel="Send transfer link" pendingLabel="Sending…" />
          </div>
        </form>
      ) : null}

      <section className="rounded-2xl border border-[#cad7cf] bg-white p-5 sm:p-6">
        <p className="font-bold">Season lifecycle</p>
        <p className="mt-1 text-sm leading-6 text-[#627068]">Archiving pauses every staff mutation while keeping the public page and history available. It is reversible.</p>
        <form action={toggleLeagueArchiveAction} className="mt-4">
          <input name="archiveAction" type="hidden" value={league.archivedAt ? "reopen" : "archive"} />
          <input name="slug" type="hidden" value={slug} />
          <ConfirmSubmitButton className={`min-h-11 rounded-lg px-4 text-sm font-bold ${league.archivedAt ? "bg-[#0f5138] text-white" : "border border-amber-500 text-amber-900 hover:bg-amber-50"}`} confirmMessage={league.archivedAt ? "Reopen this season for organizer and manager changes?" : `Archive this season and pause all staff changes? ${league.games.filter((game) => !game.result).length} games do not have a final and ${league.gameReports.length} manager reports are still pending. The public page will remain available.`} label={league.archivedAt ? "Reopen season" : "Archive season"} pendingLabel="Updating…" />
        </form>
      </section>

      <section className="rounded-2xl border border-[#cad7cf] bg-white p-5 sm:p-6">
        <p className="font-bold">Recent activity</p>
        {league.activityEvents.length ? (
          <ol className="mt-3 divide-y divide-[#e1e8e3]">
            {league.activityEvents.map((event) => (
              <li className="py-3 text-sm" key={event.id}><p className="font-semibold">{event.summary}</p><time className="mt-1 block text-[#627068]" dateTime={event.createdAt.toISOString()}>{formatFullDate(event.createdAt, league.timezone)}</time></li>
            ))}
          </ol>
        ) : <p className="mt-3 text-sm text-[#627068]">Activity will appear here as the season changes.</p>}
      </section>
    </div>
  );
}

function SettingsInput({ defaultValue, label, name, ...inputProps }: {
  defaultValue: number | string;
  label: string;
  name: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "name">) {
  return (
    <label className="block text-sm font-semibold"><span className="mb-1.5 block">{label}</span><input {...inputProps} className="min-h-11 w-full rounded-lg border border-[#bdcbc2] px-3 text-base" defaultValue={defaultValue} name={name} /></label>
  );
}

function ReadOnlySetting({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-[#405149]">{label}</dt>
      <dd className="mt-1 break-words text-[#627068]">{value}</dd>
    </div>
  );
}

function ScheduleSettingsSummary({ fieldNames, gameDays, gameDurationMinutes, gameTimes, startDate, timeZone }: {
  fieldNames: string[];
  gameDays: number[];
  gameDurationMinutes: number;
  gameTimes: string[];
  startDate: string | null;
  timeZone: string;
}) {
  const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <div className="p-5 sm:p-6">
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <ReadOnlySetting label="Schedule starts" value={startDate ?? "Not set"} />
        <ReadOnlySetting label="Time zone" value={timeZone} />
        <ReadOnlySetting label="Game length" value={`${gameDurationMinutes} minutes`} />
        <ReadOnlySetting label="Game days" value={gameDays.map((day) => dayLabels[day]).join(", ")} />
        <ReadOnlySetting label="Start times" value={gameTimes.map(displayStoredTime).join(", ")} />
        <ReadOnlySetting label="Fields or courts" value={fieldNames.join(", ")} />
      </dl>
      <p className="mt-5 text-sm text-[#627068]">Reopen the season to change its schedule.</p>
    </div>
  );
}

function MobileNavLink({ active = false, href, label }: { active?: boolean; href: string; label: string }) {
  return <Link aria-current={active ? "page" : undefined} className={`flex min-h-12 items-center justify-center whitespace-nowrap rounded-lg px-1 text-center text-[10px] font-bold min-[360px]:text-xs ${active ? "bg-[#e8f2ec] text-[#0f5138]" : "text-[#526159]"}`} href={href}>{label}</Link>;
}

function reportSummary(
  report: DashboardLeague["gameReports"][number] | ReviewedReport,
  timeZone: string,
): string {
  if (report.type === "SCORE") return `${report.game.homeTeam.name} ${report.homeScore}–${report.awayScore} ${report.game.awayTeam.name}`;
  if (report.type === "RAINOUT") return "Mark this game as rained out";
  return report.proposedScheduledAt
    ? `${formatFullDate(report.proposedScheduledAt, timeZone)}${report.proposedFieldName ? ` · ${report.proposedFieldName}` : ""}`
    : "New date pending";
}

function reportTypeLabel(type: "RAINOUT" | "RESCHEDULE" | "SCORE"): string {
  return { RAINOUT: "Rainout report", RESCHEDULE: "Proposed time", SCORE: "Score report" }[type];
}

function reviewedReportStatusLabel(report: ReviewedReport): string {
  if (report.status === "APPROVED") return "Approved";
  if (report.decisionNote?.startsWith("Replaced by")) return "Replaced";
  if (report.decisionNote?.startsWith("Superseded by")) return "Superseded";
  return "Declined";
}

function ScheduleSettingsForm({ compact = false, fieldNames, finalCount, gameDays, gameDurationMinutes, gameTimes, previewFingerprint, rebuildableCount, slug, startDate, timeZone }: {
  compact?: boolean;
  fieldNames: string[];
  finalCount: number;
  gameDays: number[];
  gameDurationMinutes: number | string;
  gameTimes: string[];
  previewFingerprint?: string;
  rebuildableCount: number;
  slug: string;
  startDate: string;
  timeZone: string;
}) {
  return (
    <form action={rebuildUnplayedScheduleAction} className={compact ? "space-y-4" : "grid gap-5 p-5 sm:p-6 lg:grid-cols-2"}>
      {previewFingerprint ? <input name="previewFingerprint" type="hidden" value={previewFingerprint} /> : null}
      <input name="slug" type="hidden" value={slug} />
      <label className="block space-y-1.5 text-sm font-semibold">Start scheduling from
        <input className="w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base" defaultValue={startDate} name="startDate" required type="date" />
      </label>
      <label className="block space-y-1.5 text-sm font-semibold">Time zone
        <input
          className="w-full rounded-lg border border-[#bdcbc2] bg-white px-3 py-2.5 text-base"
          defaultValue={timeZone}
          list={`timezones-${compact ? "compact" : "full"}`}
          name="timezone"
          required
          type="text"
        />
        <TimeZoneOptions id={`timezones-${compact ? "compact" : "full"}`} />
      </label>
      <label className="block space-y-1.5 text-sm font-semibold">Game length
        <div className="relative">
          <input className="w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 pr-20 text-base" defaultValue={gameDurationMinutes} max={480} min={15} name="gameDurationMinutes" required step={5} type="number" />
          <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-[#526159]">minutes</span>
        </div>
      </label>
      <fieldset className={compact ? "" : "lg:col-span-2"}>
        <legend className="text-sm font-semibold">Game days</legend>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {[[0,"Sun"],[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"]].map(([value,label]) => (
                    <label className="cursor-pointer" key={value}><input className="peer sr-only" defaultChecked={gameDays.includes(Number(value))} name="gameDays" type="checkbox" value={value} /><span className="grid min-h-11 place-items-center rounded-lg border border-[#bdcbc2] text-xs font-bold text-[#627068] peer-checked:border-[#0f5138] peer-checked:bg-[#0f5138] peer-checked:text-white">{label}</span></label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1.5 text-sm font-semibold">Start times
        <textarea className="min-h-24 w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base leading-7" defaultValue={gameTimes.map(displayStoredTime).join("\n")} name="gameTimes" required />
      </label>
      <label className="block space-y-1.5 text-sm font-semibold">Fields or courts
        <textarea className="min-h-24 w-full rounded-lg border border-[#bdcbc2] px-3 py-2.5 text-base leading-7" defaultValue={fieldNames.join("\n")} name="fieldNames" required />
      </label>
      <div className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 ${compact ? "" : "lg:col-span-2"}`}>
        <strong>Rebuild impact:</strong> {rebuildableCount} unplayed {rebuildableCount === 1 ? "game may" : "games may"} move. {finalCount} official {finalCount === 1 ? "final stays" : "finals stay"} fixed.
      </div>
      <div className={`${compact ? "" : "lg:col-span-2 lg:flex lg:justify-end"} grid gap-2 ${previewFingerprint ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <SubmitButton className="min-h-11 w-full rounded-lg bg-[#0f5138] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0a3828] disabled:bg-[#82968a]" formAction={applyScheduleSettingsAction} idleLabel="Save and fill TBD games" pendingLabel="Building schedule…" />
        <SubmitButton
          className="min-h-11 w-full rounded-lg border border-[#0f5138] bg-white px-4 py-2.5 text-sm font-bold text-[#0f5138] hover:bg-[#e9f0eb] disabled:opacity-50"
          idleLabel={previewFingerprint ? "Refresh rebuild preview" : "Preview rebuild"}
          name="rebuildIntent"
          pendingLabel="Preparing preview…"
          value="preview"
        />
        {previewFingerprint ? (
          <ConfirmSubmitButton
            className="min-h-11 w-full rounded-lg border border-amber-500 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
            confirmMessage="Apply exactly this previewed rebuild to every unplayed, unlocked game? Official finals and locked games stay fixed."
            label="Apply previewed rebuild"
            name="rebuildIntent"
            pendingLabel="Rebuilding…"
            value="apply"
          />
        ) : null}
      </div>
    </form>
  );
}

function ScheduleRebuildPreview({ league, preview }: {
  league: DashboardLeague;
  preview: ScheduleRebuildPreview;
}) {
  return (
    <section className="border-b border-blue-200 bg-blue-50 p-5 text-blue-950 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-blue-800">Preview only</p>
          <h4 className="mt-1 text-xl font-bold">Review the proposed rebuild</h4>
          <p className="mt-1 text-sm leading-6 text-blue-900/75">Nothing has changed yet. Applying this preview moves {preview.changedCount} {preview.changedCount === 1 ? "game" : "games"}; {preview.unchangedCount} keep the same date and field.</p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-100 px-3 py-1 text-sm font-bold">{preview.rows.length} unplayed</span>
      </div>
      {preview.rows.length ? (
        <ol className="mt-4 max-h-[32rem] divide-y divide-blue-100 overflow-y-auto rounded-xl border border-blue-200 bg-white">
          {preview.rows.map((row) => (
            <li className="grid gap-2 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center" key={row.id}>
              <div>
                <p className="font-bold text-[#10231c]">{row.homeTeamName} vs {row.awayTeamName}</p>
                <p className="mt-1 text-[#627068]">Current · {formatScheduleSlot(row.currentScheduledAt, row.currentFieldName, league.timezone)}</p>
              </div>
              <p className="font-semibold text-blue-950">Proposed · {formatScheduleSlot(row.proposedScheduledAt, row.proposedFieldName, preview.timeZone)}</p>
              <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${row.moved ? "bg-amber-100 text-amber-950" : "bg-[#edf1ee] text-[#526159]"}`}>{row.moved ? "Changes" : "Same slot"}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 rounded-xl border border-blue-200 bg-white px-4 py-5 text-sm">There are no unplayed, unlocked games to rebuild.</p>
      )}
      {preview.preservedCount ? <p className="mt-3 text-xs text-blue-900/70">{preview.preservedCount} final or locked {preview.preservedCount === 1 ? "game keeps" : "games keep"} its published local time.</p> : null}
    </section>
  );
}

function ViewLink({ active, count, hideCount = false, href, label }: { active: boolean; count: number; hideCount?: boolean; href: string; label: string }) {
  return <Link aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942] ${active ? "bg-[#10231c] text-white" : "border border-[#cad7cf] bg-white text-[#526159] hover:border-[#0f5138]"}`} href={href}>{label}{!hideCount ? <span className={`ml-1 ${active ? "text-white/70" : "text-[#627068]"}`}>{count}</span> : null}</Link>;
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  const styles: Record<DisplayStatus, string> = { completed: "bg-emerald-100 text-emerald-900", "in-progress": "bg-[#f4b942] text-[#10231c]", overdue: "bg-red-100 text-red-800", "rained-out": "bg-amber-100 text-amber-900", rescheduled: "bg-blue-100 text-blue-900", scheduled: "bg-[#e9f0eb] text-[#526159]", tbd: "bg-red-100 text-red-800" };
  const labels: Record<DisplayStatus, string> = { completed: "Final", "in-progress": "Playing", overdue: "Score due", "rained-out": "Rainout", rescheduled: "Updated", scheduled: "Ready", tbd: "TBD" };
  return <span className={`w-fit rounded-lg px-2.5 py-1 text-sm font-bold ${styles[status]}`}>{labels[status]}</span>;
}

async function getDashboardLeague(slug: string) {
  return db.league.findUnique({
    where: { slug },
    select: {
      activityEvents: {
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, id: true, summary: true, type: true },
        take: 12,
      },
      archivedAt: true,
      commissionerEmail: true,
      dataRevision: true,
      fieldNames: true,
      gameDays: true,
      gameDurationMinutes: true,
      gameTimes: true,
      gameReports: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: {
          awayScore: true,
          createdAt: true,
          game: {
            select: {
              awayTeam: { select: { name: true } },
              awayTeamId: true,
              fieldName: true,
              homeTeam: { select: { name: true } },
              homeTeamId: true,
              id: true,
              result: { select: { awayScore: true, homeScore: true } },
              scheduledAt: true,
              status: true,
              version: true,
            },
          },
          gameVersion: true,
          homeScore: true,
          id: true,
          note: true,
          proposedFieldName: true,
          proposedScheduledAt: true,
          submittedByEmail: true,
          team: { select: { id: true, name: true } },
          type: true,
        },
      },
      games: {
        select: {
          awayTeam: { select: { id: true, name: true } },
          awayTeamId: true,
          fieldName: true,
          homeTeam: { select: { id: true, name: true } },
          homeTeamId: true,
          id: true,
          locked: true,
          result: { select: { awayScore: true, homeScore: true, updatedAt: true } },
          round: true,
          scheduledAt: true,
          status: true,
          version: true,
        },
      },
      id: true,
      name: true,
      lossPoints: true,
      scheduleStartDate: true,
      seasonLabel: true,
      slug: true,
      sport: true,
      showStandings: true,
      teams: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          managers: {
            orderBy: { createdAt: "asc" },
            select: { acceptedAt: true, email: true, id: true },
          },
          name: true,
        },
      },
      tiePoints: true,
      timezone: true,
      updatedAt: true,
      venueAddress: true,
      venueName: true,
      venueUrl: true,
      winPoints: true,
    },
  });
}

async function getRecentReviewedReports(leagueId: string) {
  return db.gameReport.findMany({
    where: {
      leagueId,
      status: { in: ["APPROVED", "REJECTED"] },
    },
    orderBy: { reviewedAt: "desc" },
    take: 10,
    select: {
      awayScore: true,
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
      reviewedAt: true,
      reviewedByEmail: true,
      status: true,
      team: { select: { name: true } },
      type: true,
    },
  });
}

function getDisplayStatus(game: DashboardGame, durationMinutes: number): DisplayStatus {
  const state = classifyGameState(game, durationMinutes);
  return {
    final: "completed",
    "in-progress": "in-progress",
    "rained-out": "rained-out",
    rescheduled: "rescheduled",
    "result-pending": "overdue",
    scheduled: "scheduled",
    tbd: "tbd",
  }[state] as DisplayStatus;
}

function isReadyForScoreSheet(
  game: DashboardGame,
  timeZone: string,
  now: Date,
): boolean {
  if (game.result || game.locked || game.status === "RAINED_OUT" || !game.scheduledAt) {
    return false;
  }
  return dateInputValue(game.scheduledAt, timeZone) <= dateInputValue(now, timeZone);
}

function groupScoreSheetGames(
  games: DashboardGame[],
  timeZone: string,
): Array<[string, DashboardGame[]]> {
  const groups = new Map<string, DashboardGame[]>();
  for (const game of games) {
    const label = game.scheduledAt
      ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "full",
          timeZone,
        }).format(game.scheduledAt)
      : "Date still to be announced";
    const group = groups.get(label) ?? [];
    group.push(game);
    groups.set(label, group);
  }
  return [...groups.entries()];
}

function sortGames(games: DashboardGame[]): DashboardGame[] {
  return [...games].sort((left, right) => {
    if (left.scheduledAt && right.scheduledAt) return left.scheduledAt.getTime() - right.scheduledAt.getTime();
    if (left.scheduledAt) return -1;
    if (right.scheduledAt) return 1;
    if (left.round !== right.round) return left.round - right.round;
    return left.id.localeCompare(right.id);
  });
}

function normalizeView(view?: string): GameView {
  return view === "all" ||
    view === "attention" ||
    view === "data" ||
    view === "requests" ||
    view === "results" ||
    view === "scores" ||
    view === "settings" ||
    view === "teams"
    ? view
    : "upcoming";
}

function viewTitle(view: GameView): string {
  return {
    all: "Full season",
    attention: "Needs attention",
    data: "Portable data",
    requests: "Manager requests",
    results: "Final scores",
    scores: "Score sheet",
    settings: "League settings",
    teams: "Teams and access",
    upcoming: "Upcoming games",
  }[view];
}

function formatFullDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function parseTextList(value: string | null, fallback: string[]): string[] {
  if (!value) return fallback;
  const values = value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  return values.length ? values : fallback;
}

function parseNumberList(value: string | null, fallback: number[]): number[] {
  if (!value) return fallback;
  const values = value.split(",").map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  return values.length ? values : fallback;
}

function formatShortDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone, weekday: "short" }).format(date);
}

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
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
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit", month: "2-digit", timeZone, year: "numeric" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function displayStoredTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${match[2]} ${suffix}`;
}

function getDevelopmentInviteUrl(value?: string): string | null {
  if (process.env.NODE_ENV === "production" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function getScheduleDraft(
  query: Awaited<DashboardPageProps["searchParams"]>,
): {
  fieldNames: string[];
  gameDays: number[];
  gameDurationMinutes: string;
  gameTimes: string[];
  startDate: string;
  timeZone: string;
} | null {
  if (query.scheduleDraft !== "1") return null;

  const gameDays = (query.draftDays ?? "")
    .slice(0, 40)
    .split(",")
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  return {
    fieldNames: [(query.draftFields ?? "").slice(0, 2_000)],
    gameDays: [...new Set(gameDays)],
    gameDurationMinutes: (query.draftDuration ?? "").slice(0, 20),
    gameTimes: [(query.draftTimes ?? "").slice(0, 500)],
    startDate: (query.draftStartDate ?? "").slice(0, 20),
    timeZone: (query.draftTimezone ?? "").slice(0, 100),
  };
}

function getScheduleRebuildPreview(
  league: DashboardLeague,
  draft: NonNullable<ReturnType<typeof getScheduleDraft>>,
) {
  try {
    const settings = parseScheduleFormFields({
      fieldNames: draft.fieldNames.join("\n"),
      gameDays: draft.gameDays.map(String),
      gameDurationMinutes: draft.gameDurationMinutes,
      gameTimes: draft.gameTimes.join("\n"),
      startDate: draft.startDate,
      timezone: draft.timeZone,
    });
    const plan = buildRebuildSchedulePlan(
      league.games.map((game) => ({
        away: game.awayTeam.name,
        fieldName: game.fieldName,
        hasResult: Boolean(game.result),
        home: game.homeTeam.name,
        id: game.id,
        locked: game.locked,
        round: game.round,
        scheduledAt: game.scheduledAt,
        status: game.status,
        version: game.version,
      })),
      league.timezone,
      settings,
    );
    const gamesById = new Map(league.games.map((game) => [game.id, game]));
    const rows = plan.rebuilt.flatMap((proposed) => {
      const game = gamesById.get(proposed.id);
      return game
        ? [{
            awayTeamName: game.awayTeam.name,
            currentFieldName: game.fieldName,
            currentScheduledAt: game.scheduledAt,
            homeTeamName: game.homeTeam.name,
            id: game.id,
            moved: proposed.moved,
            proposedFieldName: proposed.fieldName,
            proposedScheduledAt: proposed.scheduledAt,
          }]
        : [];
    });

    return {
      changedCount: rows.filter((row) => row.moved).length,
      fingerprint: schedulePreviewFingerprint(league.games, settings),
      preservedCount: plan.preserved.length,
      rows,
      timeZone: settings.timeZone,
      unchangedCount: rows.filter((row) => !row.moved).length,
    };
  } catch (error) {
    console.error("Could not render the schedule rebuild preview.", error);
    return null;
  }
}

function formatScheduleSlot(
  scheduledAt: Date | null,
  fieldName: string | null,
  timeZone: string,
): string {
  const dateAndTime = scheduledAt
    ? `${formatShortDate(scheduledAt, timeZone)} at ${formatTime(scheduledAt, timeZone)}`
    : "Date TBD";
  return `${dateAndTime} · ${fieldName || "Field TBD"}`;
}

function TimeZoneOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {[
        "America/Los_Angeles",
        "America/Denver",
        "America/Phoenix",
        "America/Chicago",
        "America/New_York",
        "America/Anchorage",
        "Pacific/Honolulu",
        "Europe/London",
        "Europe/Paris",
        "Asia/Tokyo",
        "Australia/Sydney",
        "UTC",
      ].map((zone) => <option key={zone} value={zone} />)}
    </datalist>
  );
}
