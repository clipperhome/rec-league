import { useMemo, useState, type FormEvent } from "react";

import { LeagueRaceGraph } from "@/app/components/league-race-graph";
import { getScoreLabels } from "@/lib/sport-labels";
import { buildStandings } from "@/lib/standings";
import {
  addTeam,
  discardPendingOperation,
  generateLocalSchedule,
  markRainout,
  materializePendingOperations,
  removeTeam,
  renameTeam,
  rescheduleGame,
  reviewLocalReport,
  setLeagueArchived,
  setScore,
  submitManagerReport,
  updateLeagueSettings,
  type PortableGameReport,
  type LeagueDocumentV1,
  type PortableGame,
  type PortableOperation,
  type PortableReportType,
  type PortableTeamPacketReport,
} from "@/lib/portable";

import { downloadPortableCsv } from "../file-io";

type Tab = "overview" | "schedule" | "teams" | "settings" | "outbox";

export function Workspace({
  busy,
  dirty,
  document,
  error,
  fileName,
  hasFileHandle,
  historyCount,
  notice,
  onChange,
  onClose,
  onDownload,
  onDownloadFamily,
  onSave,
  onUndo,
}: {
  busy: boolean;
  dirty: boolean;
  document: LeagueDocumentV1;
  error: string | null;
  fileName: string;
  hasFileHandle: boolean;
  historyCount: number;
  notice: string | null;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  onClose(): void;
  onDownload(): void;
  onDownloadFamily(): void;
  onSave(): void;
  onUndo(): void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const view = useMemo(() => materializePendingOperations(document), [document]);
  const pendingCount = document.sync?.pendingOperations.length ?? 0;
  const teamById = new Map(view.teams.map((team) => [team.id, team.name]));
  const isOrganizer = document.export.scope === "organizer-backup";
  const isManager = document.export.scope === "team-manager-packet";
  const isLocal = document.sync?.mode === "local-only";
  const readOnly = !isOrganizer && !isManager;

  return (
    <div className="min-h-screen pb-24 text-[#10231c]">
      <header className="no-print sticky top-0 z-30 border-b border-[#d9e2dc] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            aria-label="Close league file"
            className="flex min-h-11 items-center gap-3 rounded-lg text-left"
            onClick={onClose}
            type="button"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-[#0f5138] text-sm font-black text-white">
              RL
            </span>
            <span className="hidden sm:block">
              <strong className="block leading-5">{view.league.name}</strong>
              <span className="block max-w-56 truncate text-xs text-[#627068]">
                {fileName}
              </span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <button
              className="hidden min-h-11 rounded-lg px-3 text-sm font-bold text-[#526159] hover:bg-[#f3f6f2] disabled:opacity-40 sm:block"
              disabled={!historyCount}
              onClick={onUndo}
              type="button"
            >
              Undo
            </button>
            <button
              className="hidden min-h-11 rounded-lg border border-[#bdcbc2] px-3 text-sm font-bold text-[#0f5138] hover:border-[#0f5138] sm:block"
              onClick={onDownload}
              type="button"
            >
              Download copy
            </button>
            {isOrganizer ? (
              <button
                className="hidden min-h-11 rounded-lg border border-[#bdcbc2] px-3 text-sm font-bold text-[#0f5138] hover:border-[#0f5138] lg:block"
                onClick={onDownloadFamily}
                type="button"
              >
                Family webpage
              </button>
            ) : null}
            <button
              className="min-h-11 rounded-lg bg-[#0f5138] px-4 text-sm font-black text-white hover:bg-[#0a3828] disabled:opacity-50"
              disabled={busy}
              onClick={onSave}
              type="button"
            >
              {busy
                ? "Saving…"
                : hasFileHandle
                  ? dirty
                    ? "Save file"
                    : "Saved"
                  : "Download JSON"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-9">
        <section className="flex flex-col gap-5 border-b border-[#cad7cf] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <ModeBadge document={document} />
              {dirty ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-950">
                  Unsaved file changes
                </span>
              ) : null}
              {pendingCount ? (
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-950">
                  {pendingCount} pending online
                </span>
              ) : null}
            </div>
            <h1 className="mt-3 break-words text-4xl font-black tracking-[-0.04em] sm:text-5xl">
              {view.league.name}
            </h1>
            <p className="mt-2 text-[#627068]">
              {[view.league.sport, view.league.seasonLabel]
                .filter(Boolean)
                .join(" · ") || "Portable league workspace"}
            </p>
          </div>
          <div className="rounded-xl border border-[#d9e2dc] bg-white px-4 py-3 text-sm text-[#526159] lg:max-w-sm">
            {isLocal ? (
              <>
                <strong className="text-[#10231c]">This JSON is official.</strong>{" "}
                Save or download it after changes. Browser recovery is only a safety net.
              </>
            ) : isManager ? (
              <>
                <strong className="text-[#10231c]">Reports are pending.</strong>{" "}
                Upload this packet from the authenticated team desk to submit them.
              </>
            ) : isOrganizer ? (
              <>
                <strong className="text-[#10231c]">Online remains official.</strong>{" "}
                Upload this file from Portable data to reconcile its outbox.
              </>
            ) : (
              <strong>This export is read-only.</strong>
            )}
          </div>
        </section>

        {error ? (
          <p
            className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
            {notice}
          </p>
        ) : null}
        {view.league.archivedAt ? (
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <span>
              <strong>Season archived.</strong> Schedule and history stay readable.
            </span>
            {isOrganizer ? (
              <button
                className="min-h-11 rounded-lg bg-amber-950 px-3 font-bold text-white"
                onClick={() => onChange((source) => setLeagueArchived(source, false))}
                type="button"
              >
                Reopen season
              </button>
            ) : null}
          </div>
        ) : null}

        <nav
          aria-label="League workspace"
          className="no-print mt-7 grid grid-cols-3 gap-1 rounded-xl border border-[#cad7cf] bg-white p-1 sm:flex sm:overflow-x-auto"
        >
          {(
            [
              ["overview", "Overview"],
              ["schedule", "Schedule"],
              ["teams", "Teams"],
              ["settings", "Settings"],
              ["outbox", `Outbox ${pendingCount}`],
            ] as Array<[Tab, string]>
          ).map(([value, label]) => (
            <button
              className={`min-h-11 min-w-0 rounded-lg px-2 text-sm font-black sm:shrink-0 sm:px-4 ${tab === value ? "bg-[#10231c] text-white" : "text-[#526159] hover:bg-[#f3f6f2]"}`}
              key={value}
              onClick={() => setTab(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="mt-7">
          {tab === "overview" ? (
            <Overview
              document={document}
              onChange={onChange}
              teamById={teamById}
              view={view}
            />
          ) : null}
          {tab === "schedule" ? (
            <SchedulePanel
              document={document}
              onChange={onChange}
              readOnly={readOnly}
              teamById={teamById}
              view={view}
            />
          ) : null}
          {tab === "teams" ? (
            <TeamsPanel
              document={document}
              onChange={onChange}
              readOnly={!isOrganizer}
              view={view}
            />
          ) : null}
          {tab === "settings" ? (
            <SettingsPanel
              document={document}
              onChange={onChange}
              readOnly={!isOrganizer}
              view={view}
            />
          ) : null}
          {tab === "outbox" ? (
            <OutboxPanel document={document} onChange={onChange} />
          ) : null}
        </div>
      </main>

      <div className={`no-print fixed inset-x-0 bottom-0 z-20 grid ${isOrganizer ? "grid-cols-4" : "grid-cols-3"} border-t border-[#cad7cf] bg-white/95 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(16,35,28,.08)] backdrop-blur sm:hidden`}>
        <button
          className="min-h-12 rounded-lg text-xs font-black text-[#0f5138] disabled:opacity-40"
          disabled={!historyCount}
          onClick={onUndo}
          type="button"
        >
          Undo
        </button>
        <button
          className="min-h-12 rounded-lg text-xs font-black text-[#0f5138]"
          onClick={onDownload}
          type="button"
        >
          Download copy
        </button>
        {isOrganizer ? (
          <button
            className="min-h-12 rounded-lg text-xs font-black text-[#0f5138]"
            onClick={onDownloadFamily}
            type="button"
          >
            Family page
          </button>
        ) : null}
        <button
          className="min-h-12 rounded-lg text-xs font-black text-[#0f5138]"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Overview({
  document,
  onChange,
  teamById,
  view,
}: {
  document: LeagueDocumentV1;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  teamById: Map<string, string>;
  view: LeagueDocumentV1;
}) {
  const [now] = useState(() => Date.now());
  const upcoming = sortedGames(view.games).find(
    (game) => game.scheduled && Date.parse(game.scheduled.utc) >= now && game.status !== "RAINED_OUT",
  );
  const standings = standingsFor(view);
  const scoreLabels = getScoreLabels(view.league.sport);
  const pendingReports =
    document.export.scope === "organizer-backup" &&
    document.sync?.mode === "local-only"
      ? document.privateData?.reports.filter((report) => report.status === "PENDING") ?? []
      : [];

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(19rem,.7fr)]">
      <div className="space-y-7">
        <section className="overflow-hidden rounded-3xl bg-[#10231c] text-white shadow-[0_20px_55px_rgba(16,35,28,.16)]">
          <div className="border-b border-white/10 px-5 py-4 sm:px-7">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[#8fd1ad]">
              {upcoming ? "Next game" : "Season desk"}
            </p>
          </div>
          <div className="p-5 sm:p-7">
            <h2 className="break-words text-2xl font-black tracking-tight sm:text-3xl">
              {upcoming
                ? `${teamById.get(upcoming.homeTeamId)} vs ${teamById.get(upcoming.awayTeamId)}`
                : view.games.length
                  ? "No future games on the calendar"
                  : "Build the first schedule"}
            </h2>
            <p className="mt-3 text-white/70">
              {upcoming?.scheduled
                ? `${formatDateTime(upcoming.scheduled.utc, view.league.timeZone)}${upcoming.fieldName ? ` · ${upcoming.fieldName}` : ""}`
                : view.games.length
                  ? "Results and completed games remain below."
                  : "Set the game rhythm in Settings, then generate a round robin."}
            </p>
          </div>
        </section>

        {pendingReports.length ? (
          <section>
            <SectionHeading
              eyebrow="Local-only workflow"
              title={`${pendingReports.length} manager ${pendingReports.length === 1 ? "report" : "reports"} to review`}
            />
            <div className="mt-4 space-y-3">
              {pendingReports.map((report) => {
                const game = view.games.find((candidate) => candidate.id === report.gameId);
                return (
                  <article
                    className="rounded-2xl border border-[#cad7cf] bg-white p-4 sm:p-5"
                    key={report.id}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-words font-black">
                          {report.type === "SCORE" ? "Score" : report.type === "RAINOUT" ? "Rainout" : "Reschedule"} report · {teamById.get(report.teamId)}
                        </p>
                        {game ? (
                          <p className="mt-1 break-words text-sm font-semibold">
                            {teamById.get(game.homeTeamId)} vs {teamById.get(game.awayTeamId)}
                          </p>
                        ) : null}
                        <p className="mt-2 break-words text-sm text-[#405149]">
                          <strong>Requested:</strong>{" "}
                          {describePortableReport(report, view, teamById)}
                        </p>
                        <p className="mt-1 break-words text-sm text-[#627068]">
                          {report.note ? `Note: ${report.note}` : "No note included."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="min-h-11 rounded-lg border border-[#bdcbc2] px-3 text-sm font-bold text-[#526159]"
                          onClick={() =>
                            onChange((source) =>
                              reviewLocalReport(source, report.id, "REJECT", null),
                            )
                          }
                          type="button"
                        >
                          Decline
                        </button>
                        <button
                          className="min-h-11 rounded-lg bg-[#0f5138] px-3 text-sm font-bold text-white"
                          onClick={() =>
                            onChange((source) =>
                              reviewLocalReport(source, report.id, "APPROVE", null),
                            )
                          }
                          type="button"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <section>
          <SectionHeading eyebrow="League pulse" title="At a glance" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Teams" value={view.teams.length} />
            <Metric label="Games" value={view.games.length} />
            <Metric label="Finals" value={view.results.length} />
            <Metric
              label="Pending"
              value={document.sync?.pendingOperations.length ?? 0}
            />
          </div>
        </section>
      </div>

      <aside>
        <section className="rounded-2xl border border-[#cad7cf] bg-white p-5">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-[#0f6a48]">
            League race
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Standings</h2>
          <p className="mt-1 text-sm text-[#627068]">
            {view.league.scoring.winPoints} win · {view.league.scoring.tiePoints} tie · {view.league.scoring.lossPoints} loss
          </p>
          {view.league.scoring.showStandings && view.results.length ? (
            <div className="mt-3">
              <LeagueRaceGraph
                differentialLabel={scoreLabels.scoreDiff}
                standings={standings}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[#627068]">
              Standings appear after official final scores.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

function SchedulePanel({
  document,
  onChange,
  readOnly,
  teamById,
  view,
}: {
  document: LeagueDocumentV1;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  readOnly: boolean;
  teamById: Map<string, string>;
  view: LeagueDocumentV1;
}) {
  const isManager = document.export.scope === "team-manager-packet";
  return (
    <section>
      <SectionHeading
        eyebrow={isManager ? "Team packet" : "Game operations"}
        title={isManager ? "Team schedule and reports" : "Schedule and results"}
      />
      {!view.games.length ? (
        <EmptyState>
          No games yet. A local organizer can set the game rhythm in Settings and
          generate a schedule.
        </EmptyState>
      ) : (
        <div className="mt-5 space-y-3">
          {sortedGames(view.games).map((game) => (
            <GameCard
              document={document}
              game={game}
              isManager={isManager}
              key={game.id}
              onChange={onChange}
              readOnly={readOnly}
              result={view.results.find((candidate) => candidate.gameId === game.id)}
              teamById={teamById}
            />
          ))}
        </div>
      )}
      {isManager ? (
        <ManagerReportHistory
          reports={document.teamPacket?.reports ?? []}
          teamById={teamById}
          view={view}
        />
      ) : null}
    </section>
  );
}

function ManagerReportHistory({
  reports,
  teamById,
  view,
}: {
  reports: PortableTeamPacketReport[];
  teamById: Map<string, string>;
  view: LeagueDocumentV1;
}) {
  const ordered = [...reports].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );

  return (
    <section className="mt-8">
      <SectionHeading eyebrow="Your reports" title="Organizer review status" />
      {!ordered.length ? (
        <EmptyState>No submitted reports are included in this team packet yet.</EmptyState>
      ) : (
        <ol className="mt-4 space-y-3">
          {ordered.map((report) => {
            const game = view.games.find((candidate) => candidate.id === report.gameId);
            return (
              <li
                className="rounded-2xl border border-[#cad7cf] bg-white p-4 sm:p-5"
                key={report.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${reportStatusClass(report.status)}`}>
                    {report.status === "PENDING"
                      ? "Pending"
                      : report.status === "APPROVED"
                        ? "Approved"
                        : "Declined"}
                  </span>
                  <span className="text-sm font-bold text-[#0f6a48]">
                    {report.type === "SCORE"
                      ? "Score report"
                      : report.type === "RAINOUT"
                        ? "Rainout report"
                        : "Reschedule report"}
                  </span>
                </div>
                {game ? (
                  <p className="mt-3 break-words font-black">
                    {teamById.get(game.homeTeamId)} vs {teamById.get(game.awayTeamId)}
                  </p>
                ) : null}
                <p className="mt-2 break-words text-sm text-[#405149]">
                  <strong>Submitted:</strong>{" "}
                  {describePortableReport(report, view, teamById)}
                </p>
                {report.note ? (
                  <p className="mt-2 break-words rounded-lg bg-[#f3f6f2] px-3 py-2 text-sm leading-6">
                    Note: {report.note}
                  </p>
                ) : null}
                {report.decisionNote ? (
                  <p className="mt-2 break-words text-sm text-[#627068]">
                    Organizer note: {report.decisionNote}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-[#627068]">
                  Updated {formatDateTime(report.updatedAt, view.league.timeZone)}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function GameCard({
  document,
  game,
  isManager,
  onChange,
  readOnly,
  result,
  teamById,
}: {
  document: LeagueDocumentV1;
  game: PortableGame;
  isManager: boolean;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  readOnly: boolean;
  result: LeagueDocumentV1["results"][number] | undefined;
  teamById: Map<string, string>;
}) {
  const pending = document.sync?.pendingOperations.find(
    (operation) => operationTarget(operation) === `game:${game.id}`,
  );
  return (
    <article className="rounded-2xl border border-[#cad7cf] bg-white p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="font-black">
            {game.scheduled
              ? formatShortDate(game.scheduled.utc, document.league.timeZone)
              : `Round ${game.round}`}
          </p>
          <p className="mt-0.5 text-sm text-[#627068]">
            {game.scheduled
              ? formatTime(game.scheduled.utc, document.league.timeZone)
              : "Time TBD"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="break-words font-bold">
            {teamById.get(game.homeTeamId)}{" "}
            <span className="px-1 font-normal text-[#829087]">vs</span>{" "}
            {teamById.get(game.awayTeamId)}
          </p>
          <p className="mt-1 text-sm text-[#627068]">
            {game.fieldName || "Field TBD"} · Round {game.round}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          {result ? (
            <span className="text-xl font-black tabular-nums">
              {result.homeScore}–{result.awayScore}
            </span>
          ) : (
            <StatusBadge status={game.status} />
          )}
          {pending ? (
            <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-black text-blue-950">
              Pending
            </span>
          ) : null}
        </div>
      </div>

      {!readOnly && !document.league.archivedAt && !game.locked ? (
        <details className="no-print mt-4 border-t border-[#edf1ee] pt-4">
          <summary className="min-h-11 cursor-pointer list-none rounded-lg bg-[#f3f6f2] px-3 py-3 text-sm font-black text-[#0f5138]">
            {pending
              ? "A change for this game is waiting"
              : isManager
                ? "Prepare a report"
                : "Update this game"}
          </summary>
          {pending ? (
            <p className="px-2 pt-3 text-sm leading-6 text-[#627068]">
              Undo or discard the pending operation before making another change
              to this game.
            </p>
          ) : isManager ? (
            <ManagerReportForms game={game} onChange={onChange} teamById={teamById} />
          ) : (
            <OrganizerGameForms
              game={game}
              onChange={onChange}
              result={result}
              teamById={teamById}
            />
          )}
        </details>
      ) : null}
    </article>
  );
}

function OrganizerGameForms({
  game,
  onChange,
  result,
  teamById,
}: {
  game: PortableGame;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  result: LeagueDocumentV1["results"][number] | undefined;
  teamById: Map<string, string>;
}) {
  function score(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onChange((source) =>
      setScore(
        source,
        game.id,
        Number(form.get("homeScore")),
        Number(form.get("awayScore")),
      ),
    );
  }
  function reschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onChange((source) =>
      rescheduleGame(
        source,
        game.id,
        String(form.get("date") ?? ""),
        String(form.get("time") ?? ""),
        String(form.get("field") ?? ""),
      ),
    );
  }
  return (
    <div className="grid gap-4 pt-4 lg:grid-cols-3">
      <form className="rounded-xl border border-[#d9e2dc] p-3" onSubmit={score}>
        <p className="text-sm font-black">Official score</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ScoreInput
            defaultValue={result?.homeScore}
            label={teamById.get(game.homeTeamId) ?? "Home"}
            name="homeScore"
          />
          <ScoreInput
            defaultValue={result?.awayScore}
            label={teamById.get(game.awayTeamId) ?? "Away"}
            name="awayScore"
          />
        </div>
        <button className={smallPrimary} type="submit">
          {result ? "Correct score" : "Record final"}
        </button>
      </form>

      <form className="rounded-xl border border-[#d9e2dc] p-3" onSubmit={reschedule}>
        <p className="text-sm font-black">New date or field</p>
        <div className="mt-3 grid gap-2 min-[360px]:grid-cols-2">
          <input
            className={smallInput}
            defaultValue={game.scheduled?.localDate}
            name="date"
            required
            type="date"
          />
          <input
            className={smallInput}
            defaultValue={game.scheduled?.localTime}
            name="time"
            required
            type="time"
          />
        </div>
        <input
          className={`mt-2 ${smallInput}`}
          defaultValue={game.fieldName ?? ""}
          name="field"
          placeholder="Field or court"
        />
        <button className={smallSecondary} type="submit">
          Save new slot
        </button>
      </form>

      <div className="rounded-xl border border-[#d9e2dc] p-3">
        <p className="text-sm font-black">Rainout</p>
        <p className="mt-2 text-xs leading-5 text-[#627068]">
          Removes any score and frees this time slot until the game is rescheduled.
        </p>
        <button
          className="mt-3 min-h-11 w-full rounded-lg border border-amber-400 bg-amber-50 px-3 text-sm font-black text-amber-950"
          onClick={() => onChange((source) => markRainout(source, game.id))}
          type="button"
        >
          Mark rained out
        </button>
      </div>
    </div>
  );
}

function ManagerReportForms({
  game,
  onChange,
  teamById,
}: {
  game: PortableGame;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  teamById: Map<string, string>;
}) {
  function submit(type: PortableReportType, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onChange((source) =>
      submitManagerReport(source, {
        awayScore:
          type === "SCORE" ? Number(form.get("awayScore")) : null,
        gameId: game.id,
        homeScore:
          type === "SCORE" ? Number(form.get("homeScore")) : null,
        note: String(form.get("note") ?? ""),
        proposedFieldName: String(form.get("field") ?? ""),
        proposedLocalDate: String(form.get("date") ?? ""),
        proposedLocalTime: String(form.get("time") ?? ""),
        reportType: type,
      }),
    );
  }
  return (
    <div className="grid gap-4 pt-4 lg:grid-cols-3">
      <form
        className="rounded-xl border border-[#d9e2dc] p-3"
        onSubmit={(event) => submit("SCORE", event)}
      >
        <p className="text-sm font-black">Report score</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ScoreInput label={teamById.get(game.homeTeamId) ?? "Home"} name="homeScore" />
          <ScoreInput label={teamById.get(game.awayTeamId) ?? "Away"} name="awayScore" />
        </div>
        <NoteInput />
        <button className={smallPrimary} type="submit">Add to outbox</button>
      </form>
      <form
        className="rounded-xl border border-[#d9e2dc] p-3"
        onSubmit={(event) => submit("RESCHEDULE", event)}
      >
        <p className="text-sm font-black">Propose new time</p>
        <div className="mt-3 grid gap-2 min-[360px]:grid-cols-2">
          <input className={smallInput} name="date" required type="date" />
          <input className={smallInput} name="time" required type="time" />
        </div>
        <input className={`mt-2 ${smallInput}`} name="field" placeholder="Field" />
        <NoteInput />
        <button className={smallSecondary} type="submit">Add to outbox</button>
      </form>
      <form
        className="rounded-xl border border-[#d9e2dc] p-3"
        onSubmit={(event) => submit("RAINOUT", event)}
      >
        <p className="text-sm font-black">Report rainout</p>
        <p className="mt-2 text-xs leading-5 text-[#627068]">
          The organizer decides whether the official schedule changes.
        </p>
        <NoteInput />
        <button className="mt-3 min-h-11 w-full rounded-lg border border-amber-400 bg-amber-50 px-3 text-sm font-black text-amber-950" type="submit">
          Add to outbox
        </button>
      </form>
    </div>
  );
}

function TeamsPanel({
  document,
  onChange,
  readOnly,
  view,
}: {
  document: LeagueDocumentV1;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  readOnly: boolean;
  view: LeagueDocumentV1;
}) {
  const local = document.sync?.mode === "local-only";
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onChange((source) => addTeam(source, String(form.get("name") ?? "")));
    event.currentTarget.reset();
  }
  return (
    <section>
      <SectionHeading eyebrow="Roster" title={`${view.teams.length} teams`} />
      {readOnly ? (
        <p className="mt-3 text-sm text-[#627068]">This file’s roster is read-only.</p>
      ) : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {view.teams.map((team) => {
          const pending = document.sync?.pendingOperations.some(
            (operation) => operationTarget(operation) === `team:${team.id}`,
          );
          return (
            <form
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-[#cad7cf] bg-white p-3"
              key={team.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                onChange((source) =>
                  renameTeam(source, team.id, String(form.get("name") ?? "")),
                );
              }}
            >
              <input
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#bdcbc2] px-3 font-bold disabled:border-transparent disabled:bg-transparent"
                defaultValue={team.name}
                disabled={readOnly || Boolean(pending) || Boolean(document.league.archivedAt)}
                key={team.name}
                name="name"
              />
              {!readOnly ? (
                <button
                  className="min-h-11 rounded-lg border border-[#bdcbc2] px-3 text-sm font-black text-[#0f5138] disabled:opacity-40"
                  disabled={Boolean(pending) || Boolean(document.league.archivedAt)}
                  type="submit"
                >
                  Rename
                </button>
              ) : null}
              {local && !document.games.length ? (
                <button
                  aria-label={`Remove ${team.name}`}
                  className="col-span-2 min-h-11 justify-self-end rounded-lg px-3 text-sm font-black text-red-700"
                  onClick={() => onChange((source) => removeTeam(source, team.id))}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
            </form>
          );
        })}
      </div>
      {local && !document.league.archivedAt ? (
        <form
          className="mt-5 flex min-w-0 max-w-xl gap-2 rounded-2xl border border-dashed border-[#9eafa3] bg-white p-3"
          onSubmit={add}
        >
          <input
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#bdcbc2] px-3"
            name="name"
            placeholder="New team name"
            required
          />
          <button className="min-h-11 rounded-lg bg-[#0f5138] px-4 text-sm font-black text-white" type="submit">
            Add team
          </button>
        </form>
      ) : null}
      {!local && !readOnly ? (
        <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
          Connected roster additions and removals stay online because they require a
          schedule-rebuild preview. Renames can be queued here.
        </p>
      ) : null}
    </section>
  );
}

function SettingsPanel({
  document,
  onChange,
  readOnly,
  view,
}: {
  document: LeagueDocumentV1;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
  readOnly: boolean;
  view: LeagueDocumentV1;
}) {
  const local = document.sync?.mode === "local-only";
  const schedule = view.league.schedule;
  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes = {
      name: String(form.get("name") ?? ""),
      scoring: {
        lossPoints: Number(form.get("lossPoints")),
        showStandings: form.get("showStandings") === "on",
        tiePoints: Number(form.get("tiePoints")),
        winPoints: Number(form.get("winPoints")),
      },
      seasonLabel: nullableForm(form, "seasonLabel"),
      sport: nullableForm(form, "sport"),
      venue: {
        address: nullableForm(form, "venueAddress"),
        name: nullableForm(form, "venueName"),
        url: nullableForm(form, "venueUrl"),
      },
      ...(local
        ? {
            schedule: {
              durationMinutes: Number(form.get("durationMinutes")),
              fields: lines(form, "fields"),
              startDate: nullableForm(form, "startDate"),
              startTimes: lines(form, "startTimes"),
              weekdays: form
                .getAll("weekdays")
                .map(Number)
                .sort((left, right) => left - right),
            },
            timeZone: String(form.get("timeZone") ?? ""),
          }
        : {}),
    };
    onChange((source) => updateLeagueSettings(source, changes));
  }
  return (
    <section>
      <SectionHeading eyebrow="League configuration" title="Settings and game rhythm" />
      {readOnly ? (
        <EmptyState>This export does not include an organizer write path.</EmptyState>
      ) : (
        <form className="mt-5 space-y-6" onSubmit={saveSettings}>
          <div className="grid gap-4 rounded-2xl border border-[#cad7cf] bg-white p-5 sm:grid-cols-2">
            <TextField defaultValue={view.league.name} label="League name" name="name" required />
            <TextField defaultValue={view.league.seasonLabel ?? ""} label="Season" name="seasonLabel" />
            <TextField defaultValue={view.league.sport ?? ""} label="Sport" name="sport" />
            {local ? (
              <TextField defaultValue={view.league.timeZone} label="IANA time zone" name="timeZone" required />
            ) : null}
          </div>

          {local ? (
            <div className="rounded-2xl border border-[#cad7cf] bg-white p-5">
              <p className="font-black">Schedule rhythm</p>
              <p className="mt-1 text-sm leading-6 text-[#627068]">
                Saving this section does not replace games. Generate explicitly below.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <TextField defaultValue={schedule.startDate ?? ""} label="Start date" name="startDate" required type="date" />
                <TextField defaultValue={String(schedule.durationMinutes)} label="Minutes per game" name="durationMinutes" required type="number" />
                <label className="block text-sm font-bold sm:col-span-2">
                  <span>Start times, one per line</span>
                  <textarea className={textareaClass} defaultValue={schedule.startTimes.join("\n")} name="startTimes" required />
                </label>
                <label className="block text-sm font-bold sm:col-span-2">
                  <span>Fields or courts, one per line (optional)</span>
                  <textarea className={textareaClass} defaultValue={schedule.fields.join("\n")} name="fields" />
                </label>
                <fieldset className="sm:col-span-2">
                  <legend className="text-sm font-bold">Play days</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => (
                      <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[#bdcbc2] px-3 text-sm font-semibold" key={label}>
                        <input defaultChecked={schedule.weekdays.includes(day)} name="weekdays" type="checkbox" value={day} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
              Connected time zone and game rhythm changes stay online because they
              require a full schedule preview.
            </p>
          )}

          <div className="grid gap-4 rounded-2xl border border-[#cad7cf] bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
            <TextField defaultValue={view.league.venue.name ?? ""} label="Venue name" name="venueName" />
            <TextField defaultValue={view.league.venue.address ?? ""} label="Venue address" name="venueAddress" />
            <TextField defaultValue={view.league.venue.url ?? ""} label="Venue link" name="venueUrl" type="url" />
            <TextField defaultValue={String(view.league.scoring.winPoints)} label="Win points" name="winPoints" required type="number" />
            <TextField defaultValue={String(view.league.scoring.tiePoints)} label="Tie points" name="tiePoints" required type="number" />
            <TextField defaultValue={String(view.league.scoring.lossPoints)} label="Loss points" name="lossPoints" required type="number" />
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
              <input defaultChecked={view.league.scoring.showStandings} name="showStandings" type="checkbox" />
              Show standings
            </label>
          </div>

          <button
            className="min-h-12 rounded-xl bg-[#0f5138] px-5 py-3 font-black text-white hover:bg-[#0a3828] disabled:opacity-40"
            disabled={Boolean(document.league.archivedAt)}
            type="submit"
          >
            {local ? "Save settings to file" : "Add settings change to outbox"}
          </button>
        </form>
      )}

      {local && !readOnly ? (
        <section className="mt-8 rounded-2xl border border-[#cad7cf] bg-white p-5">
          <p className="font-black">CSV analysis copies</p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#627068]">
            Open these UTF-8 tables in Excel or Google Sheets. They exclude manager
            emails, report notes, and activity history, and are not backups or
            importable app data.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["teams", "games", "results", "standings"] as const).map((table) => (
              <button
                className="min-h-11 rounded-lg border border-[#0f5138] px-3 py-2 text-sm font-bold capitalize text-[#0f5138] hover:bg-[#e9f0eb]"
                key={table}
                onClick={() => downloadPortableCsv(view, table)}
                type="button"
              >
                {table} CSV
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {local && !readOnly ? (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#cad7cf] bg-white p-5">
            <p className="font-black">Generate round robin</p>
            <p className="mt-1 text-sm leading-6 text-[#627068]">
              Replacing the schedule clears current games, results, and pending reports.
            </p>
            <label className="mt-4 block text-sm font-bold">
              <span>Round-robin cycles</span>
              <input className={`mt-1.5 ${inputClass}`} defaultValue="1" id="schedule-cycles" max="10" min="1" type="number" />
            </label>
            <button
              className="mt-4 min-h-11 rounded-lg bg-[#10231c] px-4 text-sm font-black text-white disabled:opacity-40"
              disabled={Boolean(document.league.archivedAt)}
              onClick={() => {
                const cycles = Number(
                  (window.document.getElementById("schedule-cycles") as HTMLInputElement | null)?.value ?? 1,
                );
                if (
                  document.games.length &&
                  !window.confirm("Replace every game and clear results in this local file?")
                ) {
                  return;
                }
                onChange((source) => generateLocalSchedule(source, cycles));
              }}
              type="button"
            >
              {document.games.length ? "Replace schedule" : "Generate schedule"}
            </button>
          </section>
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
            <p className="font-black">Season lifecycle</p>
            <p className="mt-1 text-sm leading-6">
              Archiving makes the file read-only until it is explicitly reopened.
            </p>
            <button
              className="mt-4 min-h-11 rounded-lg bg-amber-950 px-4 text-sm font-black text-white"
              onClick={() =>
                onChange((source) =>
                  setLeagueArchived(source, !Boolean(source.league.archivedAt)),
                )
              }
              type="button"
            >
              {document.league.archivedAt ? "Reopen season" : "Archive season"}
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function OutboxPanel({
  document,
  onChange,
}: {
  document: LeagueDocumentV1;
  onChange(change: (document: LeagueDocumentV1) => LeagueDocumentV1): void;
}) {
  const operations = document.sync?.pendingOperations ?? [];
  return (
    <section>
      <SectionHeading eyebrow="Connected reconciliation" title="Pending operation outbox" />
      {document.sync?.mode === "local-only" ? (
        <EmptyState>
          Local-only files apply changes directly, so they do not need an online outbox.
        </EmptyState>
      ) : !operations.length ? (
        <EmptyState>No offline changes are waiting. This file matches its last downloaded snapshot.</EmptyState>
      ) : (
        <>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#627068]">
            Save this JSON, then upload it from the authenticated {document.export.scope === "team-manager-packet" ? "team desk" : "organizer Portable data page"}. The server checks every record version and preserves conflicts.
          </p>
          <ol className="mt-5 divide-y divide-[#e1e8e3] overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
            {operations.map((operation) => (
              <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between" key={operation.operationId}>
                <div>
                  <p className="font-black">{operationLabel(operation.kind)}</p>
                  <p className="mt-1 text-sm text-[#627068]">
                    Prepared {formatDateTime(operation.createdAt, document.league.timeZone)} · base revision {operation.baseRevision}
                  </p>
                  <p className="mt-1 break-all font-mono text-xs text-[#829087]">{operation.operationId}</p>
                </div>
                <button
                  className="min-h-11 rounded-lg border border-red-200 px-3 text-sm font-bold text-red-700"
                  onClick={() =>
                    onChange((source) =>
                      discardPendingOperation(source, operation.operationId),
                    )
                  }
                  type="button"
                >
                  Discard pending change
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function ModeBadge({ document }: { document: LeagueDocumentV1 }) {
  const label =
    document.export.scope === "team-manager-packet"
      ? "Team manager packet"
      : document.sync?.mode === "local-only"
        ? "Local-only official file"
        : document.export.scope === "organizer-backup"
          ? "Connected organizer workfile"
          : "Read-only export";
  return (
    <span className="rounded-full bg-[#e9f0eb] px-2.5 py-1 text-xs font-black text-[#0f5138]">
      {label}
    </span>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-sm font-black uppercase tracking-[0.14em] text-[#0f6a48]">
        {eyebrow}
      </p>
      <h2 className="mt-1 break-words text-2xl font-black tracking-tight sm:text-3xl">{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#cad7cf] bg-white p-4">
      <p className="text-sm text-[#627068]">{label}</p>
      <p className="mt-1 text-3xl font-black tabular-nums">{value}</p>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 rounded-2xl border border-dashed border-[#9eafa3] bg-white px-5 py-9 text-center text-sm leading-6 text-[#627068]">
      {children}
    </p>
  );
}

function TextField({
  defaultValue,
  label,
  name,
  required,
  type = "text",
}: {
  defaultValue: string;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block text-sm font-bold">
      <span>{label}</span>
      <input className={`mt-1.5 ${inputClass}`} defaultValue={defaultValue} name={name} required={required} type={type} />
    </label>
  );
}

function ScoreInput({
  defaultValue,
  label,
  name,
}: {
  defaultValue?: number;
  label: string;
  name: string;
}) {
  return (
    <label className="block min-w-0 text-xs font-bold">
      <span className="block truncate">{label}</span>
      <input className={`mt-1 ${smallInput}`} defaultValue={defaultValue} inputMode="numeric" max="999" min="0" name={name} required type="number" />
    </label>
  );
}

function NoteInput() {
  return <input className={`mt-2 ${smallInput}`} maxLength={2000} name="note" placeholder="Note (optional)" />;
}

function StatusBadge({ status }: { status: PortableGame["status"] }) {
  const labels = {
    COMPLETED: "Final",
    RAINED_OUT: "Rained out",
    RESCHEDULED: "Updated",
    SCHEDULED: "Scheduled",
  };
  return (
    <span className="rounded-full bg-[#e9f0eb] px-2.5 py-1 text-xs font-black text-[#405149]">
      {labels[status]}
    </span>
  );
}

function standingsFor(document: LeagueDocumentV1) {
  const resultByGame = new Map(
    document.results.map((result) => [result.gameId, result]),
  );
  return buildStandings(
    document.teams,
    document.games.map((game) => ({
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      result: resultByGame.get(game.id) ?? null,
      status: game.status,
    })),
    document.league.scoring,
  );
}

function sortedGames(games: PortableGame[]): PortableGame[] {
  return [...games].sort((left, right) => {
    if (left.scheduled && right.scheduled) {
      return Date.parse(left.scheduled.utc) - Date.parse(right.scheduled.utc);
    }
    if (left.scheduled) return -1;
    if (right.scheduled) return 1;
    return left.round - right.round;
  });
}

function describePortableReport(
  report: PortableGameReport | PortableTeamPacketReport,
  document: LeagueDocumentV1,
  teamById: Map<string, string>,
): string {
  const game = document.games.find((candidate) => candidate.id === report.gameId);
  if (report.type === "RAINOUT") return "Mark this game as rained out.";
  if (report.type === "SCORE") {
    if (!game || report.homeScore === null || report.awayScore === null) {
      return "Publish the submitted final score.";
    }
    return `${teamById.get(game.homeTeamId) ?? "Home"} ${report.homeScore}–${report.awayScore} ${teamById.get(game.awayTeamId) ?? "Away"}.`;
  }
  if (!report.proposedScheduled) return "Move this game to a new date and time.";
  return `${formatDateTime(report.proposedScheduled.utc, document.league.timeZone)}${report.proposedFieldName ? ` · ${report.proposedFieldName}` : ""}.`;
}

function reportStatusClass(status: PortableTeamPacketReport["status"]): string {
  if (status === "APPROVED") return "bg-emerald-100 text-emerald-950";
  if (status === "REJECTED") return "bg-red-100 text-red-900";
  return "bg-amber-100 text-amber-950";
}

function operationTarget(operation: PortableOperation): string {
  switch (operation.kind) {
    case "SET_SCORE":
    case "MARK_RAINOUT":
    case "RESCHEDULE_GAME":
    case "SUBMIT_REPORT":
      return `game:${operation.payload.gameId}`;
    case "ADD_TEAM":
      return `team:${operation.payload.proposedTeamId}`;
    case "REMOVE_TEAM":
    case "RENAME_TEAM":
      return `team:${operation.payload.teamId}`;
    case "REVIEW_REPORT":
      return `report:${operation.payload.reportId}`;
    case "ARCHIVE_LEAGUE":
    case "UPDATE_LEAGUE":
      return "league";
  }
}

function operationLabel(kind: PortableOperation["kind"]): string {
  return kind
    .toLocaleLowerCase()
    .split("_")
    .map((part) => part[0].toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function lines(form: FormData, key: string): string[] {
  return String(form.get(key) ?? "")
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function nullableForm(form: FormData, key: string): string | null {
  return String(form.get(key) ?? "").trim() || null;
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function formatShortDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(new Date(value));
}

function formatTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

const inputClass =
  "min-h-11 w-full rounded-xl border border-[#bdcbc2] bg-white px-3 font-normal";
const smallInput =
  "min-h-11 w-full rounded-lg border border-[#bdcbc2] bg-white px-2.5 text-base font-normal";
const textareaClass =
  "mt-1.5 min-h-24 w-full rounded-xl border border-[#bdcbc2] bg-white px-3 py-2 font-normal";
const smallPrimary =
  "mt-3 min-h-11 w-full rounded-lg bg-[#0f5138] px-3 text-sm font-black text-white";
const smallSecondary =
  "mt-3 min-h-11 w-full rounded-lg border border-[#0f5138] px-3 text-sm font-black text-[#0f5138]";
