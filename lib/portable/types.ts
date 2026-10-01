export const PORTABLE_FORMAT = "gameology.rec-league" as const;
export const PORTABLE_SCHEMA_VERSION = 1 as const;
export const PORTABLE_SCHEMA_URL =
  "https://gameology.space/schemas/rec-league/v1.json" as const;

export type PortableExportScope =
  | "organizer-backup"
  | "public-snapshot"
  | "spreadsheet-operations"
  | "team-manager-packet";

export type PortableSourceMode = "connected" | "local-only";

export type PortableExportMetadata = {
  appVersion: string;
  containsPrivateData: boolean;
  exportedAt: string;
  scope: PortableExportScope;
  source: PortableSourceMode;
};

export type PortableScheduleSettings = {
  durationMinutes: number;
  fields: string[];
  startDate: string | null;
  startTimes: string[];
  weekdays: number[];
};

export type PortableLeague = {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  name: string;
  publicUpdatedAt: string;
  schedule: PortableScheduleSettings;
  scoring: {
    lossPoints: number;
    showStandings: boolean;
    tiePoints: number;
    winPoints: number;
  };
  seasonLabel: string | null;
  slug: string;
  sport: string | null;
  timeZone: string;
  updatedAt: string;
  venue: {
    address: string | null;
    name: string | null;
    url: string | null;
  };
  version: number;
};

export type PortableTeam = {
  createdAt: string;
  id: string;
  name: string;
  updatedAt: string;
  version: number;
};

export type PortableScheduledInstant = {
  localDate: string;
  localTime: string;
  timeZone: string;
  utc: string;
};

export type PortableGameStatus =
  | "COMPLETED"
  | "RAINED_OUT"
  | "RESCHEDULED"
  | "SCHEDULED";

export type PortableGame = {
  awayTeamId: string;
  createdAt: string;
  fieldName: string | null;
  homeTeamId: string;
  id: string;
  locked: boolean;
  round: number;
  scheduled: PortableScheduledInstant | null;
  status: PortableGameStatus;
  updatedAt: string;
  version: number;
};

export type PortableResult = {
  awayScore: number;
  gameId: string;
  homeScore: number;
  id: string;
  submittedAt: string;
  updatedAt: string;
  version: number;
};

export type PortableManagerReference = {
  acceptedAt: string | null;
  createdAt: string;
  email: string;
  id: string;
  teamId: string;
  updatedAt: string;
  version: number;
};

export type PortableReportType = "RAINOUT" | "RESCHEDULE" | "SCORE";
export type PortableReportStatus = "APPROVED" | "PENDING" | "REJECTED";

export type PortableGameReport = {
  awayScore: number | null;
  createdAt: string;
  decisionNote: string | null;
  gameId: string;
  gameVersion: number;
  homeScore: number | null;
  id: string;
  note: string | null;
  proposedFieldName: string | null;
  proposedScheduled: PortableScheduledInstant | null;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
  status: PortableReportStatus;
  submittedByEmail: string;
  teamId: string;
  type: PortableReportType;
  updatedAt: string;
  version: number;
};

export type PortableActivityActorRole =
  | "IMPORT"
  | "MANAGER"
  | "ORGANIZER"
  | "SYSTEM"
  | "UNKNOWN";

export type PortableJsonValue =
  | boolean
  | null
  | number
  | string
  | PortableJsonValue[]
  | { [key: string]: PortableJsonValue };

export type PortableActivity = {
  actorEmail: string | null;
  actorRole: PortableActivityActorRole;
  createdAt: string;
  details: Record<string, PortableJsonValue> | null;
  gameId: string | null;
  id: string;
  summary: string;
  teamId: string | null;
  type: string;
};

export type PortablePrivateData = {
  activity: PortableActivity[];
  managers: PortableManagerReference[];
  organizerContactEmail: string | null;
  reports: PortableGameReport[];
};

export type PortableTeamPacketReport = Omit<
  PortableGameReport,
  "reviewedByEmail" | "submittedByEmail"
>;

export type PortableTeamPacket = {
  reports: PortableTeamPacketReport[];
  teamId: string;
};

export type PortableOperationBase = {
  baseRevision: number;
  clientId: string;
  createdAt: string;
  operationId: string;
};

export type PortableOperation =
  | (PortableOperationBase & {
      kind: "ADD_TEAM";
      payload: { name: string; proposedTeamId: string };
    })
  | (PortableOperationBase & {
      kind: "ARCHIVE_LEAGUE";
      payload: { archived: boolean; expectedLeagueVersion: number };
    })
  | (PortableOperationBase & {
      kind: "MARK_RAINOUT";
      payload: { expectedGameVersion: number; gameId: string };
    })
  | (PortableOperationBase & {
      kind: "REMOVE_TEAM";
      payload: { expectedTeamVersion: number; teamId: string };
    })
  | (PortableOperationBase & {
      kind: "RENAME_TEAM";
      payload: { expectedTeamVersion: number; name: string; teamId: string };
    })
  | (PortableOperationBase & {
      kind: "RESCHEDULE_GAME";
      payload: {
        expectedGameVersion: number;
        fieldName: string | null;
        gameId: string;
        scheduled: PortableScheduledInstant;
      };
    })
  | (PortableOperationBase & {
      kind: "REVIEW_REPORT";
      payload: {
        decision: "APPROVE" | "REJECT";
        decisionNote: string | null;
        expectedReportVersion: number;
        reportId: string;
      };
    })
  | (PortableOperationBase & {
      kind: "SET_SCORE";
      payload: {
        awayScore: number;
        expectedGameVersion: number;
        gameId: string;
        homeScore: number;
      };
    })
  | (PortableOperationBase & {
      kind: "SUBMIT_REPORT";
      payload: {
        awayScore: number | null;
        expectedGameVersion: number;
        gameId: string;
        homeScore: number | null;
        note: string | null;
        proposedFieldName: string | null;
        proposedScheduled: PortableScheduledInstant | null;
        reportType: PortableReportType;
        teamId: string;
      };
    })
  | (PortableOperationBase & {
      kind: "UPDATE_LEAGUE";
      payload: {
        changes: Partial<{
          name: string;
          schedule: PortableScheduleSettings;
          scoring: PortableLeague["scoring"];
          seasonLabel: string | null;
          sport: string | null;
          timeZone: string;
          venue: PortableLeague["venue"];
        }>;
        expectedLeagueVersion: number;
      };
    });

export type PortableSyncState = {
  clientId: string;
  lastSyncedRevision: number | null;
  mode: PortableSourceMode;
  pendingOperations: PortableOperation[];
};

export type LeagueDocumentV1 = {
  $schema: typeof PORTABLE_SCHEMA_URL;
  dataRevision: number;
  documentId: string;
  export: PortableExportMetadata;
  format: typeof PORTABLE_FORMAT;
  games: PortableGame[];
  league: PortableLeague;
  privateData?: PortablePrivateData;
  results: PortableResult[];
  schemaVersion: typeof PORTABLE_SCHEMA_VERSION;
  sync?: PortableSyncState;
  teamPacket?: PortableTeamPacket;
  teams: PortableTeam[];
};
