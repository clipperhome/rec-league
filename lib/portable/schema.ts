import { z } from "zod";

import {
  PORTABLE_FORMAT,
  PORTABLE_SCHEMA_URL,
  PORTABLE_SCHEMA_VERSION,
  type LeagueDocumentV1,
  type PortableJsonValue,
} from "./types";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const idSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(ID_PATTERN, "Use a stable ID containing letters, numbers, '.', '_', ':', or '-'.");
const operationIdentitySchema = idSchema.refine((value) => value.length >= 16, {
  message: "Use a high-entropy identifier with at least 16 characters.",
});
const recordVersionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const singleLineSchema = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
      message: "Control characters are not allowed.",
    });
const nonBlankSingleLineSchema = (maximum: number) =>
  singleLineSchema(maximum).refine((value) => value.trim().length > 0, {
    message: "Enter at least one visible character.",
  });
const noteSchema = z
  .string()
  .max(2_000)
  .refine((value) => !/[\u0000\u000b\u000c\u007f]/u.test(value), {
    message: "Unsupported control characters are not allowed.",
  });
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const dateSchema = z
  .string()
  .regex(DATE_PATTERN, "Use a YYYY-MM-DD date.")
  .refine(isRealCalendarDate, "Use a real calendar date.");
const timeSchema = z.string().regex(TIME_PATTERN, "Use a 24-hour HH:mm time.");
const utcTimestampSchema = z
  .string()
  .regex(UTC_PATTERN, "Use an RFC 3339 UTC timestamp ending in Z.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Use a real UTC timestamp.");
const nullableUtcTimestampSchema = utcTimestampSchema.nullable();
const timeZoneSchema = singleLineSchema(100).refine(isIanaTimeZone, {
  message: "Use a valid IANA time zone.",
});
const safeUrlSchema = z
  .string()
  .max(2_048)
  .refine(isSafeHttpUrl, "Only http:// and https:// links are allowed.");

export const portableScheduledInstantSchema = z.strictObject({
  localDate: dateSchema,
  localTime: timeSchema,
  timeZone: timeZoneSchema,
  utc: utcTimestampSchema,
});

export const portableScheduleSettingsSchema = z.strictObject({
  durationMinutes: z.number().int().min(5).max(24 * 60),
  fields: z.array(nonBlankSingleLineSchema(80)).max(100),
  startDate: dateSchema.nullable(),
  startTimes: z.array(timeSchema).max(100),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
});

const scoringSchema = z.strictObject({
  lossPoints: z.number().int().min(0).max(99),
  showStandings: z.boolean(),
  tiePoints: z.number().int().min(0).max(99),
  winPoints: z.number().int().min(0).max(99),
});

const venueSchema = z.strictObject({
  address: singleLineSchema(180).nullable(),
  name: singleLineSchema(80).nullable(),
  url: safeUrlSchema.nullable(),
});

export const portableLeagueSchema = z.strictObject({
  archivedAt: nullableUtcTimestampSchema,
  createdAt: utcTimestampSchema,
  id: idSchema,
  name: nonBlankSingleLineSchema(80),
  publicUpdatedAt: utcTimestampSchema,
  schedule: portableScheduleSettingsSchema,
  scoring: scoringSchema,
  seasonLabel: singleLineSchema(60).nullable(),
  slug: z.string().min(1).max(100).regex(SLUG_PATTERN),
  sport: singleLineSchema(60).nullable(),
  timeZone: timeZoneSchema,
  updatedAt: utcTimestampSchema,
  venue: venueSchema,
  version: recordVersionSchema,
});

export const portableTeamSchema = z.strictObject({
  createdAt: utcTimestampSchema,
  id: idSchema,
  name: nonBlankSingleLineSchema(80),
  updatedAt: utcTimestampSchema,
  version: recordVersionSchema,
});

const gameStatusSchema = z.enum([
  "COMPLETED",
  "RAINED_OUT",
  "RESCHEDULED",
  "SCHEDULED",
]);

export const portableGameSchema = z.strictObject({
  awayTeamId: idSchema,
  createdAt: utcTimestampSchema,
  fieldName: singleLineSchema(80).nullable(),
  homeTeamId: idSchema,
  id: idSchema,
  locked: z.boolean(),
  round: z.number().int().min(1).max(100_000),
  scheduled: portableScheduledInstantSchema.nullable(),
  status: gameStatusSchema,
  updatedAt: utcTimestampSchema,
  version: recordVersionSchema,
});

export const portableResultSchema = z.strictObject({
  awayScore: z.number().int().min(0).max(999),
  gameId: idSchema,
  homeScore: z.number().int().min(0).max(999),
  id: idSchema,
  submittedAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
  version: recordVersionSchema,
});

export const portableManagerSchema = z.strictObject({
  acceptedAt: nullableUtcTimestampSchema,
  createdAt: utcTimestampSchema,
  email: emailSchema,
  id: idSchema,
  teamId: idSchema,
  updatedAt: utcTimestampSchema,
  version: recordVersionSchema,
});

const reportTypeSchema = z.enum(["RAINOUT", "RESCHEDULE", "SCORE"]);
const reportStatusSchema = z.enum(["APPROVED", "PENDING", "REJECTED"]);

const reportCommonShape = {
  awayScore: z.number().int().min(0).max(999).nullable(),
  createdAt: utcTimestampSchema,
  decisionNote: noteSchema.nullable(),
  gameId: idSchema,
  gameVersion: recordVersionSchema,
  homeScore: z.number().int().min(0).max(999).nullable(),
  id: idSchema,
  note: noteSchema.nullable(),
  proposedFieldName: singleLineSchema(80).nullable(),
  proposedScheduled: portableScheduledInstantSchema.nullable(),
  reviewedAt: nullableUtcTimestampSchema,
  status: reportStatusSchema,
  teamId: idSchema,
  type: reportTypeSchema,
  updatedAt: utcTimestampSchema,
  version: recordVersionSchema,
};

export const portableGameReportSchema = z.strictObject({
  ...reportCommonShape,
  reviewedByEmail: emailSchema.nullable(),
  submittedByEmail: emailSchema,
});

export const portableTeamPacketReportSchema = z.strictObject(reportCommonShape);

const jsonValueSchema: z.ZodType<PortableJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const portableActivitySchema = z.strictObject({
  actorEmail: emailSchema.nullable(),
  actorRole: z.enum(["IMPORT", "MANAGER", "ORGANIZER", "SYSTEM", "UNKNOWN"]),
  createdAt: utcTimestampSchema,
  details: z.record(z.string(), jsonValueSchema).nullable(),
  gameId: idSchema.nullable(),
  id: idSchema,
  summary: nonBlankSingleLineSchema(500),
  teamId: idSchema.nullable(),
  type: nonBlankSingleLineSchema(100),
});

const operationBaseShape = {
  baseRevision: revisionSchema,
  clientId: operationIdentitySchema,
  createdAt: utcTimestampSchema,
  operationId: operationIdentitySchema,
};

const operationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("ADD_TEAM"),
    payload: z.strictObject({
      name: nonBlankSingleLineSchema(80),
      proposedTeamId: idSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("ARCHIVE_LEAGUE"),
    payload: z.strictObject({
      archived: z.boolean(),
      expectedLeagueVersion: recordVersionSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("MARK_RAINOUT"),
    payload: z.strictObject({
      expectedGameVersion: recordVersionSchema,
      gameId: idSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("REMOVE_TEAM"),
    payload: z.strictObject({
      expectedTeamVersion: recordVersionSchema,
      teamId: idSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("RENAME_TEAM"),
    payload: z.strictObject({
      expectedTeamVersion: recordVersionSchema,
      name: nonBlankSingleLineSchema(80),
      teamId: idSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("RESCHEDULE_GAME"),
    payload: z.strictObject({
      expectedGameVersion: recordVersionSchema,
      fieldName: singleLineSchema(80).nullable(),
      gameId: idSchema,
      scheduled: portableScheduledInstantSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("REVIEW_REPORT"),
    payload: z.strictObject({
      decision: z.enum(["APPROVE", "REJECT"]),
      decisionNote: noteSchema.nullable(),
      expectedReportVersion: recordVersionSchema,
      reportId: idSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("SET_SCORE"),
    payload: z.strictObject({
      awayScore: z.number().int().min(0).max(999),
      expectedGameVersion: recordVersionSchema,
      gameId: idSchema,
      homeScore: z.number().int().min(0).max(999),
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("SUBMIT_REPORT"),
    payload: z.strictObject({
      awayScore: z.number().int().min(0).max(999).nullable(),
      expectedGameVersion: recordVersionSchema,
      gameId: idSchema,
      homeScore: z.number().int().min(0).max(999).nullable(),
      note: noteSchema.nullable(),
      proposedFieldName: singleLineSchema(80).nullable(),
      proposedScheduled: portableScheduledInstantSchema.nullable(),
      reportType: reportTypeSchema,
      teamId: idSchema,
    }),
  }),
  z.strictObject({
    ...operationBaseShape,
    kind: z.literal("UPDATE_LEAGUE"),
    payload: z.strictObject({
      changes: z
        .strictObject({
          name: nonBlankSingleLineSchema(80).optional(),
          schedule: portableScheduleSettingsSchema.optional(),
          scoring: scoringSchema.optional(),
          seasonLabel: singleLineSchema(60).nullable().optional(),
          sport: singleLineSchema(60).nullable().optional(),
          timeZone: timeZoneSchema.optional(),
          venue: venueSchema.optional(),
        })
        .refine((changes) => Object.keys(changes).length > 0, {
          message: "Include at least one league change.",
        }),
      expectedLeagueVersion: recordVersionSchema,
    }),
  }),
]);

const syncStateSchema = z.strictObject({
  clientId: operationIdentitySchema,
  lastSyncedRevision: revisionSchema.nullable(),
  mode: z.enum(["connected", "local-only"]),
  pendingOperations: z.array(operationSchema).max(100),
});

const exportMetadataSchema = z.strictObject({
  appVersion: singleLineSchema(100).min(1),
  containsPrivateData: z.boolean(),
  exportedAt: utcTimestampSchema,
  scope: z.enum([
    "organizer-backup",
    "public-snapshot",
    "spreadsheet-operations",
    "team-manager-packet",
  ]),
  source: z.enum(["connected", "local-only"]),
});

const privateDataSchema = z.strictObject({
  activity: z.array(portableActivitySchema).max(10_000),
  managers: z.array(portableManagerSchema).max(1_000),
  organizerContactEmail: emailSchema.nullable(),
  reports: z.array(portableGameReportSchema).max(10_000),
});

const teamPacketSchema = z.strictObject({
  reports: z.array(portableTeamPacketReportSchema).max(10_000),
  teamId: idSchema,
});

export const leagueDocumentV1Schema: z.ZodType<LeagueDocumentV1> = z.strictObject({
  $schema: z.literal(PORTABLE_SCHEMA_URL),
  dataRevision: revisionSchema,
  documentId: idSchema,
  export: exportMetadataSchema,
  format: z.literal(PORTABLE_FORMAT),
  games: z.array(portableGameSchema).max(5_000),
  league: portableLeagueSchema,
  privateData: privateDataSchema.optional(),
  results: z.array(portableResultSchema).max(5_000),
  schemaVersion: z.literal(PORTABLE_SCHEMA_VERSION),
  sync: syncStateSchema.optional(),
  teamPacket: teamPacketSchema.optional(),
  teams: z.array(portableTeamSchema).min(1).max(1_000),
});

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function isRealCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
