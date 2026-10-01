import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";

import { PrismaClient } from "@/app/generated/prisma/sqlite/client";
import {
  assertPortableDocument,
  serializePortableDocument,
  type PortableOperation,
} from "./portable";
import { applyPortableOperationInTransaction } from "./portable-server/apply-operation";
import { buildOrganizerLeagueDocument } from "./portable-server/document";
import { createLeagueCopyFromDocument } from "./portable-server/import-copy";
import {
  SpreadsheetAtomicApplyError,
  applySpreadsheetOperationsAtomically,
} from "./spreadsheet/apply";

test("database backup creates a faithful copy without restoring authority", async () => {
  await withDatabase(async (client) => {
    await seedLeague(client);
    const source = await client.$transaction((tx) =>
      buildOrganizerLeagueDocument(tx, "league_source", {
        exportedAt: new Date("2026-09-30T20:00:00.000Z"),
      }),
    );

    assert.match(serializePortableDocument(source), /"organizer-backup"/);
    assert.equal(source.privateData?.managers[0]?.acceptedAt !== null, true);
    assert.equal(source.privateData?.reports[0]?.status, "PENDING");

    const copy = await client.$transaction(
      (tx) => createLeagueCopyFromDocument(tx, source, "new-owner@example.com"),
      { isolationLevel: "Serializable" },
    );
    const copied = await client.$transaction((tx) =>
      buildOrganizerLeagueDocument(tx, copy.id, {
        exportedAt: new Date("2026-09-30T20:00:00.000Z"),
      }),
    );

    assert.notEqual(copied.documentId, source.documentId);
    assert.equal(copied.league.name, "Sunday Soccer copy");
    assert.deepEqual(
      copied.teams.map((team) => team.name).sort(),
      source.teams.map((team) => team.name).sort(),
    );
    assert.equal(copied.games.length, source.games.length);
    assert.deepEqual(
      copied.results.map(({ awayScore, homeScore }) => ({ awayScore, homeScore })),
      source.results.map(({ awayScore, homeScore }) => ({ awayScore, homeScore })),
    );
    assert.equal(copied.privateData?.organizerContactEmail, "new-owner@example.com");
    assert.equal(copied.privateData?.managers[0]?.acceptedAt, null);
    assert.equal(copied.privateData?.reports[0]?.status, "REJECTED");
    assert.equal(await client.magicLinkToken.count({ where: { leagueId: copy.id } }), 0);
    assert.equal(
      await client.commissionerSession.count({
        where: { scopeLeagueId: copy.id },
      }),
      0,
    );
  });
});

test("a failed portable copy transaction leaves no partial league", async () => {
  await withDatabase(async (client) => {
    await seedLeague(client);
    const source = await client.$transaction((tx) =>
      buildOrganizerLeagueDocument(tx, "league_source"),
    );
    const before = await client.league.count();

    await assert.rejects(
      () =>
        client.$transaction(
          async (tx) => {
            await createLeagueCopyFromDocument(tx, source, "owner@example.com");
            throw new Error("injected failure");
          },
          { isolationLevel: "Serializable" },
        ),
      /injected failure/,
    );

    assert.equal(await client.league.count(), before);
  });
});

test("a portable score operation is atomic and a retry reuses its receipt", async () => {
  await withDatabase(async (client) => {
    await seedLeague(client);
    const operation: PortableOperation = {
      baseRevision: 4,
      clientId: "client_integration_12345",
      createdAt: "2026-09-25T20:00:00.000Z",
      kind: "SET_SCORE",
      operationId: "operation_score_123456",
      payload: {
        awayScore: 2,
        expectedGameVersion: 1,
        gameId: "game_upcoming",
        homeScore: 4,
      },
    };
    const actor = {
      email: "organizer@example.com",
      role: "ORGANIZER" as const,
    };

    const first = await client.$transaction((tx) =>
      applyPortableOperationInTransaction(tx, "league_source", actor, operation),
    );
    const retry = await client.$transaction((tx) =>
      applyPortableOperationInTransaction(tx, "league_source", actor, operation),
    );
    const [league, game, result, receipts, activities] = await Promise.all([
      client.league.findUniqueOrThrow({ where: { id: "league_source" } }),
      client.game.findUniqueOrThrow({ where: { id: "game_upcoming" } }),
      client.result.findUniqueOrThrow({ where: { gameId: "game_upcoming" } }),
      client.appliedOperation.count({
        where: { leagueId: "league_source", operationId: operation.operationId },
      }),
      client.activityEvent.count({
        where: { leagueId: "league_source", operationId: operation.operationId },
      }),
    ]);

    assert.equal(first.replayed, false);
    assert.equal(retry.replayed, true);
    assert.equal(first.revision, retry.revision);
    assert.equal(league.dataRevision, 5);
    assert.equal(game.status, "COMPLETED");
    assert.equal(game.version, 2);
    assert.deepEqual(
      { awayScore: result.awayScore, homeScore: result.homeScore },
      { awayScore: 2, homeScore: 4 },
    );
    assert.equal(receipts, 1);
    assert.equal(activities, 1);
  });
});

test("spreadsheet changes commit together and any unsafe row rolls everything back", async () => {
  await withDatabase(async (client) => {
    await seedLeague(client);
    const actor = { email: "organizer@example.com", role: "ORGANIZER" as const };
    const current = await client.$transaction((tx) =>
      buildOrganizerLeagueDocument(tx, "league_source"),
    );
    const rename: PortableOperation = {
      baseRevision: current.dataRevision,
      clientId: "client_spreadsheet_atomic",
      createdAt: "2026-09-25T20:00:00.000Z",
      kind: "RENAME_TEAM",
      operationId: "operation_sheet_rename_1",
      payload: {
        expectedTeamVersion: 1,
        name: "Crimson Comets",
        teamId: "team_red",
      },
    };
    const lockedScore: PortableOperation = {
      baseRevision: current.dataRevision,
      clientId: "client_spreadsheet_atomic",
      createdAt: "2026-09-25T20:00:00.000Z",
      kind: "SET_SCORE",
      operationId: "operation_sheet_score_locked",
      payload: {
        awayScore: 0,
        expectedGameVersion: 2,
        gameId: "game_final",
        homeScore: 5,
      },
    };
    const unsafe = assertPortableDocument({
      ...current,
      sync: {
        clientId: "client_spreadsheet_atomic",
        lastSyncedRevision: current.dataRevision,
        mode: "connected",
        pendingOperations: [rename, lockedScore],
      },
    });

    await assert.rejects(
      () =>
        client.$transaction(
          (tx) =>
            applySpreadsheetOperationsAtomically(
              tx,
              "league_source",
              current,
              unsafe,
              actor,
            ),
          { isolationLevel: "Serializable" },
        ),
      (error: unknown) => error instanceof SpreadsheetAtomicApplyError,
    );
    assert.equal(
      (await client.team.findUniqueOrThrow({ where: { id: "team_red" } })).name,
      "Red Rockets",
    );
    assert.equal(
      (await client.league.findUniqueOrThrow({ where: { id: "league_source" } }))
        .dataRevision,
      4,
    );
    assert.equal(await client.appliedOperation.count(), 0);

    const score: PortableOperation = {
      ...lockedScore,
      operationId: "operation_sheet_score_ready",
      payload: {
        awayScore: 0,
        expectedGameVersion: 1,
        gameId: "game_upcoming",
        homeScore: 5,
      },
    };
    const ready = assertPortableDocument({
      ...current,
      sync: {
        clientId: "client_spreadsheet_atomic",
        lastSyncedRevision: current.dataRevision,
        mode: "connected",
        pendingOperations: [rename, score],
      },
    });
    const applied = await client.$transaction(
      (tx) =>
        applySpreadsheetOperationsAtomically(
          tx,
          "league_source",
          current,
          ready,
          actor,
        ),
      { isolationLevel: "Serializable" },
    );
    assert.equal(applied.appliedCount, 2);
    assert.equal(applied.document.dataRevision, 6);
    assert.equal(
      (await client.team.findUniqueOrThrow({ where: { id: "team_red" } })).name,
      "Crimson Comets",
    );
    assert.deepEqual(
      await client.result.findUniqueOrThrow({
        select: { awayScore: true, homeScore: true },
        where: { gameId: "game_upcoming" },
      }),
      { awayScore: 0, homeScore: 5 },
    );
  });
});

async function withDatabase(
  run: (client: PrismaClient) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "rec-league-portable-test-"));
  const databasePath = join(directory, "test.db");
  const sqlite = new Database(databasePath);
  const migrationsRoot = join(process.cwd(), "prisma", "sqlite", "migrations");

  try {
    for (const migration of readdirSync(migrationsRoot).sort()) {
      const migrationPath = join(migrationsRoot, migration, "migration.sql");
      try {
        sqlite.exec(readFileSync(migrationPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
      }
    }
  } finally {
    sqlite.close();
  }

  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${databasePath}` }),
  });
  try {
    await run(client);
  } finally {
    await client.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  }
}

async function seedLeague(client: PrismaClient): Promise<void> {
  const createdAt = new Date("2026-09-01T18:00:00.000Z");
  const finalAt = new Date("2026-09-20T16:00:00.000Z");
  const upcomingAt = new Date("2026-09-27T16:00:00.000Z");

  await client.$transaction(async (tx) => {
    await tx.league.create({
      data: {
        commissionerEmail: "organizer@example.com",
        createdAt,
        dataRevision: 4,
        fieldNames: "North field",
        gameDays: "0",
        gameDurationMinutes: 60,
        gameTimes: "09:00",
        id: "league_source",
        name: "Sunday Soccer",
        publicUpdatedAt: finalAt,
        scheduleStartDate: "2026-09-20",
        seasonLabel: "Fall 2026",
        slug: "sunday-soccer-2026",
        sport: "Soccer",
        timezone: "America/Los_Angeles",
        updatedAt: finalAt,
        venueAddress: "123 Main St",
        venueName: "Central Park",
        venueUrl: "https://example.com/field",
      },
    });
    await tx.team.createMany({
      data: [
        {
          createdAt,
          id: "team_red",
          leagueId: "league_source",
          name: "Red Rockets",
          updatedAt: createdAt,
        },
        {
          createdAt,
          id: "team_blue",
          leagueId: "league_source",
          name: "Blue Birds",
          updatedAt: createdAt,
        },
      ],
    });
    await tx.game.createMany({
      data: [
        {
          awayTeamId: "team_blue",
          createdAt,
          fieldName: "North field",
          homeTeamId: "team_red",
          id: "game_final",
          leagueId: "league_source",
          locked: true,
          round: 1,
          scheduledAt: finalAt,
          status: "COMPLETED",
          updatedAt: finalAt,
          version: 2,
        },
        {
          awayTeamId: "team_red",
          createdAt,
          fieldName: "North field",
          homeTeamId: "team_blue",
          id: "game_upcoming",
          leagueId: "league_source",
          round: 2,
          scheduledAt: upcomingAt,
          updatedAt: createdAt,
        },
      ],
    });
    await tx.result.create({
      data: {
        awayScore: 1,
        gameId: "game_final",
        homeScore: 2,
        id: "result_final",
        submittedAt: finalAt,
        updatedAt: finalAt,
      },
    });
    await tx.teamManager.create({
      data: {
        acceptedAt: new Date("2026-09-10T17:00:00.000Z"),
        createdAt,
        email: "manager@example.com",
        id: "manager_red",
        leagueId: "league_source",
        teamId: "team_red",
        updatedAt: createdAt,
      },
    });
    await tx.gameReport.create({
      data: {
        createdAt: new Date("2026-09-14T17:00:00.000Z"),
        gameId: "game_upcoming",
        gameVersion: 1,
        id: "report_rainout",
        leagueId: "league_source",
        note: "Field is flooded.",
        pendingKey: "game_upcoming:team_red:RAINOUT",
        submittedByEmail: "manager@example.com",
        teamId: "team_red",
        type: "RAINOUT",
        updatedAt: new Date("2026-09-14T17:00:00.000Z"),
      },
    });
    await tx.activityEvent.create({
      data: {
        actorEmail: "organizer@example.com",
        actorRole: "ORGANIZER",
        createdAt: finalAt,
        gameId: "game_final",
        id: "activity_final",
        leagueId: "league_source",
        summary: "Posted an official final score.",
        type: "SCORE_POSTED",
      },
    });
  });
}
