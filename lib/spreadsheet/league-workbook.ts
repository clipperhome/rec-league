import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

import ExcelJS, { type CellValue, type Worksheet } from "exceljs";

import { buildStandings } from "@/lib/standings";
import {
  PortableDocumentValidationError,
  assertPortableDocument,
  buildPortableCsv,
  scheduledInstantFromLocal,
  type LeagueDocumentV1,
  type PortableOperation,
  type PortableCsvTable,
} from "@/lib/portable";

const MAX_WORKSHEETS = 20;
const MAX_ROWS = 35_000;
const MAX_CELLS = 600_000;
const MAX_ZIP_ENTRIES = 200;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_IMPORT_ISSUES = 100;
const SPREADSHEET_SCHEMA_VERSION = 1;

export const MAX_SPREADSHEET_UPLOAD_BYTES = 5 * 1024 * 1024;

export type SpreadsheetCsvTable = PortableCsvTable;

export type SpreadsheetImportIssue = {
  message: string;
  path: string;
};

const SHEET_HEADERS = {
  Activity: [
    "record_id", "created_at", "actor_role", "actor_email", "type", "summary",
    "team_id", "game_id", "details_json",
  ],
  Games: [
    "record_id", "record_version", "delete", "round", "local_date", "local_time",
    "time_zone", "field_name", "home_team_id", "home_team_name", "away_team_id",
    "away_team_name", "status", "locked",
  ],
  League: [
    "document_id", "data_revision", "workbook_schema_version", "record_version", "name", "sport", "season_label",
    "time_zone", "venue_name", "venue_address", "venue_url", "schedule_start_date",
    "weekdays", "start_times", "fields", "duration_minutes", "win_points", "tie_points",
    "loss_points", "show_standings", "archived",
  ],
  Managers: ["record_id", "team_id", "email", "accepted_at", "record_version"],
  Reports: [
    "record_id", "record_version", "game_id", "team_id", "type", "status",
    "home_score", "away_score", "proposed_local_date", "proposed_local_time",
    "proposed_time_zone", "proposed_field_name", "note", "submitted_by_email",
    "reviewed_by_email", "decision_note", "created_at", "reviewed_at",
  ],
  Results: [
    "record_id", "record_version", "delete", "game_id", "local_date", "home_team",
    "away_team", "home_score", "away_score", "game_status", "updated_at",
  ],
  Standings: [
    "position", "team_id", "team_name", "played", "wins", "ties", "losses",
    "score_for", "score_against", "differential", "points",
  ],
  Teams: ["record_id", "record_version", "delete", "name"],
} as const;

const REQUIRED_IMPORT_HEADERS = {
  Games: SHEET_HEADERS.Games,
  League: SHEET_HEADERS.League,
  Results: [
    "record_id", "record_version", "delete", "game_id", "home_score", "away_score",
  ],
  Teams: SHEET_HEADERS.Teams,
} as const;

export class SpreadsheetImportError extends Error {
  readonly issues: SpreadsheetImportIssue[];

  constructor(issues: SpreadsheetImportIssue[]) {
    const limited = issues.slice(0, MAX_IMPORT_ISSUES);
    super(limited[0]?.message ?? "The workbook is not valid.");
    this.name = "SpreadsheetImportError";
    this.issues = limited;
  }
}

export async function buildLeagueWorkbook(
  document: LeagueDocumentV1,
): Promise<Buffer> {
  const source = requireOrganizer(document);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Rec League";
  workbook.created = new Date(source.export.exportedAt);
  workbook.modified = new Date(source.export.exportedAt);
  workbook.subject = "Portable recreational league operations";
  workbook.title = `${source.league.name} operations`;

  addReadme(workbook, source);
  addTableSheet(workbook, "League", leagueRows(source), { frozenColumns: 3 });
  addTableSheet(workbook, "Teams", teamRows(source), { frozenColumns: 3 });
  addTableSheet(workbook, "Games", gameRows(source), { frozenColumns: 3 });
  addTableSheet(workbook, "Results", resultRows(source), { frozenColumns: 3 });
  addTableSheet(workbook, "Managers", managerRows(source), {
    frozenColumns: 2,
    readOnly: true,
  });
  addTableSheet(workbook, "Reports", reportRows(source), {
    frozenColumns: 2,
    readOnly: true,
  });
  addTableSheet(workbook, "Activity", activityRows(source), {
    frozenColumns: 2,
    readOnly: true,
  });
  addTableSheet(workbook, "Standings", standingsRows(source), {
    frozenColumns: 1,
    readOnly: true,
  });

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes as ArrayBuffer);
}

export function buildLeagueCsv(
  document: LeagueDocumentV1,
  table: SpreadsheetCsvTable,
): string {
  return buildPortableCsv(requireOrganizer(document), table);
}

export async function workbookToConnectedDocument(
  bytes: Uint8Array,
  current: LeagueDocumentV1,
  options: { clientId?: string; now?: Date } = {},
): Promise<{ document: LeagueDocumentV1; warnings: string[] }> {
  const source = requireOrganizer(current);
  if (!bytes.byteLength) {
    throw new SpreadsheetImportError([
      { message: "The workbook is empty.", path: "workbook" },
    ]);
  }
  if (bytes.byteLength > MAX_SPREADSHEET_UPLOAD_BYTES) {
    throw new SpreadsheetImportError([
      {
        message: `The workbook is larger than ${MAX_SPREADSHEET_UPLOAD_BYTES / 1024 / 1024} MB.`,
        path: "workbook",
      },
    ]);
  }
  await preflightZip(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new SpreadsheetImportError([
      { message: "The file is not a readable .xlsx workbook.", path: "workbook" },
    ]);
  }
  preflightWorkbook(workbook);

  const issues: SpreadsheetImportIssue[] = [];
  rejectFormulas(workbook, issues);
  const leagueSheet = requiredSheet(workbook, "League", issues);
  const teamsSheet = requiredSheet(workbook, "Teams", issues);
  const gamesSheet = requiredSheet(workbook, "Games", issues);
  const resultsSheet = requiredSheet(workbook, "Results", issues);
  if (issues.length || !leagueSheet || !teamsSheet || !gamesSheet || !resultsSheet) {
    throw new SpreadsheetImportError(issues);
  }

  const now = (options.now ?? new Date()).toISOString();
  const clientId = options.clientId ?? `client_${randomUUID()}`;
  const league = rowsByHeader(
    leagueSheet,
    "League",
    REQUIRED_IMPORT_HEADERS.League,
    issues,
  );
  const teams = rowsByHeader(
    teamsSheet,
    "Teams",
    REQUIRED_IMPORT_HEADERS.Teams,
    issues,
  );
  const games = rowsByHeader(
    gamesSheet,
    "Games",
    REQUIRED_IMPORT_HEADERS.Games,
    issues,
  );
  const results = rowsByHeader(
    resultsSheet,
    "Results",
    REQUIRED_IMPORT_HEADERS.Results,
    issues,
  );
  if (issues.length) throw new SpreadsheetImportError(issues);
  if (league.length !== 1) {
    issues.push({
      message: "League must contain exactly one data row.",
      path: "League",
    });
  }

  const leagueRow = league[0];
  const documentId = textValue(leagueRow?.values.document_id, "League!document_id", issues);
  const baseRevision = integerValue(
    leagueRow?.values.data_revision,
    "League!data_revision",
    issues,
  );
  const workbookSchemaVersion = integerValue(
    leagueRow?.values.workbook_schema_version,
    "League!workbook_schema_version",
    issues,
  );
  if (documentId && documentId !== source.documentId) {
    issues.push({
      message: "This workbook belongs to a different league.",
      path: "League!document_id",
    });
  }
  if (baseRevision > source.dataRevision) {
    issues.push({
      message: "This workbook was exported from a newer league revision.",
      path: "League!data_revision",
    });
  }
  if (workbookSchemaVersion !== SPREADSHEET_SCHEMA_VERSION) {
    issues.push({
      message:
        workbookSchemaVersion > SPREADSHEET_SCHEMA_VERSION
          ? "This workbook was created by a newer app. Upgrade before importing it."
          : "This workbook format is no longer supported. Download a fresh workbook.",
      path: "League!workbook_schema_version",
    });
  }

  const operations: PortableOperation[] = [];
  if (leagueRow) {
    planLeagueRow(source, leagueRow, baseRevision, clientId, now, operations, issues);
  }
  planTeamRows(source, teams, baseRevision, clientId, now, operations, issues);
  const gameVersions = planGameRows(
    source,
    games,
    baseRevision,
    clientId,
    now,
    operations,
    issues,
  );
  planResultRows(
    source,
    results,
    gameVersions,
    baseRevision,
    clientId,
    now,
    operations,
    issues,
  );

  if (operations.length > 100) {
    issues.push({
      message: "A workbook may propose at most 100 changes at once.",
      path: "workbook",
    });
  }
  if (issues.length) throw new SpreadsheetImportError(issues);
  if (!operations.length) {
    throw new SpreadsheetImportError([
      { message: "The workbook does not contain any supported changes.", path: "workbook" },
    ]);
  }

  let document: LeagueDocumentV1;
  try {
    document = assertPortableDocument({
      ...source,
      export: { ...source.export, exportedAt: now, source: "connected" },
      sync: {
        clientId,
        lastSyncedRevision: source.dataRevision,
        mode: "connected",
        pendingOperations: operations,
      },
    });
  } catch (error) {
    if (error instanceof PortableDocumentValidationError) {
      throw new SpreadsheetImportError(
        error.issues.map((issue) => ({
          message: issue.message,
          path: `generated change ${issue.path}`,
        })),
      );
    }
    throw error;
  }

  return {
    document,
    warnings: [
      "Missing rows do not delete records; only an explicit TRUE in a delete column requests deletion.",
      "Managers, Reports, Activity, and Standings are reference-only and ignored on import.",
      "Roster, schedule-rhythm, time-zone, and deletion requests may require the online rebuild workflow and will appear as rejected in preview.",
    ],
  };
}

export type SpreadsheetChange = {
  after: string;
  before: string;
  kind: PortableOperation["kind"];
  operationId: string;
  target: string;
};

export function describeSpreadsheetChanges(
  currentDocument: LeagueDocumentV1,
  incomingDocument: LeagueDocumentV1,
): SpreadsheetChange[] {
  const current = requireOrganizer(currentDocument);
  const incoming = assertPortableDocument(incomingDocument);
  const operations = incoming.sync?.pendingOperations ?? [];
  const teams = new Map(current.teams.map((team) => [team.id, team]));
  const games = new Map(current.games.map((game) => [game.id, game]));
  const results = new Map(current.results.map((result) => [result.gameId, result]));

  return operations.map((operation) => {
    switch (operation.kind) {
      case "UPDATE_LEAGUE": {
        const fields = Object.keys(operation.payload.changes) as Array<
          keyof typeof operation.payload.changes
        >;
        return {
          after: fields
            .map((field) => `${leagueFieldLabel(field)}: ${displayValue(operation.payload.changes[field])}`)
            .join("; "),
          before: fields
            .map((field) => `${leagueFieldLabel(field)}: ${displayValue(current.league[field])}`)
            .join("; "),
          kind: operation.kind,
          operationId: operation.operationId,
          target: current.league.name,
        };
      }
      case "ARCHIVE_LEAGUE":
        return {
          after: operation.payload.archived ? "Archived" : "Active",
          before: current.league.archivedAt ? "Archived" : "Active",
          kind: operation.kind,
          operationId: operation.operationId,
          target: current.league.name,
        };
      case "ADD_TEAM":
        return {
          after: operation.payload.name,
          before: "Team does not exist",
          kind: operation.kind,
          operationId: operation.operationId,
          target: operation.payload.name,
        };
      case "REMOVE_TEAM": {
        const team = teams.get(operation.payload.teamId);
        return {
          after: "Team removed",
          before: team?.name ?? operation.payload.teamId,
          kind: operation.kind,
          operationId: operation.operationId,
          target: team?.name ?? operation.payload.teamId,
        };
      }
      case "RENAME_TEAM": {
        const team = teams.get(operation.payload.teamId);
        return {
          after: operation.payload.name,
          before: team?.name ?? operation.payload.teamId,
          kind: operation.kind,
          operationId: operation.operationId,
          target: team?.name ?? operation.payload.teamId,
        };
      }
      case "MARK_RAINOUT": {
        const game = games.get(operation.payload.gameId);
        return gameChange(operation, gameLabel(game, teams), game?.status ?? "Unknown", "RAINED_OUT");
      }
      case "RESCHEDULE_GAME": {
        const game = games.get(operation.payload.gameId);
        return gameChange(
          operation,
          gameLabel(game, teams),
          scheduleLabel(game?.scheduled, game?.fieldName),
          scheduleLabel(operation.payload.scheduled, operation.payload.fieldName),
        );
      }
      case "SET_SCORE": {
        const game = games.get(operation.payload.gameId);
        const result = results.get(operation.payload.gameId);
        return gameChange(
          operation,
          gameLabel(game, teams),
          result ? `${result.homeScore}–${result.awayScore}` : "No official score",
          `${operation.payload.homeScore}–${operation.payload.awayScore}`,
        );
      }
      case "REVIEW_REPORT":
      case "SUBMIT_REPORT":
        return {
          after: "Submitted operation",
          before: "No spreadsheet change",
          kind: operation.kind,
          operationId: operation.operationId,
          target: "Report",
        };
    }
  });
}

function gameChange(
  operation: PortableOperation,
  target: string,
  before: string,
  after: string,
): SpreadsheetChange {
  return {
    after,
    before,
    kind: operation.kind,
    operationId: operation.operationId,
    target,
  };
}

function gameLabel(
  game: LeagueDocumentV1["games"][number] | undefined,
  teams: Map<string, LeagueDocumentV1["teams"][number]>,
): string {
  if (!game) return "Unknown game";
  return `${teams.get(game.homeTeamId)?.name ?? game.homeTeamId} vs ${teams.get(game.awayTeamId)?.name ?? game.awayTeamId}`;
}

function scheduleLabel(
  scheduled: LeagueDocumentV1["games"][number]["scheduled"] | undefined,
  fieldName: string | null | undefined,
): string {
  if (!scheduled) return "Unscheduled";
  return `${scheduled.localDate} ${scheduled.localTime} (${scheduled.timeZone})${fieldName ? ` · ${fieldName}` : ""}`;
}

function leagueFieldLabel(field: string): string {
  return field.replace(/([A-Z])/gu, " $1").replace(/^./u, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

type WorkbookRow = {
  rowNumber: number;
  values: Record<string, CellValue>;
};

function planLeagueRow(
  current: LeagueDocumentV1,
  row: WorkbookRow,
  baseRevision: number,
  clientId: string,
  now: string,
  operations: PortableOperation[],
  issues: SpreadsheetImportIssue[],
) {
  const version = integerValue(row.values.record_version, "League!record_version", issues);
  const changes: Extract<PortableOperation, { kind: "UPDATE_LEAGUE" }>["payload"]["changes"] = {};
  const name = textValue(row.values.name, "League!name", issues);
  const sport = nullableTextValue(row.values.sport, "League!sport", issues);
  const seasonLabel = nullableTextValue(
    row.values.season_label,
    "League!season_label",
    issues,
  );
  const timeZone = textValue(row.values.time_zone, "League!time_zone", issues);
  const venue = {
    address: nullableTextValue(row.values.venue_address, "League!venue_address", issues),
    name: nullableTextValue(row.values.venue_name, "League!venue_name", issues),
    url: nullableTextValue(row.values.venue_url, "League!venue_url", issues),
  };
  const scoring = {
    lossPoints: integerValue(row.values.loss_points, "League!loss_points", issues),
    showStandings: booleanValue(
      row.values.show_standings,
      "League!show_standings",
      issues,
    ),
    tiePoints: integerValue(row.values.tie_points, "League!tie_points", issues),
    winPoints: integerValue(row.values.win_points, "League!win_points", issues),
  };
  if (name !== current.league.name) changes.name = name;
  if (sport !== current.league.sport) changes.sport = sport;
  if (seasonLabel !== current.league.seasonLabel) changes.seasonLabel = seasonLabel;
  if (timeZone !== current.league.timeZone) changes.timeZone = timeZone;
  if (JSON.stringify(venue) !== JSON.stringify(current.league.venue)) changes.venue = venue;
  if (JSON.stringify(scoring) !== JSON.stringify(current.league.scoring)) {
    changes.scoring = scoring;
  }
  const schedule = {
    durationMinutes: integerValue(
      row.values.duration_minutes,
      "League!duration_minutes",
      issues,
    ),
    fields: listValue(row.values.fields, "League!fields", issues),
    startDate: nullableTextValue(
      row.values.schedule_start_date,
      "League!schedule_start_date",
      issues,
    ),
    startTimes: listValue(row.values.start_times, "League!start_times", issues),
    weekdays: numberListValue(row.values.weekdays, "League!weekdays", issues),
  };
  if (JSON.stringify(schedule) !== JSON.stringify(current.league.schedule)) {
    changes.schedule = schedule;
  }
  const archived = booleanValue(row.values.archived, "League!archived", issues);
  const archiveChanged = archived !== Boolean(current.league.archivedAt);
  const updateOperation: PortableOperation | null = Object.keys(changes).length
    ? {
      baseRevision,
      clientId,
      createdAt: now,
      kind: "UPDATE_LEAGUE",
      operationId: `operation_${randomUUID()}`,
      payload: {
        changes,
        expectedLeagueVersion: version + (archiveChanged && !archived ? 1 : 0),
      },
    }
    : null;
  const archiveOperation: PortableOperation | null = archiveChanged
    ? {
      baseRevision,
      clientId,
      createdAt: now,
      kind: "ARCHIVE_LEAGUE",
      operationId: `operation_${randomUUID()}`,
      payload: {
        archived,
        expectedLeagueVersion: version + (updateOperation && archived ? 1 : 0),
      },
    }
    : null;

  if (archiveOperation && !archived) operations.push(archiveOperation);
  if (updateOperation) operations.push(updateOperation);
  if (archiveOperation && archived) operations.push(archiveOperation);
}

function planTeamRows(
  current: LeagueDocumentV1,
  rows: WorkbookRow[],
  baseRevision: number,
  clientId: string,
  now: string,
  operations: PortableOperation[],
  issues: SpreadsheetImportIssue[],
) {
  const currentById = new Map(current.teams.map((team) => [team.id, team]));
  const seen = new Set<string>();
  for (const row of rows) {
    if (issues.length >= MAX_IMPORT_ISSUES) break;
    const path = `Teams!${row.rowNumber}`;
    const id = nullableTextValue(row.values.record_id, `${path}.record_id`, issues);
    const name = textValue(row.values.name, `${path}.name`, issues);
    const remove = booleanValue(row.values.delete, `${path}.delete`, issues);
    if (!id) {
      if (remove) {
        issues.push({ message: "A new team cannot also be deleted.", path });
      } else {
        operations.push({
          baseRevision,
          clientId,
          createdAt: now,
          kind: "ADD_TEAM",
          operationId: `operation_${randomUUID()}`,
          payload: { name, proposedTeamId: `team_${randomUUID()}` },
        });
      }
      continue;
    }
    if (seen.has(id)) {
      issues.push({ message: "Duplicate team record_id.", path: `${path}.record_id` });
      continue;
    }
    seen.add(id);
    const team = currentById.get(id);
    if (!team) {
      issues.push({ message: "Team ID does not exist in this league.", path });
      continue;
    }
    const version = integerValue(row.values.record_version, `${path}.record_version`, issues);
    if (remove) {
      operations.push({
        baseRevision,
        clientId,
        createdAt: now,
        kind: "REMOVE_TEAM",
        operationId: `operation_${randomUUID()}`,
        payload: { expectedTeamVersion: version, teamId: id },
      });
    } else if (name !== team.name) {
      operations.push({
        baseRevision,
        clientId,
        createdAt: now,
        kind: "RENAME_TEAM",
        operationId: `operation_${randomUUID()}`,
        payload: { expectedTeamVersion: version, name, teamId: id },
      });
    }
  }
}

function planGameRows(
  current: LeagueDocumentV1,
  rows: WorkbookRow[],
  baseRevision: number,
  clientId: string,
  now: string,
  operations: PortableOperation[],
  issues: SpreadsheetImportIssue[],
): Map<string, { expectedScoreVersion: number; stateChange: "RAINOUT" | "RESCHEDULE" | null }> {
  const currentById = new Map(current.games.map((game) => [game.id, game]));
  const versions = new Map<
    string,
    { expectedScoreVersion: number; stateChange: "RAINOUT" | "RESCHEDULE" | null }
  >();
  const seen = new Set<string>();
  for (const row of rows) {
    if (issues.length >= MAX_IMPORT_ISSUES) break;
    const path = `Games!${row.rowNumber}`;
    const id = textValue(row.values.record_id, `${path}.record_id`, issues);
    if (!id || seen.has(id)) {
      if (seen.has(id)) issues.push({ message: "Duplicate game record_id.", path });
      continue;
    }
    seen.add(id);
    const game = currentById.get(id);
    if (!game) {
      issues.push({ message: "New or unknown games cannot be imported.", path });
      continue;
    }
    const version = integerValue(row.values.record_version, `${path}.record_version`, issues);
    versions.set(id, { expectedScoreVersion: version, stateChange: null });
    if (booleanValue(row.values.delete, `${path}.delete`, issues)) {
      issues.push({ message: "Game deletion is not supported by spreadsheet import.", path });
      continue;
    }
    const round = integerValue(row.values.round, `${path}.round`, issues);
    const homeTeamId = textValue(row.values.home_team_id, `${path}.home_team_id`, issues);
    const awayTeamId = textValue(row.values.away_team_id, `${path}.away_team_id`, issues);
    const locked = booleanValue(row.values.locked, `${path}.locked`, issues);
    if (
      round !== game.round ||
      homeTeamId !== game.homeTeamId ||
      awayTeamId !== game.awayTeamId ||
      locked !== game.locked
    ) {
      issues.push({
        message: "Round, team IDs, and locked state are reference-only.",
        path,
      });
      continue;
    }
    const status = textValue(row.values.status, `${path}.status`, issues);
    if (!["COMPLETED", "RAINED_OUT", "RESCHEDULED", "SCHEDULED"].includes(status)) {
      issues.push({ message: "Use a supported game status.", path: `${path}.status` });
      continue;
    }
    const localDate = nullableTextValue(row.values.local_date, `${path}.local_date`, issues);
    const localTime = nullableTextValue(row.values.local_time, `${path}.local_time`, issues);
    const timeZone = nullableTextValue(row.values.time_zone, `${path}.time_zone`, issues);
    const fieldName = nullableTextValue(row.values.field_name, `${path}.field_name`, issues);
    const scheduleChanged =
      localDate !== (game.scheduled?.localDate ?? null) ||
      localTime !== (game.scheduled?.localTime ?? null) ||
      timeZone !== (game.scheduled?.timeZone ?? null) ||
      fieldName !== game.fieldName;
    if (status === "RAINED_OUT" && game.status !== "RAINED_OUT") {
      if (scheduleChanged) {
        issues.push({
          message: "Choose either a rainout or a new schedule slot for one game, not both.",
          path,
        });
        continue;
      }
      operations.push({
        baseRevision,
        clientId,
        createdAt: now,
        kind: "MARK_RAINOUT",
        operationId: `operation_${randomUUID()}`,
        payload: { expectedGameVersion: version, gameId: id },
      });
      versions.set(id, { expectedScoreVersion: version + 1, stateChange: "RAINOUT" });
      continue;
    }
    if (status !== game.status && status === "COMPLETED") {
      issues.push({
        message: "Enter a final score on Results instead of changing game status.",
        path: `${path}.status`,
      });
      continue;
    }
    if (scheduleChanged) {
      if (!localDate || !localTime || !timeZone) {
        issues.push({
          message: "A rescheduled game needs local_date, local_time, and time_zone.",
          path,
        });
        continue;
      }
      try {
        operations.push({
          baseRevision,
          clientId,
          createdAt: now,
          kind: "RESCHEDULE_GAME",
          operationId: `operation_${randomUUID()}`,
          payload: {
            expectedGameVersion: version,
            fieldName,
            gameId: id,
            scheduled: scheduledInstantFromLocal(localDate, localTime, timeZone),
          },
        });
        versions.set(id, {
          expectedScoreVersion: version + 1,
          stateChange: "RESCHEDULE",
        });
      } catch {
        issues.push({ message: "The proposed local date and time are invalid.", path });
      }
    } else if (status !== game.status) {
      issues.push({
        message: "Only RAINED_OUT or schedule changes are editable in Games.",
        path: `${path}.status`,
      });
    }
  }
  return versions;
}

function planResultRows(
  current: LeagueDocumentV1,
  rows: WorkbookRow[],
  gameVersions: Map<
    string,
    { expectedScoreVersion: number; stateChange: "RAINOUT" | "RESCHEDULE" | null }
  >,
  baseRevision: number,
  clientId: string,
  now: string,
  operations: PortableOperation[],
  issues: SpreadsheetImportIssue[],
) {
  const currentById = new Map(current.results.map((result) => [result.id, result]));
  const currentByGame = new Map(
    current.results.map((result) => [result.gameId, result]),
  );
  const gameById = new Map(current.games.map((game) => [game.id, game]));
  const seenIds = new Set<string>();
  const seenGames = new Set<string>();
  for (const row of rows) {
    if (issues.length >= MAX_IMPORT_ISSUES) break;
    const path = `Results!${row.rowNumber}`;
    const id = nullableTextValue(row.values.record_id, `${path}.record_id`, issues);
    const gameId = textValue(row.values.game_id, `${path}.game_id`, issues);
    if (id && seenIds.has(id)) {
      issues.push({ message: "Duplicate result record_id.", path });
      continue;
    }
    if (id) seenIds.add(id);
    if (seenGames.has(gameId)) {
      issues.push({ message: "Only one Results row is allowed per game_id.", path });
      continue;
    }
    seenGames.add(gameId);
    if (!gameById.has(gameId)) {
      issues.push({ message: "Result game_id does not exist.", path });
      continue;
    }
    if (booleanValue(row.values.delete, `${path}.delete`, issues)) {
      issues.push({ message: "Result deletion is not supported by spreadsheet import.", path });
      continue;
    }
    const hasHomeScore = row.values.home_score !== null &&
      row.values.home_score !== undefined &&
      row.values.home_score !== "";
    const hasAwayScore = row.values.away_score !== null &&
      row.values.away_score !== undefined &&
      row.values.away_score !== "";
    const currentResult = id ? currentById.get(id) : currentByGame.get(gameId);
    if (!id && currentResult) {
      issues.push({
        message: "Keep the existing result record_id so its identity can be checked.",
        path: `${path}.record_id`,
      });
      continue;
    }
    if (!currentResult && !hasHomeScore && !hasAwayScore) continue;
    if (hasHomeScore !== hasAwayScore) {
      issues.push({ message: "Enter both home_score and away_score.", path });
      continue;
    }
    const homeScore = integerValue(row.values.home_score, `${path}.home_score`, issues);
    const awayScore = integerValue(row.values.away_score, `${path}.away_score`, issues);
    if (id && !currentResult) {
      issues.push({ message: "Result ID does not exist in this league.", path });
      continue;
    }
    if (currentResult && currentResult.gameId !== gameId) {
      issues.push({ message: "A result cannot move to another game.", path });
      continue;
    }
    if (currentResult) {
      const resultVersion = integerValue(
        row.values.record_version,
        `${path}.record_version`,
        issues,
      );
      if (resultVersion !== currentResult.version) {
        issues.push({ message: "The result version is stale.", path });
        continue;
      }
    }
    if (
      !currentResult ||
      currentResult.homeScore !== homeScore ||
      currentResult.awayScore !== awayScore
    ) {
      const gameVersion = gameVersions.get(gameId);
      if (!gameVersion) {
        issues.push({
          message: "Keep the matching Games row so its exported game version can be checked.",
          path,
        });
        continue;
      }
      if (gameVersion.stateChange === "RAINOUT") {
        issues.push({
          message: "A game cannot be marked rained out and given a final score in one workbook.",
          path,
        });
        continue;
      }
      operations.push({
        baseRevision,
        clientId,
        createdAt: now,
        kind: "SET_SCORE",
        operationId: `operation_${randomUUID()}`,
        payload: {
          awayScore,
          expectedGameVersion: gameVersion.expectedScoreVersion,
          gameId,
          homeScore,
        },
      });
    }
  }
}

function addReadme(workbook: ExcelJS.Workbook, document: LeagueDocumentV1) {
  const sheet = workbook.addWorksheet("README", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const rows = [
    ["Rec League portable workbook"],
    ["League", document.league.name],
    ["Document ID", document.documentId],
    ["Data revision", document.dataRevision],
    ["Schema version", document.schemaVersion],
    ["Workbook schema version", SPREADSHEET_SCHEMA_VERSION],
    ["Exported", document.export.exportedAt],
    [],
    ["Important"],
    ["JSON—not this workbook—is the full-fidelity backup and application data."],
    ["Missing rows never delete data. Set delete to TRUE only when deliberate."],
    ["Keep record_id and record_version unchanged. Blank team IDs propose additions."],
    ["Managers, Reports, Activity, and Standings are reference-only on import."],
    ["Formula cells are rejected. Store dates, times, IDs, and timestamps as text."],
    ["League weekdays, start_times, and fields use JSON arrays such as [\"09:00\"]."],
    ["A connected import is previewed against current versions before any apply."],
    ["This workbook contains manager emails and private report notes. Keep it private."],
  ];
  sheet.addRows(rows);
  sheet.getColumn(1).width = 76;
  sheet.getColumn(2).width = 38;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 16 };
  sheet.getRow(1).fill = solidFill("FF0F5138");
  sheet.getRow(9).font = { bold: true, color: { argb: "FF8A4B08" } };
  sheet.getRow(9).fill = solidFill("FFFFF3CD");
}

function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: Array<Record<string, CellValue>>,
  options: { frozenColumns: number; readOnly?: boolean },
) {
  const sheet = workbook.addWorksheet(name, {
    properties: { tabColor: { argb: options.readOnly ? "FF829087" : "FF0F6A48" } },
    views: [{ state: "frozen", xSplit: options.frozenColumns, ySplit: 1 }],
  });
  const configuredHeaders = SHEET_HEADERS[name as keyof typeof SHEET_HEADERS];
  if (!configuredHeaders) throw new Error(`No workbook columns are defined for ${name}.`);
  const headers = [...configuredHeaders];
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(12, Math.min(34, header.length + 4)),
  }));
  for (const row of rows) sheet.addRow(row);
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = solidFill(options.readOnly ? "FF526159" : "FF0F5138");
  header.alignment = { vertical: "middle" };
  header.height = 26;
  sheet.autoFilter = { from: { column: 1, row: 1 }, to: { column: headers.length, row: 1 } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 1) row.fill = solidFill("FFF3F6F2");
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      if (typeof cell.value === "string") cell.numFmt = "@";
    });
  });
}

function leagueRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  const league = document.league;
  return [
    {
      document_id: document.documentId,
      data_revision: document.dataRevision,
      workbook_schema_version: SPREADSHEET_SCHEMA_VERSION,
      record_version: league.version,
      name: league.name,
      sport: league.sport ?? "",
      season_label: league.seasonLabel ?? "",
      time_zone: league.timeZone,
      venue_name: league.venue.name ?? "",
      venue_address: league.venue.address ?? "",
      venue_url: league.venue.url ?? "",
      schedule_start_date: league.schedule.startDate ?? "",
      weekdays: JSON.stringify(league.schedule.weekdays),
      start_times: JSON.stringify(league.schedule.startTimes),
      fields: JSON.stringify(league.schedule.fields),
      duration_minutes: league.schedule.durationMinutes,
      win_points: league.scoring.winPoints,
      tie_points: league.scoring.tiePoints,
      loss_points: league.scoring.lossPoints,
      show_standings: league.scoring.showStandings,
      archived: Boolean(league.archivedAt),
    },
  ];
}

function teamRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  return document.teams.map((team) => ({
    record_id: team.id,
    record_version: team.version,
    delete: false,
    name: team.name,
  }));
}

function gameRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  const names = new Map(document.teams.map((team) => [team.id, team.name]));
  return document.games.map((game) => ({
    record_id: game.id,
    record_version: game.version,
    delete: false,
    round: game.round,
    local_date: game.scheduled?.localDate ?? "",
    local_time: game.scheduled?.localTime ?? "",
    time_zone: game.scheduled?.timeZone ?? "",
    field_name: game.fieldName ?? "",
    home_team_id: game.homeTeamId,
    home_team_name: names.get(game.homeTeamId) ?? "",
    away_team_id: game.awayTeamId,
    away_team_name: names.get(game.awayTeamId) ?? "",
    status: game.status,
    locked: game.locked,
  }));
}

function resultRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  const resultByGame = new Map(
    document.results.map((result) => [result.gameId, result]),
  );
  const teamNames = new Map(document.teams.map((team) => [team.id, team.name]));
  return document.games.map((game) => {
    const result = resultByGame.get(game.id);
    return {
    record_id: result?.id ?? "",
    record_version: result?.version ?? "",
    delete: false,
    game_id: game.id,
    local_date: game.scheduled?.localDate ?? "",
    home_team: teamNames.get(game.homeTeamId) ?? game.homeTeamId,
    away_team: teamNames.get(game.awayTeamId) ?? game.awayTeamId,
    home_score: result?.homeScore ?? "",
    away_score: result?.awayScore ?? "",
    game_status: game.status,
    updated_at: result?.updatedAt ?? "",
  };
  });
}

function managerRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  return (document.privateData?.managers ?? []).map((manager) => ({
    record_id: manager.id,
    team_id: manager.teamId,
    email: manager.email,
    accepted_at: manager.acceptedAt ?? "",
    record_version: manager.version,
  }));
}

function reportRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  return (document.privateData?.reports ?? []).map((report) => ({
    record_id: report.id,
    record_version: report.version,
    game_id: report.gameId,
    team_id: report.teamId,
    type: report.type,
    status: report.status,
    home_score: report.homeScore ?? "",
    away_score: report.awayScore ?? "",
    proposed_local_date: report.proposedScheduled?.localDate ?? "",
    proposed_local_time: report.proposedScheduled?.localTime ?? "",
    proposed_time_zone: report.proposedScheduled?.timeZone ?? "",
    proposed_field_name: report.proposedFieldName ?? "",
    note: report.note ?? "",
    submitted_by_email: report.submittedByEmail,
    reviewed_by_email: report.reviewedByEmail ?? "",
    decision_note: report.decisionNote ?? "",
    created_at: report.createdAt,
    reviewed_at: report.reviewedAt ?? "",
  }));
}

function activityRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  return (document.privateData?.activity ?? []).map((event) => ({
    record_id: event.id,
    created_at: event.createdAt,
    actor_role: event.actorRole,
    actor_email: event.actorEmail ?? "",
    type: event.type,
    summary: event.summary,
    team_id: event.teamId ?? "",
    game_id: event.gameId ?? "",
    details_json: event.details ? JSON.stringify(event.details) : "",
  }));
}

function standingsRows(document: LeagueDocumentV1): Array<Record<string, CellValue>> {
  const results = new Map(document.results.map((result) => [result.gameId, result]));
  return buildStandings(
    document.teams,
    document.games.map((game) => ({
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      result: results.get(game.id) ?? null,
      status: game.status,
    })),
    document.league.scoring,
  ).map((row, index) => ({
    position: index + 1,
    team_id: row.teamId,
    team_name: row.teamName,
    played: row.played,
    wins: row.wins,
    ties: row.ties,
    losses: row.losses,
    score_for: row.goalsFor,
    score_against: row.goalsAgainst,
    differential: row.goalDifferential,
    points: row.points,
  }));
}

async function preflightZip(bytes: Uint8Array): Promise<void> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdSize = 22;
  const searchStart = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw unreadableWorkbook();

  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (
    view.getUint16(eocd + 4, true) !== 0 ||
    view.getUint16(eocd + 6, true) !== 0 ||
    view.getUint16(eocd + 8, true) !== entryCount ||
    entryCount === 0xffff ||
    entryCount === 0 ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > MAX_ZIP_ENTRIES ||
    centralOffset + centralSize > eocd ||
    eocd + minimumEocdSize + commentLength > bytes.byteLength
  ) {
    throw new SpreadsheetImportError([
      { message: "The workbook archive is too large or uses unsupported ZIP64 metadata.", path: "workbook" },
    ]);
  }

  let offset = centralOffset;
  let uncompressedBytes = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw unreadableWorkbook();
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (
      flags & 0x0001 ||
      (compression !== 0 && compression !== 8) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff
    ) {
      throw new SpreadsheetImportError([
        { message: "The workbook archive uses unsupported encryption or compression.", path: "workbook" },
      ]);
    }
    if (
      localOffset === 0xffffffff ||
      localOffset + 30 > bytes.byteLength ||
      view.getUint32(localOffset, true) !== 0x04034b50 ||
      view.getUint16(localOffset + 8, true) !== compression
    ) {
      throw unreadableWorkbook();
    }
    const localFileNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localFileNameLength + localExtraLength;
    if (dataOffset + compressedSize > centralOffset) throw unreadableWorkbook();
    const actualSize = await inflatedEntrySize(
      bytes,
      dataOffset,
      compressedSize,
      compression,
      MAX_UNCOMPRESSED_BYTES - uncompressedBytes,
    );
    if (actualSize !== uncompressedSize) throw unreadableWorkbook();
    uncompressedBytes += actualSize;
    offset += 46 + fileNameLength + extraLength + commentLength;
    if (offset > centralOffset + centralSize || offset > bytes.byteLength) {
      throw unreadableWorkbook();
    }
  }
}

async function inflatedEntrySize(
  bytes: Uint8Array,
  offset: number,
  compressedSize: number,
  compression: number,
  remainingBytes: number,
): Promise<number> {
  if (compression === 0) {
    if (compressedSize > remainingBytes) throw expandedWorkbookTooLarge();
    return compressedSize;
  }

  const inflater = createInflateRaw();
  const compressed = Buffer.from(bytes.subarray(offset, offset + compressedSize));
  Readable.from([compressed]).pipe(inflater);
  let size = 0;
  try {
    for await (const chunk of inflater) {
      size += (chunk as Buffer).byteLength;
      if (size > remainingBytes) {
        inflater.destroy();
        throw expandedWorkbookTooLarge();
      }
    }
  } catch (error) {
    if (error instanceof SpreadsheetImportError) throw error;
    throw unreadableWorkbook();
  }
  return size;
}

function expandedWorkbookTooLarge(): SpreadsheetImportError {
  return new SpreadsheetImportError([
    { message: "The expanded workbook is too large.", path: "workbook" },
  ]);
}

function unreadableWorkbook(): SpreadsheetImportError {
  return new SpreadsheetImportError([
    { message: "The file is not a readable .xlsx workbook.", path: "workbook" },
  ]);
}

function preflightWorkbook(workbook: ExcelJS.Workbook) {
  let rows = 0;
  let cells = 0;
  if (workbook.worksheets.length > MAX_WORKSHEETS) {
    throw new SpreadsheetImportError([
      { message: `Workbook has more than ${MAX_WORKSHEETS} sheets.`, path: "workbook" },
    ]);
  }
  for (const sheet of workbook.worksheets) {
    rows += sheet.rowCount;
    if (sheet.columnCount > 200) {
      throw new SpreadsheetImportError([
        { message: "A worksheet contains more than 200 columns.", path: sheet.name },
      ]);
    }
    sheet.eachRow((row) => {
      cells += row.actualCellCount;
    });
  }
  if (rows > MAX_ROWS || cells > MAX_CELLS) {
    throw new SpreadsheetImportError([
      {
        message: `Workbook exceeds the ${MAX_ROWS} row or ${MAX_CELLS} cell limit.`,
        path: "workbook",
      },
    ]);
  }
}

function rejectFormulas(
  workbook: ExcelJS.Workbook,
  issues: SpreadsheetImportIssue[],
) {
  for (const sheet of workbook.worksheets) {
    if (issues.length >= MAX_IMPORT_ISSUES) break;
    sheet.eachRow((row, rowNumber) => {
      if (issues.length >= MAX_IMPORT_ISSUES) return;
      row.eachCell((cell, columnNumber) => {
        if (issues.length >= MAX_IMPORT_ISSUES) return;
        const value = cell.value;
        if (
          value &&
          typeof value === "object" &&
          ("formula" in value || "sharedFormula" in value)
        ) {
          issues.push({
            message: "Formula cells are not accepted. Replace the formula with a literal value.",
            path: `${sheet.name}!${rowNumber}:${columnNumber}`,
          });
        }
      });
    });
  }
}

function requiredSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  issues: SpreadsheetImportIssue[],
): Worksheet | null {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) issues.push({ message: `Missing required ${name} sheet.`, path: name });
  return sheet ?? null;
}

function rowsByHeader(
  sheet: Worksheet,
  name: string,
  requiredHeaders: readonly string[],
  issues: SpreadsheetImportIssue[],
): WorkbookRow[] {
  const headerRow = sheet.getRow(1);
  const headers = new Map<number, string>();
  const headerNames = new Set<string>();
  headerRow.eachCell((cell, column) => {
    if (issues.length >= MAX_IMPORT_ISSUES) return;
    if (typeof cell.value !== "string" || !cell.value.trim()) {
      issues.push({ message: "Every header must be plain text.", path: `${name}!1:${column}` });
    } else {
      const header = cell.value.trim();
      if (headerNames.has(header)) {
        issues.push({ message: `Duplicate ${header} header.`, path: `${name}!1:${column}` });
      } else {
        headerNames.add(header);
        headers.set(column, header);
      }
    }
  });
  for (const required of requiredHeaders) {
    if (!headerNames.has(required)) {
      issues.push({ message: `Missing required ${required} column.`, path: `${name}!1` });
    }
  }
  const rows: WorkbookRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (issues.length >= MAX_IMPORT_ISSUES) break;
    const row = sheet.getRow(rowNumber);
    if (!row.hasValues) continue;
    const values: Record<string, CellValue> = {};
    for (const [column, header] of headers) values[header] = row.getCell(column).value;
    rows.push({ rowNumber, values });
  }
  return rows;
}

function textValue(
  value: CellValue | undefined,
  path: string,
  issues: SpreadsheetImportIssue[],
): string {
  if (typeof value !== "string" || !value.trim()) {
    issues.push({ message: "Expected non-empty plain text.", path });
    return "";
  }
  return value.trim();
}

function nullableTextValue(
  value: CellValue | undefined,
  path: string,
  issues: SpreadsheetImportIssue[],
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    issues.push({ message: "Expected plain text, not an automatically coerced value.", path });
    return null;
  }
  return value.trim() || null;
}

function integerValue(
  value: CellValue | undefined,
  path: string,
  issues: SpreadsheetImportIssue[],
): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) {
    issues.push({ message: "Expected a non-negative whole number.", path });
    return 0;
  }
  return number;
}

function booleanValue(
  value: CellValue | undefined,
  path: string,
  issues: SpreadsheetImportIssue[],
): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized === "true" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "no" || normalized === "") {
      return false;
    }
  }
  if (value === null || value === undefined) return false;
  issues.push({ message: "Expected TRUE or FALSE.", path });
  return false;
}

function listValue(
  value: CellValue | undefined,
  path: string,
  issues: SpreadsheetImportIssue[],
): string[] {
  const text = nullableTextValue(value, path, issues);
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw new Error("invalid list");
    }
    return parsed.map((entry) => entry.trim());
  } catch {
    issues.push({ message: "Expected a JSON array of text values.", path });
    return [];
  }
}

function numberListValue(
  value: CellValue | undefined,
  path: string,
  issues: SpreadsheetImportIssue[],
): number[] {
  const text = nullableTextValue(value, path, issues);
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.some((entry) => !Number.isInteger(entry))) {
      throw new Error("invalid number list");
    }
    return parsed as number[];
  } catch {
    issues.push({ message: "Expected a JSON array of whole numbers.", path });
    return [];
  }
}

function solidFill(argb: string): ExcelJS.Fill {
  return { fgColor: { argb }, pattern: "solid", type: "pattern" };
}

function requireOrganizer(document: LeagueDocumentV1): LeagueDocumentV1 {
  const source = assertPortableDocument(document);
  if (source.export.scope !== "organizer-backup" || !source.privateData) {
    throw new Error("Spreadsheet operations require a complete organizer document.");
  }
  return source;
}
