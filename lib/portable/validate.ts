import { findGameConflict } from "../game-conflicts";
import { zonedDateTimeToUtc } from "../schedule";
import { parseStrictJson, parseStrictJsonBytes, StrictJsonError } from "./json-parser";
import { leagueDocumentV1Schema } from "./schema";
import {
  PORTABLE_FORMAT,
  PORTABLE_SCHEMA_VERSION,
  type LeagueDocumentV1,
  type PortableGame,
  type PortableGameReport,
  type PortableOperation,
  type PortableScheduledInstant,
  type PortableTeamPacketReport,
} from "./types";

export type PortableIssueCode =
  | "duplicate"
  | "invalid-json"
  | "invalid-reference"
  | "invalid-schedule"
  | "invalid-state"
  | "invalid-structure"
  | "scope-violation"
  | "unsupported-version";

export type PortableIssue = {
  code: PortableIssueCode;
  message: string;
  path: string;
};

export type PortableValidationResult =
  | { document: LeagueDocumentV1; issues: []; success: true }
  | { issues: PortableIssue[]; success: false };

export class PortableDocumentValidationError extends Error {
  constructor(readonly issues: PortableIssue[]) {
    super(issues[0]?.message ?? "The portable league document is invalid.");
    this.name = "PortableDocumentValidationError";
  }

  get isNewerVersion(): boolean {
    return this.issues.some((issue) => issue.code === "unsupported-version");
  }
}

export function parsePortableDocument(text: string): LeagueDocumentV1 {
  let value: unknown;
  try {
    value = parseStrictJson(text);
  } catch (error) {
    throw strictJsonValidationError(error);
  }
  return assertPortableDocument(value);
}

export function parsePortableDocumentBytes(bytes: Uint8Array): LeagueDocumentV1 {
  let value: unknown;
  try {
    value = parseStrictJsonBytes(bytes);
  } catch (error) {
    throw strictJsonValidationError(error);
  }
  return assertPortableDocument(value);
}

export function assertPortableDocument(value: unknown): LeagueDocumentV1 {
  const result = validatePortableDocument(value);
  if (!result.success) throw new PortableDocumentValidationError(result.issues);
  return result.document;
}

export function validatePortableDocument(value: unknown): PortableValidationResult {
  const versionIssue = inspectVersion(value);
  if (versionIssue) return { issues: [versionIssue], success: false };

  const parsed = leagueDocumentV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.flatMap((issue) =>
        issue.code === "unrecognized_keys"
          ? issue.keys.map((key) => ({
              code: "invalid-structure" as const,
              message: `Unrecognized key: ${JSON.stringify(key)}`,
              path: `${formatPath(issue.path)}[${JSON.stringify(key)}]`,
            }))
          : [
              {
                code: "invalid-structure" as const,
                message: issue.message,
                path: formatPath(issue.path),
              },
            ],
      ),
      success: false,
    };
  }

  const issues = validateDomain(parsed.data);
  return issues.length
    ? { issues, success: false }
    : { document: parsed.data, issues: [], success: true };
}

function validateDomain(document: LeagueDocumentV1): PortableIssue[] {
  const issues: PortableIssue[] = [];
  const add = (code: PortableIssueCode, path: string, message: string) => {
    issues.push({ code, message, path });
  };

  if (document.documentId !== document.league.id) {
    add(
      "invalid-reference",
      "$.documentId",
      "documentId must match league.id.",
    );
  }

  validateScope(document, add);
  if (
    document.export.scope !== "team-manager-packet" &&
    document.teams.length < 2
  ) {
    add(
      "invalid-state",
      "$.teams",
      "A league document needs at least two teams.",
    );
  }
  validateUniqueRecords(document, add);

  const teamIds = new Set(document.teams.map((team) => team.id));
  const gameIds = new Set(document.games.map((game) => game.id));
  const gamesById = new Map(document.games.map((game) => [game.id, game]));
  const resultsByGame = new Map<string, number>();

  const normalizedNames = new Map<string, number>();
  document.teams.forEach((team, index) => {
    const normalized = team.name.trim().toLocaleLowerCase();
    const earlier = normalizedNames.get(normalized);
    if (earlier !== undefined) {
      add(
        "duplicate",
        `$.teams[${index}].name`,
        `Team name duplicates teams[${earlier}].name when case and surrounding spaces are ignored.`,
      );
    } else {
      normalizedNames.set(normalized, index);
    }
    validateTimestampOrder(
      team.createdAt,
      team.updatedAt,
      `$.teams[${index}]`,
      add,
    );
  });

  validateScheduleSettings(document, add);
  validateTimestampOrder(
    document.league.createdAt,
    document.league.updatedAt,
    "$.league",
    add,
  );

  document.games.forEach((game, index) => {
    const path = `$.games[${index}]`;
    if (!teamIds.has(game.homeTeamId)) {
      add("invalid-reference", `${path}.homeTeamId`, "Home team does not exist.");
    }
    if (!teamIds.has(game.awayTeamId)) {
      add("invalid-reference", `${path}.awayTeamId`, "Away team does not exist.");
    }
    if (game.homeTeamId === game.awayTeamId) {
      add("invalid-state", path, "A team cannot play itself.");
    }
    if (game.locked && game.status !== "COMPLETED") {
      add("invalid-state", `${path}.locked`, "Only a completed game can be locked.");
    }
    if (game.scheduled) {
      validateScheduledInstant(
        game.scheduled,
        `${path}.scheduled`,
        document.league.timeZone,
        add,
      );
    }
    validateTimestampOrder(game.createdAt, game.updatedAt, path, add);
  });

  document.results.forEach((result, index) => {
    const path = `$.results[${index}]`;
    const duplicateForGame = resultsByGame.get(result.gameId);
    if (duplicateForGame !== undefined) {
      add(
        "duplicate",
        `${path}.gameId`,
        `A result already exists for this game at results[${duplicateForGame}].`,
      );
    } else {
      resultsByGame.set(result.gameId, index);
    }
    if (!gameIds.has(result.gameId)) {
      add("invalid-reference", `${path}.gameId`, "Result game does not exist.");
    }
    const game = gamesById.get(result.gameId);
    if (game && game.status !== "COMPLETED") {
      add(
        "invalid-state",
        `${path}.gameId`,
        "Official results may only belong to completed games.",
      );
    }
    validateTimestampOrder(result.submittedAt, result.updatedAt, path, add);
  });

  document.games.forEach((game, index) => {
    if (game.status === "COMPLETED" && !resultsByGame.has(game.id)) {
      add(
        "invalid-state",
        `$.games[${index}].status`,
        "A completed game must have one official result.",
      );
    }
  });

  validateGameConflicts(document.games, document.league.schedule.durationMinutes, add);

  const reports = document.privateData?.reports ?? [];
  validateReports(reports, "$.privateData.reports", document.games, teamIds, add);

  const packetReports = document.teamPacket?.reports ?? [];
  validateReports(
    packetReports,
    "$.teamPacket.reports",
    document.games,
    teamIds,
    add,
  );

  const managerKeys = new Map<string, number>();
  document.privateData?.managers.forEach((manager, index) => {
    const path = `$.privateData.managers[${index}]`;
    if (!teamIds.has(manager.teamId)) {
      add("invalid-reference", `${path}.teamId`, "Manager team does not exist.");
    }
    const key = `${manager.teamId}\u0000${manager.email.toLocaleLowerCase()}`;
    const earlier = managerKeys.get(key);
    if (earlier !== undefined) {
      add(
        "duplicate",
        path,
        `This team and email duplicate privateData.managers[${earlier}].`,
      );
    } else {
      managerKeys.set(key, index);
    }
    validateTimestampOrder(manager.createdAt, manager.updatedAt, path, add);
  });

  // Activity references are historical labels, not live foreign keys. A team or
  // game may have been deliberately removed after an event was recorded.

  if (document.teamPacket) {
    validateTeamPacket(document, teamIds, add);
  }

  const operationIds = new Map<string, number>();
  if (document.sync) {
    if (document.sync.mode !== document.export.source) {
      add(
        "invalid-state",
        "$.sync.mode",
        "Synchronization mode must match the document source mode.",
      );
    }
    if (
      document.sync.lastSyncedRevision !== null &&
      document.sync.lastSyncedRevision > document.dataRevision
    ) {
      add(
        "invalid-state",
        "$.sync.lastSyncedRevision",
        "The last synchronized revision cannot be newer than the document revision.",
      );
    }
    if (
      document.sync.mode === "local-only" &&
      document.sync.lastSyncedRevision !== null
    ) {
      add(
        "invalid-state",
        "$.sync.lastSyncedRevision",
        "A local-only document has no server revision.",
      );
    }
  }
  document.sync?.pendingOperations.forEach((operation, index) => {
    const path = `$.sync.pendingOperations[${index}]`;
    const earlier = operationIds.get(operation.operationId);
    if (earlier !== undefined) {
      add(
        "duplicate",
        `${path}.operationId`,
        `Operation ID duplicates sync.pendingOperations[${earlier}].operationId.`,
      );
    } else {
      operationIds.set(operation.operationId, index);
    }
    if (operation.clientId !== document.sync?.clientId) {
      add(
        "invalid-state",
        `${path}.clientId`,
        "Operation clientId must match sync.clientId.",
      );
    }
    validateOperationSemantics(
      operation,
      path,
      add,
    );
  });

  return issues;
}

function validateScope(
  document: LeagueDocumentV1,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  const scope = document.export.scope;

  if (scope === "organizer-backup") {
    if (!document.privateData) {
      add(
        "scope-violation",
        "$.privateData",
        "An organizer backup must include its privateData section, even when the lists are empty.",
      );
    }
    if (document.teamPacket) {
      add(
        "scope-violation",
        "$.teamPacket",
        "An organizer backup cannot also be a team-manager packet.",
      );
    }
    if (!document.export.containsPrivateData) {
      add(
        "scope-violation",
        "$.export.containsPrivateData",
        "Organizer backups must be labelled as containing private data.",
      );
    }
    return;
  }

  if (document.privateData) {
    add(
      "scope-violation",
      "$.privateData",
      `The ${scope} scope cannot contain organizer private data.`,
    );
  }
  if (document.sync && scope !== "team-manager-packet") {
    add(
      "scope-violation",
      "$.sync",
      `The ${scope} scope cannot contain synchronization state.`,
    );
  }

  if (scope === "team-manager-packet") {
    if (!document.teamPacket) {
      add(
        "scope-violation",
        "$.teamPacket",
        "A team-manager packet must identify its team and reports.",
      );
    }
    if (!document.export.containsPrivateData) {
      add(
        "scope-violation",
        "$.export.containsPrivateData",
        "Team-manager packets may contain private notes and must be labelled private.",
      );
    }
    return;
  }

  if (document.teamPacket) {
    add(
      "scope-violation",
      "$.teamPacket",
      `The ${scope} scope cannot contain a team packet.`,
    );
  }
  if (document.export.containsPrivateData) {
    add(
      "scope-violation",
      "$.export.containsPrivateData",
      `The ${scope} scope must be labelled as public-safe.`,
    );
  }
}

function validateUniqueRecords(
  document: LeagueDocumentV1,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  const collections: Array<[string, Array<{ id: string }>]> = [
    ["teams", document.teams],
    ["games", document.games],
    ["results", document.results],
    ["privateData.managers", document.privateData?.managers ?? []],
    ["privateData.reports", document.privateData?.reports ?? []],
    ["privateData.activity", document.privateData?.activity ?? []],
    ["teamPacket.reports", document.teamPacket?.reports ?? []],
  ];

  for (const [name, records] of collections) {
    const seen = new Map<string, number>();
    records.forEach((record, index) => {
      const earlier = seen.get(record.id);
      if (earlier !== undefined) {
        add(
          "duplicate",
          `$.${name}[${index}].id`,
          `ID duplicates ${name}[${earlier}].id.`,
        );
      } else {
        seen.set(record.id, index);
      }
    });
  }
}

function validateScheduleSettings(
  document: LeagueDocumentV1,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  const settings = document.league.schedule;
  validateUniquePrimitiveArray(settings.weekdays, "$.league.schedule.weekdays", add);
  validateUniquePrimitiveArray(settings.startTimes, "$.league.schedule.startTimes", add);

  const fields = new Map<string, number>();
  settings.fields.forEach((field, index) => {
    const normalized = field.trim().toLocaleLowerCase();
    const earlier = fields.get(normalized);
    if (earlier !== undefined) {
      add(
        "duplicate",
        `$.league.schedule.fields[${index}]`,
        `Field duplicates fields[${earlier}] when case and spaces are ignored.`,
      );
    } else {
      fields.set(normalized, index);
    }
  });

  const hasAnyRhythm = Boolean(
    settings.startDate || settings.weekdays.length || settings.startTimes.length,
  );
  const hasCompleteRhythm = Boolean(
    settings.startDate && settings.weekdays.length && settings.startTimes.length,
  );
  if (hasAnyRhythm && !hasCompleteRhythm) {
    add(
      "invalid-state",
      "$.league.schedule",
      "A schedule rhythm needs a start date, at least one weekday, and at least one start time.",
    );
  }
}

function validateScheduledInstant(
  scheduled: PortableScheduledInstant,
  path: string,
  expectedTimeZone: string,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  if (scheduled.timeZone !== expectedTimeZone) {
    add(
      "invalid-schedule",
      `${path}.timeZone`,
      "Scheduled time zone must match the league time zone.",
    );
    return;
  }

  try {
    const derived = zonedDateTimeToUtc(
      scheduled.localDate,
      scheduled.localTime,
      scheduled.timeZone,
    );
    if (derived.getTime() !== new Date(scheduled.utc).getTime()) {
      add(
        "invalid-schedule",
        `${path}.utc`,
        "UTC does not match the local date, time, and time zone.",
      );
    }
  } catch {
    add(
      "invalid-schedule",
      path,
      "This local date and time does not exist in the selected time zone.",
    );
  }
}

function validateGameConflicts(
  games: PortableGame[],
  durationMinutes: number,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  const scheduled = games
    .map((game, index) => ({ game, index }))
    .filter(
      (entry): entry is { game: PortableGame & { scheduled: PortableScheduledInstant }; index: number } =>
        Boolean(entry.game.scheduled) && entry.game.status !== "RAINED_OUT",
    )
    .sort(
      (left, right) =>
        Date.parse(left.game.scheduled.utc) - Date.parse(right.game.scheduled.utc),
    );
  let active: typeof scheduled = [];
  const durationMs = durationMinutes * 60_000;

  scheduled.forEach(({ game, index }) => {
    const startsAt = Date.parse(game.scheduled.utc);
    active = active.filter(
      (entry) => Date.parse(entry.game.scheduled.utc) + durationMs > startsAt,
    );
    const conflict = findGameConflict(
      {
        awayTeamId: game.awayTeamId,
        fieldName: game.fieldName,
        homeTeamId: game.homeTeamId,
        id: game.id,
        scheduledAt: new Date(game.scheduled.utc),
      },
      active.map(({ game: candidate }) => ({
        awayTeamId: candidate.awayTeamId,
        fieldName: candidate.fieldName,
        homeTeamId: candidate.homeTeamId,
        id: candidate.id,
        scheduledAt: new Date(candidate.scheduled.utc),
        status: candidate.status,
      })),
      durationMinutes,
    );
    if (conflict) {
      add(
        "invalid-schedule",
        `$.games[${index}].scheduled`,
        `Game overlaps game ${conflict.id} for a team or field.`,
      );
    }
    active.push({ game, index });
  });
}

function validateReports(
  reports: Array<PortableGameReport | PortableTeamPacketReport>,
  basePath: string,
  games: PortableGame[],
  teamIds: Set<string>,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const pendingKeys = new Map<string, number>();

  reports.forEach((report, index) => {
    const path = `${basePath}[${index}]`;
    const game = gamesById.get(report.gameId);
    if (!game) {
      add("invalid-reference", `${path}.gameId`, "Report game does not exist.");
    }
    if (!teamIds.has(report.teamId)) {
      add("invalid-reference", `${path}.teamId`, "Report team does not exist.");
    }
    if (
      game &&
      report.teamId !== game.homeTeamId &&
      report.teamId !== game.awayTeamId
    ) {
      add(
        "invalid-reference",
        `${path}.teamId`,
        "The reporting team is not part of this game.",
      );
    }

    if (report.type === "SCORE") {
      if (report.homeScore === null || report.awayScore === null) {
        add("invalid-state", path, "A score report needs both scores.");
      }
      if (report.proposedScheduled || report.proposedFieldName) {
        add("invalid-state", path, "A score report cannot propose a schedule change.");
      }
    } else if (report.homeScore !== null || report.awayScore !== null) {
      add("invalid-state", path, "Only a score report may contain scores.");
    }

    if (report.type === "RESCHEDULE") {
      if (!report.proposedScheduled) {
        add("invalid-state", path, "A reschedule report needs a proposed date and time.");
      } else {
        validateScheduledInstant(
          report.proposedScheduled,
          `${path}.proposedScheduled`,
          report.proposedScheduled.timeZone,
          add,
        );
      }
    } else if (report.proposedScheduled || report.proposedFieldName) {
      add("invalid-state", path, "Only a reschedule report may contain a proposed slot.");
    }

    if (report.status === "PENDING") {
      if (report.reviewedAt || report.decisionNote) {
        add("invalid-state", path, "A pending report cannot contain review details.");
      }
      if ("reviewedByEmail" in report && report.reviewedByEmail) {
        add("invalid-state", path, "A pending report cannot have a reviewer.");
      }
      const key = `${report.gameId}\u0000${report.teamId}\u0000${report.type}`;
      const earlier = pendingKeys.get(key);
      if (earlier !== undefined) {
        add(
          "duplicate",
          path,
          `A pending report for this game, team, and type already exists at ${basePath}[${earlier}].`,
        );
      } else {
        pendingKeys.set(key, index);
      }
    } else {
      if (!report.reviewedAt) {
        add("invalid-state", `${path}.reviewedAt`, "A reviewed report needs reviewedAt.");
      }
      // Replaced manager reports predate an organizer decision and therefore
      // legitimately have no reviewedByEmail value.
    }

    validateTimestampOrder(report.createdAt, report.updatedAt, path, add);
  });
}

function validateTeamPacket(
  document: LeagueDocumentV1,
  teamIds: Set<string>,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  const packet = document.teamPacket;
  if (!packet) return;
  if (!teamIds.has(packet.teamId)) {
    add("invalid-reference", "$.teamPacket.teamId", "Packet team does not exist.");
  }
  document.games.forEach((game, index) => {
    if (game.homeTeamId !== packet.teamId && game.awayTeamId !== packet.teamId) {
      add(
        "scope-violation",
        `$.games[${index}]`,
        "A team-manager packet may contain only games involving its team.",
      );
    }
  });
  packet.reports.forEach((report, index) => {
    if (report.teamId !== packet.teamId) {
      add(
        "scope-violation",
        `$.teamPacket.reports[${index}].teamId`,
        "A team-manager packet may contain only its team's reports.",
      );
    }
  });
  document.sync?.pendingOperations.forEach((operation, index) => {
    if (
      operation.kind !== "SUBMIT_REPORT" ||
      operation.payload.teamId !== packet.teamId
    ) {
      add(
        "scope-violation",
        `$.sync.pendingOperations[${index}]`,
        "A team-manager packet may queue only reports for its assigned team.",
      );
    }
  });
}

function validateOperationSemantics(
  operation: PortableOperation,
  path: string,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  if (operation.kind === "RESCHEDULE_GAME") {
    validateScheduledInstant(
      operation.payload.scheduled,
      `${path}.payload.scheduled`,
      operation.payload.scheduled.timeZone,
      add,
    );
  }
  if (operation.kind !== "SUBMIT_REPORT") return;

  const payload = operation.payload;
  if (
    payload.reportType === "SCORE" &&
    (payload.homeScore === null || payload.awayScore === null)
  ) {
    add("invalid-state", `${path}.payload`, "A score report needs both scores.");
  }
  if (
    payload.reportType !== "SCORE" &&
    (payload.homeScore !== null || payload.awayScore !== null)
  ) {
    add(
      "invalid-state",
      `${path}.payload`,
      "Only a score report may contain scores.",
    );
  }
  if (payload.reportType === "RESCHEDULE") {
    if (!payload.proposedScheduled) {
      add(
        "invalid-state",
        `${path}.payload.proposedScheduled`,
        "A reschedule report needs a proposed date and time.",
      );
    } else {
      validateScheduledInstant(
        payload.proposedScheduled,
        `${path}.payload.proposedScheduled`,
        payload.proposedScheduled.timeZone,
        add,
      );
    }
  } else if (payload.proposedScheduled || payload.proposedFieldName) {
    add(
      "invalid-state",
      `${path}.payload`,
      "Only a reschedule report may contain a proposed slot.",
    );
  }
}

function validateUniquePrimitiveArray(
  values: Array<number | string>,
  path: string,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  const seen = new Map<number | string, number>();
  values.forEach((value, index) => {
    const earlier = seen.get(value);
    if (earlier !== undefined) {
      add("duplicate", `${path}[${index}]`, `Value duplicates ${path}[${earlier}].`);
    } else {
      seen.set(value, index);
    }
  });
}

function validateTimestampOrder(
  createdAt: string,
  updatedAt: string,
  path: string,
  add: (code: PortableIssueCode, path: string, message: string) => void,
) {
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    add(
      "invalid-state",
      `${path}.updatedAt`,
      "updatedAt cannot be earlier than the record's creation/submission time.",
    );
  }
}

function inspectVersion(value: unknown): PortableIssue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.format !== undefined && candidate.format !== PORTABLE_FORMAT) {
    return {
      code: "invalid-structure",
      message: `Expected format ${PORTABLE_FORMAT}.`,
      path: "$.format",
    };
  }
  if (
    typeof candidate.schemaVersion === "number" &&
    candidate.schemaVersion > PORTABLE_SCHEMA_VERSION
  ) {
    return {
      code: "unsupported-version",
      message: `This file uses schema version ${candidate.schemaVersion}. Upgrade the app before editing it; this version supports through ${PORTABLE_SCHEMA_VERSION}.`,
      path: "$.schemaVersion",
    };
  }
  return null;
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${segment}]`;
    return `${formatted}[${JSON.stringify(String(segment))}]`;
  }, "$" );
}

function strictJsonValidationError(error: unknown): PortableDocumentValidationError {
  if (error instanceof StrictJsonError) {
    return new PortableDocumentValidationError([
      {
        code: error.message.startsWith("Duplicate object key")
          ? "duplicate"
          : "invalid-json",
        message: error.message,
        path: error.path,
      },
    ]);
  }
  return new PortableDocumentValidationError([
    { code: "invalid-json", message: "The file is not valid JSON.", path: "$" },
  ]);
}
