import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@/app/generated/prisma/sqlite/client";
import {
  PortableOperationError,
  hashPortableOperationPayload,
  runIdempotentLeagueOperation,
} from "./portable-server/operations";

type StoredReceipt = {
  actorEmail: string | null;
  actorRole: string;
  appliedRevision: number;
  outcomeJson: string;
  payloadHash: string;
  teamId: string | null;
};

function fakeTransaction(options: {
  acceptedManager?: boolean;
  archived?: boolean;
  commissionerEmail?: string;
}) {
  let revision = 3;
  let receipt: StoredReceipt | null = null;
  let activityCount = 0;

  const tx = {
    activityEvent: {
      create: async () => {
        activityCount += 1;
        return {};
      },
    },
    appliedOperation: {
      create: async ({ data }: { data: StoredReceipt }) => {
        receipt = data;
        return data;
      },
      findUnique: async () => receipt,
    },
    league: {
      findUnique: async () => ({
        archivedAt: options.archived ? new Date() : null,
        commissionerEmail: options.commissionerEmail ?? "organizer@example.com",
        dataRevision: revision,
        teamManagers: options.acceptedManager ? [{ id: "manager_1" }] : [],
      }),
      update: async () => {
        revision += 1;
        return { dataRevision: revision };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return {
    get activityCount() {
      return activityCount;
    },
    get revision() {
      return revision;
    },
    tx,
  };
}

test("operation hashes ignore object key order but bind the operation type", () => {
  assert.equal(
    hashPortableOperationPayload("SET_SCORE", { away: 1, home: 2 }),
    hashPortableOperationPayload("SET_SCORE", { home: 2, away: 1 }),
  );
  assert.notEqual(
    hashPortableOperationPayload("SET_SCORE", { home: 2 }),
    hashPortableOperationPayload("MARK_RAINOUT", { home: 2 }),
  );
});

test("an idempotent retry returns the stored result without another mutation", async () => {
  const fake = fakeTransaction({});
  let mutationCount = 0;
  const input = {
    actor: { email: "Organizer@Example.com", role: "ORGANIZER" as const },
    activity: {
      summary: "Posted an official final score.",
      type: "SCORE_POSTED",
    },
    baseRevision: 3,
    leagueId: "league_1",
    operationId: "operation_123456789",
    operationType: "SET_SCORE",
    payload: { awayScore: 1, gameId: "game_1", homeScore: 2 },
  };

  const first = await runIdempotentLeagueOperation(fake.tx, input, async () => {
    mutationCount += 1;
    return { saved: true };
  });
  const replay = await runIdempotentLeagueOperation(fake.tx, input, async () => {
    mutationCount += 1;
    return { saved: false };
  });

  assert.deepEqual(first, {
    outcome: { saved: true },
    replayed: false,
    revision: 4,
  });
  assert.deepEqual(replay, {
    outcome: { saved: true },
    replayed: true,
    revision: 4,
  });
  assert.equal(mutationCount, 1);
  assert.equal(fake.activityCount, 1);
  assert.equal(fake.revision, 4);
});

test("reusing an operation ID for different content is a conflict", async () => {
  const fake = fakeTransaction({});
  const base = {
    actor: { email: "organizer@example.com", role: "ORGANIZER" as const },
    activity: { summary: "Changed data.", type: "DATA_CHANGED" },
    baseRevision: 3,
    leagueId: "league_1",
    operationId: "operation_123456789",
    operationType: "SET_SCORE",
  };

  await runIdempotentLeagueOperation(
    fake.tx,
    { ...base, payload: { homeScore: 2 } },
    async () => ({ saved: true }),
  );

  await assert.rejects(
    () =>
      runIdempotentLeagueOperation(
        fake.tx,
        { ...base, payload: { homeScore: 3 } },
        async () => ({ saved: true }),
      ),
    (error: unknown) =>
      error instanceof PortableOperationError &&
      error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("revoked managers and archived leagues are rejected before replay", async () => {
  const managerInput = {
    actor: {
      email: "manager@example.com",
      role: "MANAGER" as const,
      teamId: "team_1",
    },
    activity: { summary: "Reported a score.", type: "REPORT_SUBMITTED" },
    baseRevision: 1,
    leagueId: "league_1",
    operationId: "operation_123456789",
    operationType: "SUBMIT_REPORT",
    payload: { gameId: "game_1" },
  };

  for (const fake of [
    fakeTransaction({ acceptedManager: false }),
    fakeTransaction({ acceptedManager: true, archived: true }),
  ]) {
    await assert.rejects(
      () =>
        runIdempotentLeagueOperation(fake.tx, managerInput, async () => ({
          saved: true,
        })),
      (error: unknown) =>
        error instanceof PortableOperationError && error.code === "NOT_AUTHORIZED",
    );
  }
});
