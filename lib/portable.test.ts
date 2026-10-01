import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import {
  PORTABLE_FORMAT,
  PORTABLE_SCHEMA_URL,
  PORTABLE_SCHEMA_VERSION,
  PortableDocumentValidationError,
  assertPortableDocument,
  migratePortableDocument,
  parsePortableDocument,
  parseStrictJson,
  planPortableOperations,
  projectPublicSnapshot,
  projectSpreadsheetOperations,
  projectTeamManagerPacket,
  serializePortableDocument,
  type LeagueDocumentV1,
  type PortableOperation,
} from "./portable";
import { hashPortableOperationPayload } from "./portable-server/operations";
import { planServerPortableOperations } from "./portable-server/reconcile-plan";

const NOW = "2026-09-15T19:15:00.000Z";

function fixture(): LeagueDocumentV1 {
  return {
    $schema: PORTABLE_SCHEMA_URL,
    dataRevision: 7,
    documentId: "league_demo",
    export: {
      appVersion: "0.1.0",
      containsPrivateData: true,
      exportedAt: NOW,
      scope: "organizer-backup",
      source: "connected",
    },
    format: PORTABLE_FORMAT,
    games: [
      {
        awayTeamId: "team_blue",
        createdAt: "2026-09-01T18:00:00.000Z",
        fieldName: "North field",
        homeTeamId: "team_red",
        id: "game_final",
        locked: true,
        round: 1,
        scheduled: {
          localDate: "2026-09-20",
          localTime: "09:00",
          timeZone: "America/Los_Angeles",
          utc: "2026-09-20T16:00:00.000Z",
        },
        status: "COMPLETED",
        updatedAt: "2026-09-20T18:00:00.000Z",
        version: 2,
      },
      {
        awayTeamId: "team_red",
        createdAt: "2026-09-01T18:00:00.000Z",
        fieldName: "North field",
        homeTeamId: "team_blue",
        id: "game_upcoming",
        locked: false,
        round: 2,
        scheduled: {
          localDate: "2026-09-27",
          localTime: "09:00",
          timeZone: "America/Los_Angeles",
          utc: "2026-09-27T16:00:00.000Z",
        },
        status: "SCHEDULED",
        updatedAt: "2026-09-01T18:00:00.000Z",
        version: 1,
      },
    ],
    league: {
      archivedAt: null,
      createdAt: "2026-09-01T18:00:00.000Z",
      id: "league_demo",
      name: "Sunday Soccer",
      publicUpdatedAt: "2026-09-20T18:00:00.000Z",
      schedule: {
        durationMinutes: 60,
        fields: ["North field"],
        startDate: "2026-09-20",
        startTimes: ["09:00"],
        weekdays: [0],
      },
      scoring: {
        lossPoints: 0,
        showStandings: true,
        tiePoints: 1,
        winPoints: 3,
      },
      seasonLabel: "Fall 2026",
      slug: "sunday-soccer-2026",
      sport: "Soccer",
      timeZone: "America/Los_Angeles",
      updatedAt: "2026-09-20T18:00:00.000Z",
      venue: {
        address: "123 Main St",
        name: "Central Park",
        url: "https://example.com/field",
      },
      version: 2,
    },
    privateData: {
      activity: [
        {
          actorEmail: "organizer@example.com",
          actorRole: "ORGANIZER",
          createdAt: "2026-09-20T18:00:00.000Z",
          details: { source: "dashboard" },
          gameId: "game_final",
          id: "activity_score",
          summary: "Posted an official final score.",
          teamId: null,
          type: "SCORE_POSTED",
        },
      ],
      managers: [
        {
          acceptedAt: "2026-09-10T17:00:00.000Z",
          createdAt: "2026-09-08T17:00:00.000Z",
          email: "manager@example.com",
          id: "manager_red",
          teamId: "team_red",
          updatedAt: "2026-09-10T17:00:00.000Z",
          version: 1,
        },
      ],
      organizerContactEmail: "organizer@example.com",
      reports: [
        {
          awayScore: null,
          createdAt: "2026-09-21T17:00:00.000Z",
          decisionNote: null,
          gameId: "game_upcoming",
          gameVersion: 1,
          homeScore: null,
          id: "report_rainout",
          note: "Field is flooded.",
          proposedFieldName: null,
          proposedScheduled: null,
          reviewedAt: null,
          reviewedByEmail: null,
          status: "PENDING",
          submittedByEmail: "manager@example.com",
          teamId: "team_red",
          type: "RAINOUT",
          updatedAt: "2026-09-21T17:00:00.000Z",
          version: 1,
        },
      ],
    },
    results: [
      {
        awayScore: 1,
        gameId: "game_final",
        homeScore: 2,
        id: "result_final",
        submittedAt: "2026-09-20T18:00:00.000Z",
        updatedAt: "2026-09-20T18:00:00.000Z",
        version: 1,
      },
    ],
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    teams: [
      {
        createdAt: "2026-09-01T18:00:00.000Z",
        id: "team_red",
        name: "Red Rockets",
        updatedAt: "2026-09-01T18:00:00.000Z",
        version: 1,
      },
      {
        createdAt: "2026-09-01T18:00:00.000Z",
        id: "team_blue",
        name: "Blue Birds",
        updatedAt: "2026-09-01T18:00:00.000Z",
        version: 1,
      },
    ],
  };
}

test("portable v1 validates and round-trips deterministically", () => {
  const original = fixture();
  const serialized = serializePortableDocument(original);
  const parsed = parsePortableDocument(serialized);

  assert.deepEqual(parsed, JSON.parse(serialized));
  assert.equal(serializePortableDocument(parsed), serialized);
  assert.equal(serialized.endsWith("\n"), true);
  assert.ok(serialized.includes('"format": "gameology.rec-league"'));
});

test("canonical serialization gives record collections a stable order", () => {
  const first = fixture();
  const second = structuredClone(first);
  second.teams.reverse();
  second.games.reverse();

  assert.equal(serializePortableDocument(first), serializePortableDocument(second));
});

test("strict JSON parser rejects duplicate keys and excessive nesting", () => {
  assert.throws(
    () => parsePortableDocument('{"format":"one","format":"two"}'),
    (error: unknown) =>
      error instanceof PortableDocumentValidationError &&
      error.issues[0]?.code === "duplicate" &&
      error.issues[0]?.path === '$["format"]',
  );

  assert.throws(() => parseStrictJson("[[[]]]", { maxDepth: 2 }), /nesting exceeds/);
});

test("a newer schema is read-only until the app is upgraded", () => {
  const newer = { ...fixture(), schemaVersion: 2 };
  assert.throws(
    () => migratePortableDocument(newer),
    (error: unknown) =>
      error instanceof PortableDocumentValidationError && error.isNewerVersion,
  );
});

test("cross-record and state errors include precise paths", () => {
  const broken = fixture();
  broken.games[0].homeTeamId = "missing_team";
  broken.results[0].gameId = "missing_game";

  assert.throws(
    () => assertPortableDocument(broken),
    (error: unknown) => {
      if (!(error instanceof PortableDocumentValidationError)) return false;
      const paths = new Set(error.issues.map((issue) => issue.path));
      return (
        paths.has("$.games[0].homeTeamId") &&
        paths.has("$.results[0].gameId")
      );
    },
  );
});

test("schedule collisions and mismatched UTC/local time are rejected", () => {
  const broken = fixture();
  broken.games[1].scheduled = {
    localDate: "2026-09-20",
    localTime: "09:00",
    timeZone: "America/Los_Angeles",
    utc: "2026-09-20T15:00:00.000Z",
  };

  assert.throws(
    () => assertPortableDocument(broken),
    (error: unknown) =>
      error instanceof PortableDocumentValidationError &&
      error.issues.some((issue) => issue.code === "invalid-schedule"),
  );
});

test("public and spreadsheet projections remove every private section", () => {
  const original = fixture();
  const publicDocument = projectPublicSnapshot(original, {
    exportedAt: NOW,
  });
  const spreadsheetDocument = projectSpreadsheetOperations(original, {
    exportedAt: NOW,
  });

  for (const projected of [publicDocument, spreadsheetDocument]) {
    assert.equal(projected.privateData, undefined);
    assert.equal(projected.teamPacket, undefined);
    assert.equal(projected.sync, undefined);
    assert.equal(projected.export.containsPrivateData, false);
    const bytes = serializePortableDocument(projected);
    assert.equal(bytes.includes("organizer@example.com"), false);
    assert.equal(bytes.includes("manager@example.com"), false);
    assert.equal(bytes.includes("Field is flooded"), false);
  }
});

test("team-manager projection includes only its games and redacted reports", () => {
  const packet = projectTeamManagerPacket(fixture(), "team_red", {
    exportedAt: NOW,
  });

  assert.equal(packet.export.scope, "team-manager-packet");
  assert.equal(packet.privateData, undefined);
  assert.equal(packet.teamPacket?.teamId, "team_red");
  assert.equal(packet.teamPacket?.reports.length, 1);
  assert.equal("submittedByEmail" in packet.teamPacket!.reports[0], false);
  assert.equal("reviewedByEmail" in packet.teamPacket!.reports[0], false);
  assert.ok(
    packet.games.every(
      (game) => game.homeTeamId === "team_red" || game.awayTeamId === "team_red",
    ),
  );
});

test("a team packet remains valid before any games are scheduled", () => {
  const source = fixture();
  source.games = [];
  source.results = [];
  source.privateData!.reports = [];

  const packet = projectTeamManagerPacket(source, "team_red", {
    exportedAt: NOW,
  });

  assert.equal(packet.teams.length, 1);
  assert.equal(packet.teams[0]?.id, "team_red");
  assert.doesNotThrow(() => assertPortableDocument(packet));
});

test("unknown fields cannot smuggle authentication records into a document", () => {
  const smuggled = {
    ...fixture(),
    magicLinkTokens: [{ token: "secret-sentinel" }],
  };

  assert.throws(
    () => assertPortableDocument(smuggled),
    (error: unknown) =>
      error instanceof PortableDocumentValidationError &&
      error.issues.some((issue) => issue.path === '$["magicLinkTokens"]'),
  );
});

test("organizer sync plans independent operations and blocks dependent failures", () => {
  const current = fixture();
  const incoming = structuredClone(current);
  incoming.sync = {
    clientId: "client_organizer_123456",
    lastSyncedRevision: current.dataRevision,
    mode: "connected",
    pendingOperations: [
      operation("RENAME_TEAM", {
        expectedTeamVersion: 1,
        name: "Red Comets",
        teamId: "team_red",
      }, 1),
      operation("RENAME_TEAM", {
        expectedTeamVersion: 1,
        name: "Red Meteors",
        teamId: "team_red",
      }, 2),
      operation("RENAME_TEAM", {
        expectedTeamVersion: 2,
        name: "Red Stars",
        teamId: "team_red",
      }, 3),
      operation("SET_SCORE", {
        awayScore: 2,
        expectedGameVersion: 1,
        gameId: "game_upcoming",
        homeScore: 3,
      }, 4),
    ],
  };

  const plan = planPortableOperations(current, incoming, { role: "ORGANIZER" });

  assert.deepEqual(
    plan.items.map((item) => item.status),
    ["ready", "conflict", "blocked-by-dependency", "ready"],
  );
  assert.equal(plan.readyCount, 2);
  assert.equal(plan.conflictCount, 1);
  assert.equal(plan.blockedCount, 1);
});

test("manager sync permits only an in-scope report for the current game version", () => {
  const current = projectTeamManagerPacket(fixture(), "team_red", {
    exportedAt: NOW,
  });
  const incoming = structuredClone(current);
  incoming.sync = {
    clientId: "client_manager_12345678",
    lastSyncedRevision: current.dataRevision,
    mode: "connected",
    pendingOperations: [
      operation("SUBMIT_REPORT", {
        awayScore: 2,
        expectedGameVersion: 1,
        gameId: "game_upcoming",
        homeScore: 3,
        note: "Confirmed with both coaches.",
        proposedFieldName: null,
        proposedScheduled: null,
        reportType: "SCORE",
        teamId: "team_red",
      }, 1),
      operation("SUBMIT_REPORT", {
        awayScore: null,
        expectedGameVersion: 1,
        gameId: "game_upcoming",
        homeScore: null,
        note: "Attempted for the wrong team.",
        proposedFieldName: null,
        proposedScheduled: null,
        reportType: "RAINOUT",
        teamId: "team_blue",
      }, 2),
    ],
  };

  const plan = planPortableOperations(current, incoming, {
    role: "MANAGER",
    teamId: "team_red",
  });

  assert.equal(plan.items[0]?.status, "ready");
  assert.equal(plan.items[1]?.status, "rejected");
});

test("sync detects a newer offline base and a game removed online", () => {
  const current = fixture();
  const incoming = structuredClone(current);
  incoming.sync = {
    clientId: "client_organizer_123456",
    lastSyncedRevision: current.dataRevision,
    mode: "connected",
    pendingOperations: [
      {
        ...operation("SET_SCORE", {
          awayScore: 0,
          expectedGameVersion: 1,
          gameId: "game_missing",
          homeScore: 1,
        }, 1),
        baseRevision: current.dataRevision + 1,
      },
      operation("MARK_RAINOUT", {
        expectedGameVersion: 1,
        gameId: "game_missing",
      }, 2),
    ],
  };

  const plan = planPortableOperations(current, incoming, { role: "ORGANIZER" });
  assert.equal(plan.items[0]?.status, "conflict");
  assert.match(plan.items[0]?.message ?? "", /newer server revision/i);
  assert.equal(plan.items[1]?.status, "blocked-by-dependency");
});

test("queued schedule instants stay readable after the connected time zone changes", () => {
  const current = fixture();
  const incoming = structuredClone(current);
  const queued = operation("RESCHEDULE_GAME", {
    expectedGameVersion: 1,
    fieldName: "North field",
    gameId: "game_upcoming",
    scheduled: {
      localDate: "2026-09-28",
      localTime: "00:00",
      timeZone: "UTC",
      utc: "2026-09-28T00:00:00.000Z",
    },
  }, 1);
  incoming.sync = {
    clientId: queued.clientId,
    lastSyncedRevision: incoming.dataRevision,
    mode: "connected",
    pendingOperations: [queued],
  };

  assert.doesNotThrow(() => assertPortableDocument(incoming));
  const plan = planPortableOperations(current, incoming, { role: "ORGANIZER" });
  assert.equal(plan.items[0]?.status, "conflict");
  assert.match(plan.items[0]?.message ?? "", /time zone changed/i);
});

test("server planning recognizes a lost-response replay before dependent work", async () => {
  const current = fixture();
  current.dataRevision = 8;
  current.games[1].version = 2;
  const first = operation("SET_SCORE", {
    awayScore: 2,
    expectedGameVersion: 1,
    gameId: "game_upcoming",
    homeScore: 3,
  }, 1);
  const second = {
    ...operation("MARK_RAINOUT", {
      expectedGameVersion: 2,
      gameId: "game_upcoming",
    }, 2),
    baseRevision: 8,
  };
  const incoming = structuredClone(current);
  incoming.sync = {
    clientId: first.clientId,
    lastSyncedRevision: 7,
    mode: "connected",
    pendingOperations: [first, second],
  };
  const tx = {
    appliedOperation: {
      findMany: async () => [
        {
          actorEmail: "organizer@example.com",
          actorRole: "ORGANIZER",
          operationId: first.operationId,
          operationType: first.kind,
          payloadHash: hashPortableOperationPayload(first.kind, first.payload),
          teamId: null,
        },
      ],
    },
  } as unknown as Prisma.TransactionClient;

  const plan = await planServerPortableOperations(
    tx,
    "league_demo",
    current,
    incoming,
    { email: "organizer@example.com", role: "ORGANIZER" },
  );

  assert.deepEqual(
    plan.items.map((item) => item.status),
    ["ready", "ready"],
  );
  assert.match(plan.items[0]?.message ?? "", /already applied/i);
});

function operation<K extends PortableOperation["kind"]>(
  kind: K,
  payload: Extract<PortableOperation, { kind: K }>["payload"],
  sequence: number,
): Extract<PortableOperation, { kind: K }> {
  return {
    baseRevision: 7,
    clientId: "client_test_123456789",
    createdAt: NOW,
    kind,
    operationId: `operation_test_${String(sequence).padStart(6, "0")}`,
    payload,
  } as Extract<PortableOperation, { kind: K }>;
}
