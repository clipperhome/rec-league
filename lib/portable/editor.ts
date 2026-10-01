import { findGameConflict } from "../game-conflicts";
import { generateScheduledRoundRobinSchedule, zonedDateTimeToUtc } from "../schedule";
import { assertPortableDocument } from "./validate";
import { portableOperationTarget } from "./sync-plan";
import {
  PORTABLE_FORMAT,
  PORTABLE_SCHEMA_URL,
  PORTABLE_SCHEMA_VERSION,
  type LeagueDocumentV1,
  type PortableGame,
  type PortableOperation,
  type PortableReportType,
  type PortableScheduledInstant,
} from "./types";

export type PortableEditorContext = {
  newId(prefix: string): string;
  now(): Date;
};

export type CreateLocalLeagueInput = {
  name: string;
  seasonLabel?: string | null;
  sport?: string | null;
  teamNames: string[];
  timeZone: string;
};

export type LeagueSettingsChange = Extract<
  PortableOperation,
  { kind: "UPDATE_LEAGUE" }
>["payload"]["changes"];

export class PortableEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortableEditorError";
  }
}

export const defaultPortableEditorContext: PortableEditorContext = {
  newId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
  },
  now() {
    return new Date();
  },
};

export function createLocalLeagueDocument(
  input: CreateLocalLeagueInput,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  const now = context.now().toISOString();
  const names = normalizeTeamNames(input.teamNames);
  const leagueId = context.newId("league");
  return assertPortableDocument({
    $schema: PORTABLE_SCHEMA_URL,
    dataRevision: 1,
    documentId: leagueId,
    export: {
      appVersion: "0.1.0-portable",
      containsPrivateData: true,
      exportedAt: now,
      scope: "organizer-backup",
      source: "local-only",
    },
    format: PORTABLE_FORMAT,
    games: [],
    league: {
      archivedAt: null,
      createdAt: now,
      id: leagueId,
      name: requiredText(input.name, "League name", 80),
      publicUpdatedAt: now,
      schedule: {
        durationMinutes: 60,
        fields: [],
        startDate: null,
        startTimes: [],
        weekdays: [],
      },
      scoring: {
        lossPoints: 0,
        showStandings: true,
        tiePoints: 1,
        winPoints: 3,
      },
      seasonLabel: optionalText(input.seasonLabel, 60),
      slug: slugify(input.name),
      sport: optionalText(input.sport, 60),
      timeZone: input.timeZone,
      updatedAt: now,
      venue: { address: null, name: null, url: null },
      version: 1,
    },
    privateData: {
      activity: [
        {
          actorEmail: null,
          actorRole: "ORGANIZER",
          createdAt: now,
          details: { source: "portable-app" },
          gameId: null,
          id: context.newId("activity"),
          summary: "Created this local-only league.",
          teamId: null,
          type: "LOCAL_LEAGUE_CREATED",
        },
      ],
      managers: [],
      organizerContactEmail: null,
      reports: [],
    },
    results: [],
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    sync: {
      clientId: context.newId("client"),
      lastSyncedRevision: null,
      mode: "local-only",
      pendingOperations: [],
    },
    teams: names.map((name) => ({
      createdAt: now,
      id: context.newId("team"),
      name,
      updatedAt: now,
      version: 1,
    })),
  } satisfies LeagueDocumentV1);
}

export function addTeam(
  document: LeagueDocumentV1,
  name: string,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireLocalOrganizer(document);
  const cleanName = uniqueTeamName(document, name);
  const now = context.now().toISOString();
  const next = structuredClone(document);
  next.teams.push({
    createdAt: now,
    id: context.newId("team"),
    name: cleanName,
    updatedAt: now,
    version: 1,
  });
  return finalizeLocal(next, context, {
    summary: `Added ${cleanName}.`,
    type: "LOCAL_TEAM_ADDED",
  });
}

export function removeTeam(
  document: LeagueDocumentV1,
  teamId: string,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireLocalOrganizer(document);
  if (document.teams.length <= 2) {
    throw new PortableEditorError("A league needs at least two teams.");
  }
  const team = document.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new PortableEditorError("That team is no longer in this file.");
  if (document.games.some((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)) {
    throw new PortableEditorError(
      "Replace the schedule before removing a team that already has games.",
    );
  }
  const next = structuredClone(document);
  next.teams = next.teams.filter((candidate) => candidate.id !== teamId);
  next.privateData!.managers = next.privateData!.managers.filter(
    (manager) => manager.teamId !== teamId,
  );
  return finalizeLocal(next, context, {
    summary: `Removed ${team.name}.`,
    teamId,
    type: "LOCAL_TEAM_REMOVED",
  });
}

export function renameTeam(
  document: LeagueDocumentV1,
  teamId: string,
  name: string,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireOrganizerDocument(document);
  const team = document.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new PortableEditorError("That team is no longer in this file.");
  const cleanName = uniqueTeamName(document, name, teamId);
  if (isConnected(document)) {
    return queueConnected(
      document,
      {
        kind: "RENAME_TEAM",
        payload: {
          expectedTeamVersion: team.version,
          name: cleanName,
          teamId,
        },
      },
      context,
    );
  }
  const next = structuredClone(document);
  const editable = next.teams.find((candidate) => candidate.id === teamId)!;
  editable.name = cleanName;
  editable.updatedAt = context.now().toISOString();
  editable.version += 1;
  return finalizeLocal(next, context, {
    summary: `Renamed ${team.name} to ${cleanName}.`,
    teamId,
    type: "LOCAL_TEAM_RENAMED",
  });
}

export function updateLeagueSettings(
  document: LeagueDocumentV1,
  changes: LeagueSettingsChange,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireOrganizerDocument(document);
  if (!Object.keys(changes).length) {
    throw new PortableEditorError("Choose at least one league setting to change.");
  }
  if (isConnected(document)) {
    if (changes.schedule || changes.timeZone) {
      throw new PortableEditorError(
        "Connected schedule rhythm and time-zone changes need the online rebuild preview.",
      );
    }
    return queueConnected(
      document,
      {
        kind: "UPDATE_LEAGUE",
        payload: {
          changes,
          expectedLeagueVersion: document.league.version,
        },
      },
      context,
    );
  }
  const next = structuredClone(document);
  if (changes.name !== undefined) {
    next.league.name = requiredText(changes.name, "League name", 80);
  }
  if (changes.seasonLabel !== undefined) {
    next.league.seasonLabel = optionalText(changes.seasonLabel, 60);
  }
  if (changes.sport !== undefined) {
    next.league.sport = optionalText(changes.sport, 60);
  }
  if (changes.timeZone !== undefined) next.league.timeZone = changes.timeZone;
  if (changes.schedule !== undefined) next.league.schedule = changes.schedule;
  if (changes.scoring !== undefined) next.league.scoring = changes.scoring;
  if (changes.venue !== undefined) next.league.venue = changes.venue;
  next.league.version += 1;
  return finalizeLocal(next, context, {
    summary: "Updated local league settings.",
    type: "LOCAL_LEAGUE_UPDATED",
  });
}

export function generateLocalSchedule(
  document: LeagueDocumentV1,
  cycles: number,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireLocalOrganizer(document);
  const settings = document.league.schedule;
  if (!settings.startDate || !settings.weekdays.length || !settings.startTimes.length) {
    throw new PortableEditorError(
      "Add a start date, play day, and start time before generating the schedule.",
    );
  }
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 10) {
    throw new PortableEditorError("Schedule cycles must be between 1 and 10.");
  }
  const assignments = generateScheduledRoundRobinSchedule(
    document.teams.map((team) => team.id),
    cycles,
    {
      fieldNames: settings.fields,
      gameDays: settings.weekdays,
      gameDurationMinutes: settings.durationMinutes,
      gameTimes: settings.startTimes,
      startDate: settings.startDate,
      timeZone: document.league.timeZone,
    },
  );
  const now = context.now().toISOString();
  const next = structuredClone(document);
  next.games = assignments.map((assignment) => ({
    awayTeamId: assignment.away,
    createdAt: now,
    fieldName: assignment.fieldName,
    homeTeamId: assignment.home,
    id: context.newId("game"),
    locked: false,
    round: assignment.round,
    scheduled: scheduledInstantFromDate(
      assignment.scheduledAt,
      document.league.timeZone,
    ),
    status: "SCHEDULED",
    updatedAt: now,
    version: 1,
  }));
  next.results = [];
  next.privateData!.reports = [];
  return finalizeLocal(next, context, {
    details: { cycles, gameCount: next.games.length },
    summary: `Generated ${next.games.length} scheduled games.`,
    type: "LOCAL_SCHEDULE_GENERATED",
  });
}

export function setScore(
  document: LeagueDocumentV1,
  gameId: string,
  homeScore: number,
  awayScore: number,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireOrganizerDocument(document);
  const game = editableGame(document, gameId);
  assertScore(homeScore, "Home score");
  assertScore(awayScore, "Away score");
  if (isConnected(document)) {
    return queueConnected(
      document,
      {
        kind: "SET_SCORE",
        payload: {
          awayScore,
          expectedGameVersion: game.version,
          gameId,
          homeScore,
        },
      },
      context,
    );
  }
  const next = structuredClone(document);
  const now = context.now().toISOString();
  const editable = next.games.find((candidate) => candidate.id === gameId)!;
  editable.status = "COMPLETED";
  editable.updatedAt = now;
  editable.version += 1;
  const result = next.results.find((candidate) => candidate.gameId === gameId);
  if (result) {
    result.awayScore = awayScore;
    result.homeScore = homeScore;
    result.updatedAt = now;
    result.version += 1;
  } else {
    next.results.push({
      awayScore,
      gameId,
      homeScore,
      id: context.newId("result"),
      submittedAt: now,
      updatedAt: now,
      version: 1,
    });
  }
  return finalizeLocal(next, context, {
    gameId,
    summary: "Recorded a local final score.",
    type: "LOCAL_SCORE_RECORDED",
  });
}

export function markRainout(
  document: LeagueDocumentV1,
  gameId: string,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireOrganizerDocument(document);
  const game = editableGame(document, gameId);
  if (isConnected(document)) {
    return queueConnected(
      document,
      {
        kind: "MARK_RAINOUT",
        payload: { expectedGameVersion: game.version, gameId },
      },
      context,
    );
  }
  const next = structuredClone(document);
  const editable = next.games.find((candidate) => candidate.id === gameId)!;
  editable.status = "RAINED_OUT";
  editable.locked = false;
  editable.updatedAt = context.now().toISOString();
  editable.version += 1;
  next.results = next.results.filter((result) => result.gameId !== gameId);
  return finalizeLocal(next, context, {
    gameId,
    summary: "Marked a local game as rained out.",
    type: "LOCAL_RAINOUT_RECORDED",
  });
}

export function rescheduleGame(
  document: LeagueDocumentV1,
  gameId: string,
  localDate: string,
  localTime: string,
  fieldName: string | null,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireOrganizerDocument(document);
  const game = editableGame(document, gameId);
  const scheduled = scheduledInstantFromLocal(
    localDate,
    localTime,
    document.league.timeZone,
  );
  assertNoScheduleConflict(document, game, scheduled, fieldName);
  if (isConnected(document)) {
    return queueConnected(
      document,
      {
        kind: "RESCHEDULE_GAME",
        payload: {
          expectedGameVersion: game.version,
          fieldName: optionalText(fieldName, 80),
          gameId,
          scheduled,
        },
      },
      context,
    );
  }
  const next = structuredClone(document);
  const editable = next.games.find((candidate) => candidate.id === gameId)!;
  editable.fieldName = optionalText(fieldName, 80);
  editable.scheduled = scheduled;
  editable.status = next.results.some((result) => result.gameId === gameId)
    ? "COMPLETED"
    : "RESCHEDULED";
  editable.updatedAt = context.now().toISOString();
  editable.version += 1;
  return finalizeLocal(next, context, {
    gameId,
    summary: "Rescheduled a local game.",
    type: "LOCAL_GAME_RESCHEDULED",
  });
}

export function setLeagueArchived(
  document: LeagueDocumentV1,
  archived: boolean,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireOrganizerDocument(document, true);
  if (isConnected(document)) {
    return queueConnected(
      document,
      {
        kind: "ARCHIVE_LEAGUE",
        payload: {
          archived,
          expectedLeagueVersion: document.league.version,
        },
      },
      context,
    );
  }
  const next = structuredClone(document);
  next.league.archivedAt = archived ? context.now().toISOString() : null;
  next.league.version += 1;
  return finalizeLocal(next, context, {
    summary: archived ? "Archived the local season." : "Reopened the local season.",
    type: archived ? "LOCAL_LEAGUE_ARCHIVED" : "LOCAL_LEAGUE_REOPENED",
  });
}

export function submitManagerReport(
  document: LeagueDocumentV1,
  input: {
    awayScore?: number | null;
    gameId: string;
    homeScore?: number | null;
    note?: string | null;
    proposedFieldName?: string | null;
    proposedLocalDate?: string | null;
    proposedLocalTime?: string | null;
    reportType: PortableReportType;
  },
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  if (
    document.export.scope !== "team-manager-packet" ||
    !document.teamPacket ||
    !isConnected(document)
  ) {
    throw new PortableEditorError(
      "Manager reports require a connected team-manager packet.",
    );
  }
  const game = editableGame(document, input.gameId);
  const teamId = document.teamPacket.teamId;
  if (game.homeTeamId !== teamId && game.awayTeamId !== teamId) {
    throw new PortableEditorError("This game is outside the packet’s team scope.");
  }
  const proposedScheduled =
    input.reportType === "RESCHEDULE" &&
    input.proposedLocalDate &&
    input.proposedLocalTime
      ? scheduledInstantFromLocal(
          input.proposedLocalDate,
          input.proposedLocalTime,
          document.league.timeZone,
        )
      : null;
  const homeScore = input.reportType === "SCORE" ? input.homeScore ?? null : null;
  const awayScore = input.reportType === "SCORE" ? input.awayScore ?? null : null;
  if (input.reportType === "SCORE") {
    assertScore(homeScore, "Home score");
    assertScore(awayScore, "Away score");
  }
  return queueConnected(
    document,
    {
      kind: "SUBMIT_REPORT",
      payload: {
        awayScore,
        expectedGameVersion: game.version,
        gameId: input.gameId,
        homeScore,
        note: optionalText(input.note, 2_000),
        proposedFieldName:
          input.reportType === "RESCHEDULE"
            ? optionalText(input.proposedFieldName, 80)
            : null,
        proposedScheduled,
        reportType: input.reportType,
        teamId,
      },
    },
    context,
  );
}

export function reviewLocalReport(
  document: LeagueDocumentV1,
  reportId: string,
  decision: "APPROVE" | "REJECT",
  decisionNote: string | null,
  context: PortableEditorContext = defaultPortableEditorContext,
): LeagueDocumentV1 {
  requireLocalOrganizer(document);
  const source = document.privateData!.reports.find(
    (report) => report.id === reportId,
  );
  if (!source || source.status !== "PENDING") {
    throw new PortableEditorError("That report is no longer awaiting review.");
  }
  const game = editableGame(document, source.gameId);
  if (game.version !== source.gameVersion) {
    throw new PortableEditorError(
      "The official game changed after this report was submitted.",
    );
  }
  const now = context.now().toISOString();
  const next = structuredClone(document);
  const report = next.privateData!.reports.find(
    (candidate) => candidate.id === reportId,
  )!;

  if (decision === "APPROVE") {
    const editable = next.games.find((candidate) => candidate.id === game.id)!;
    if (report.type === "SCORE") {
      assertScore(report.homeScore, "Home score");
      assertScore(report.awayScore, "Away score");
      editable.status = "COMPLETED";
      const result = next.results.find((candidate) => candidate.gameId === game.id);
      if (result) {
        result.homeScore = report.homeScore;
        result.awayScore = report.awayScore;
        result.updatedAt = now;
        result.version += 1;
      } else {
        next.results.push({
          awayScore: report.awayScore,
          gameId: game.id,
          homeScore: report.homeScore,
          id: context.newId("result"),
          submittedAt: now,
          updatedAt: now,
          version: 1,
        });
      }
    } else if (report.type === "RAINOUT") {
      if (next.results.some((result) => result.gameId === game.id)) {
        throw new PortableEditorError("A final game cannot become a rainout.");
      }
      editable.status = "RAINED_OUT";
    } else {
      if (
        next.results.some((result) => result.gameId === game.id) ||
        !report.proposedScheduled
      ) {
        throw new PortableEditorError("That reschedule can no longer be applied.");
      }
      assertNoScheduleConflict(
        next,
        editable,
        report.proposedScheduled,
        report.proposedFieldName,
      );
      editable.fieldName = report.proposedFieldName;
      editable.scheduled = report.proposedScheduled;
      editable.status = "RESCHEDULED";
    }
    editable.updatedAt = now;
    editable.version += 1;
  }

  report.status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  report.decisionNote = optionalText(decisionNote, 2_000);
  report.reviewedAt = now;
  report.reviewedByEmail = next.privateData!.organizerContactEmail;
  report.updatedAt = now;
  report.version += 1;
  if (decision === "APPROVE") {
    for (const other of next.privateData!.reports) {
      if (
        other.id !== report.id &&
        other.gameId === report.gameId &&
        other.status === "PENDING"
      ) {
        other.status = "REJECTED";
        other.decisionNote = "Superseded by an approved local report.";
        other.reviewedAt = now;
        other.reviewedByEmail = next.privateData!.organizerContactEmail;
        other.updatedAt = now;
        other.version += 1;
      }
    }
  }

  return finalizeLocal(next, context, {
    gameId: report.gameId,
    summary:
      decision === "APPROVE"
        ? "Approved a local manager report."
        : "Declined a local manager report.",
    teamId: report.teamId,
    touchesPublic: decision === "APPROVE",
    type:
      decision === "APPROVE"
        ? "LOCAL_REPORT_APPROVED"
        : "LOCAL_REPORT_REJECTED",
  });
}

export function discardPendingOperation(
  document: LeagueDocumentV1,
  operationId: string,
): LeagueDocumentV1 {
  if (!document.sync || document.sync.mode !== "connected") {
    throw new PortableEditorError("This file has no connected operation outbox.");
  }
  const next = structuredClone(document);
  const before = next.sync!.pendingOperations.length;
  next.sync!.pendingOperations = next.sync!.pendingOperations.filter(
    (operation) => operation.operationId !== operationId,
  );
  if (before === next.sync!.pendingOperations.length) {
    throw new PortableEditorError("That pending change is no longer in the outbox.");
  }
  return assertPortableDocument(next);
}

export function materializePendingOperations(
  document: LeagueDocumentV1,
): LeagueDocumentV1 {
  if (!document.sync?.pendingOperations.length) return document;
  const next = structuredClone(document);
  for (const operation of next.sync!.pendingOperations) {
    switch (operation.kind) {
      case "SET_SCORE": {
        const game = next.games.find(
          (candidate) => candidate.id === operation.payload.gameId,
        );
        if (!game) break;
        game.status = "COMPLETED";
        const result = next.results.find(
          (candidate) => candidate.gameId === operation.payload.gameId,
        );
        if (result) {
          result.homeScore = operation.payload.homeScore;
          result.awayScore = operation.payload.awayScore;
        } else {
          next.results.push({
            awayScore: operation.payload.awayScore,
            gameId: operation.payload.gameId,
            homeScore: operation.payload.homeScore,
            id: `pending_${operation.operationId}`,
            submittedAt: operation.createdAt,
            updatedAt: operation.createdAt,
            version: 1,
          });
        }
        break;
      }
      case "MARK_RAINOUT": {
        const game = next.games.find(
          (candidate) => candidate.id === operation.payload.gameId,
        );
        if (game) game.status = "RAINED_OUT";
        next.results = next.results.filter(
          (result) => result.gameId !== operation.payload.gameId,
        );
        break;
      }
      case "RESCHEDULE_GAME": {
        const game = next.games.find(
          (candidate) => candidate.id === operation.payload.gameId,
        );
        if (!game) break;
        game.fieldName = operation.payload.fieldName;
        game.scheduled = operation.payload.scheduled;
        if (game.status !== "COMPLETED") game.status = "RESCHEDULED";
        break;
      }
      case "RENAME_TEAM": {
        const team = next.teams.find(
          (candidate) => candidate.id === operation.payload.teamId,
        );
        if (team) team.name = operation.payload.name;
        break;
      }
      case "UPDATE_LEAGUE":
        Object.assign(next.league, operation.payload.changes);
        break;
      case "ARCHIVE_LEAGUE":
        next.league.archivedAt = operation.payload.archived
          ? operation.createdAt
          : null;
        break;
      case "ADD_TEAM":
      case "REMOVE_TEAM":
      case "REVIEW_REPORT":
      case "SUBMIT_REPORT":
        break;
    }
  }
  return next;
}

export function scheduledInstantFromLocal(
  localDate: string,
  localTime: string,
  timeZone: string,
): PortableScheduledInstant {
  const utc = zonedDateTimeToUtc(localDate, localTime, timeZone);
  return { localDate, localTime, timeZone, utc: utc.toISOString() };
}

function scheduledInstantFromDate(
  value: Date,
  timeZone: string,
): PortableScheduledInstant {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    localDate: `${map.year}-${map.month}-${map.day}`,
    localTime: `${map.hour}:${map.minute}`,
    timeZone,
    utc: value.toISOString(),
  };
}

function queueConnected(
  document: LeagueDocumentV1,
  partial:
    | Pick<Extract<PortableOperation, { kind: "ARCHIVE_LEAGUE" }>, "kind" | "payload">
    | Pick<Extract<PortableOperation, { kind: "MARK_RAINOUT" }>, "kind" | "payload">
    | Pick<Extract<PortableOperation, { kind: "RENAME_TEAM" }>, "kind" | "payload">
    | Pick<Extract<PortableOperation, { kind: "RESCHEDULE_GAME" }>, "kind" | "payload">
    | Pick<Extract<PortableOperation, { kind: "SET_SCORE" }>, "kind" | "payload">
    | Pick<Extract<PortableOperation, { kind: "SUBMIT_REPORT" }>, "kind" | "payload">
    | Pick<Extract<PortableOperation, { kind: "UPDATE_LEAGUE" }>, "kind" | "payload">,
  context: PortableEditorContext,
): LeagueDocumentV1 {
  if (!document.sync || document.sync.mode !== "connected") {
    throw new PortableEditorError("Open a connected working file to queue this change.");
  }
  const now = context.now().toISOString();
  const operation = {
    ...partial,
    baseRevision: document.dataRevision,
    clientId: document.sync.clientId,
    createdAt: now,
    operationId: context.newId("operation"),
  } as PortableOperation;
  const target = portableOperationTarget(operation);
  if (
    target &&
    document.sync.pendingOperations.some(
      (pending) => portableOperationTarget(pending) === target,
    )
  ) {
    throw new PortableEditorError(
      "This record already has a pending change. Undo or reconcile it first.",
    );
  }
  const next = structuredClone(document);
  next.export.exportedAt = now;
  next.sync!.pendingOperations.push(operation);
  return assertPortableDocument(next);
}

function finalizeLocal(
  document: LeagueDocumentV1,
  context: PortableEditorContext,
  activity: {
    details?: Record<string, boolean | null | number | string>;
    gameId?: string;
    summary: string;
    teamId?: string;
    touchesPublic?: boolean;
    type: string;
  },
): LeagueDocumentV1 {
  const now = context.now().toISOString();
  document.dataRevision += 1;
  document.export.exportedAt = now;
  document.league.updatedAt = now;
  if (activity.touchesPublic !== false) document.league.publicUpdatedAt = now;
  document.privateData!.activity.push({
    actorEmail: document.privateData!.organizerContactEmail,
    actorRole: "ORGANIZER",
    createdAt: now,
    details: activity.details ?? { source: "portable-app" },
    gameId: activity.gameId ?? null,
    id: context.newId("activity"),
    summary: activity.summary,
    teamId: activity.teamId ?? null,
    type: activity.type,
  });
  return assertPortableDocument(document);
}

function requireOrganizerDocument(
  document: LeagueDocumentV1,
  allowArchived = false,
): void {
  if (document.export.scope !== "organizer-backup" || !document.privateData) {
    throw new PortableEditorError("This file is not an editable organizer document.");
  }
  if (!allowArchived && document.league.archivedAt && !hasPendingReopen(document)) {
    throw new PortableEditorError("Reopen the archived season before editing it.");
  }
}

function requireLocalOrganizer(document: LeagueDocumentV1): void {
  requireOrganizerDocument(document);
  if (isConnected(document)) {
    throw new PortableEditorError(
      "This roster or schedule change needs the connected online workflow.",
    );
  }
}

function isConnected(document: LeagueDocumentV1): boolean {
  return document.sync?.mode === "connected";
}

function hasPendingReopen(document: LeagueDocumentV1): boolean {
  return Boolean(
    document.sync?.pendingOperations.some(
      (operation) =>
        operation.kind === "ARCHIVE_LEAGUE" && !operation.payload.archived,
    ),
  );
}

function editableGame(document: LeagueDocumentV1, gameId: string): PortableGame {
  const game = document.games.find((candidate) => candidate.id === gameId);
  if (!game) throw new PortableEditorError("That game is no longer in this file.");
  if (game.locked) throw new PortableEditorError("That game is locked.");
  return game;
}

function assertNoScheduleConflict(
  document: LeagueDocumentV1,
  game: PortableGame,
  scheduled: PortableScheduledInstant,
  fieldName: string | null,
) {
  const conflict = findGameConflict(
    {
      awayTeamId: game.awayTeamId,
      fieldName,
      homeTeamId: game.homeTeamId,
      id: game.id,
      scheduledAt: new Date(scheduled.utc),
    },
    document.games.map((candidate) => ({
      awayTeamId: candidate.awayTeamId,
      fieldName: candidate.fieldName,
      homeTeamId: candidate.homeTeamId,
      id: candidate.id,
      scheduledAt: candidate.scheduled
        ? new Date(candidate.scheduled.utc)
        : null,
      status: candidate.status,
    })),
    document.league.schedule.durationMinutes,
  );
  if (conflict) {
    throw new PortableEditorError(
      `That time overlaps game ${conflict.id} for a team or field.`,
    );
  }
}

function normalizeTeamNames(values: string[]): string[] {
  const names = values.map((name) => requiredText(name, "Team name", 80));
  if (names.length < 2) throw new PortableEditorError("Enter at least two teams.");
  const normalized = names.map((name) => name.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new PortableEditorError("Team names must be unique.");
  }
  return names;
}

function uniqueTeamName(
  document: LeagueDocumentV1,
  value: string,
  exceptId?: string,
): string {
  const name = requiredText(value, "Team name", 80);
  if (
    document.teams.some(
      (team) =>
        team.id !== exceptId &&
        team.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    throw new PortableEditorError("Another team already uses that name.");
  }
  return name;
}

function requiredText(value: string, label: string, maximum: number): string {
  const clean = value.trim();
  if (!clean) throw new PortableEditorError(`${label} cannot be blank.`);
  if (clean.length > maximum) {
    throw new PortableEditorError(`${label} must be ${maximum} characters or fewer.`);
  }
  return clean;
}

function optionalText(
  value: string | null | undefined,
  maximum: number,
): string | null {
  const clean = value?.trim() ?? "";
  if (!clean) return null;
  if (clean.length > maximum) {
    throw new PortableEditorError(`Keep this value to ${maximum} characters or fewer.`);
  }
  return clean;
}

function assertScore(value: number | null, label: string): asserts value is number {
  if (!Number.isInteger(value) || value === null || value < 0 || value > 999) {
    throw new PortableEditorError(`${label} must be a whole number from 0 to 999.`);
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "local-league";
}
