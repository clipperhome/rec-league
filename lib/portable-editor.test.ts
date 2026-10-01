import assert from "node:assert/strict";
import test from "node:test";

import {
  PortableEditorError,
  assertPortableDocument,
  createLocalLeagueDocument,
  generateLocalSchedule,
  materializePendingOperations,
  parsePortableDocument,
  projectTeamManagerPacket,
  renameTeam,
  serializePortableDocument,
  setLeagueArchived,
  setScore,
  submitManagerReport,
  updateLeagueSettings,
  type LeagueDocumentV1,
  type PortableEditorContext,
} from "./portable";

function context(): PortableEditorContext {
  let sequence = 0;
  return {
    newId(prefix) {
      sequence += 1;
      return `${prefix}_test_${String(sequence).padStart(10, "0")}`;
    },
    now() {
      return new Date("2026-09-15T20:00:00.000Z");
    },
  };
}

function localFixture(editor = context()): LeagueDocumentV1 {
  return createLocalLeagueDocument(
    {
      name: "Saturday Soccer",
      seasonLabel: "Fall 2026",
      sport: "Soccer",
      teamNames: ["Red Rockets", "Blue Birds", "Green Giants", "Gold Stars"],
      timeZone: "America/Los_Angeles",
    },
    editor,
  );
}

function scheduledFixture(editor = context()): LeagueDocumentV1 {
  const created = localFixture(editor);
  const configured = updateLeagueSettings(
    created,
    {
      schedule: {
        durationMinutes: 60,
        fields: ["North", "South"],
        startDate: "2026-09-19",
        startTimes: ["09:00"],
        weekdays: [6],
      },
    },
    editor,
  );
  return generateLocalSchedule(configured, 1, editor);
}

test("a local-only league can generate, score, serialize, and reopen", () => {
  const editor = context();
  const scheduled = scheduledFixture(editor);
  assert.equal(scheduled.games.length, 6);
  assert.equal(scheduled.dataRevision, 3);

  const scored = setScore(scheduled, scheduled.games[0].id, 3, 1, editor);
  assert.equal(scored.dataRevision, 4);
  assert.equal(scored.games[0].status, "COMPLETED");
  assert.deepEqual(
    scored.results.map(({ awayScore, homeScore }) => ({ awayScore, homeScore })),
    [{ awayScore: 1, homeScore: 3 }],
  );

  const reopened = parsePortableDocument(serializePortableDocument(scored));
  assert.deepEqual(reopened, JSON.parse(serializePortableDocument(scored)));
  assert.equal(reopened.sync?.mode, "local-only");
});

test("connected organizer edits queue commands without changing the official snapshot", () => {
  const editor = context();
  const source = scheduledFixture(editor);
  source.export.source = "connected";
  source.sync = {
    clientId: "client_connected_123456",
    lastSyncedRevision: source.dataRevision,
    mode: "connected",
    pendingOperations: [],
  };
  const connected = assertPortableDocument(source);
  const game = connected.games[0];
  const queued = setScore(connected, game.id, 2, 0, editor);

  assert.equal(queued.dataRevision, connected.dataRevision);
  assert.equal(queued.games[0].status, "SCHEDULED");
  assert.equal(queued.results.length, 0);
  assert.equal(queued.sync?.pendingOperations[0]?.kind, "SET_SCORE");
  const proposed = materializePendingOperations(queued);
  assert.equal(proposed.games[0].status, "COMPLETED");
  assert.equal(proposed.results[0]?.homeScore, 2);

  assert.throws(
    () => setScore(queued, game.id, 3, 0, editor),
    (error: unknown) =>
      error instanceof PortableEditorError && /already has a pending change/i.test(error.message),
  );
});

test("connected team packets queue only team-scoped report submissions", () => {
  const editor = context();
  const organizer = scheduledFixture(editor);
  const teamId = organizer.teams[0].id;
  const packet = projectTeamManagerPacket(organizer, teamId, {
    exportedAt: "2026-09-15T20:00:00.000Z",
  });
  packet.export.source = "connected";
  packet.sync = {
    clientId: "client_manager_12345678",
    lastSyncedRevision: packet.dataRevision,
    mode: "connected",
    pendingOperations: [],
  };
  const connected = assertPortableDocument(packet);
  const game = connected.games[0];
  const queued = submitManagerReport(
    connected,
    {
      awayScore: 1,
      gameId: game.id,
      homeScore: 2,
      note: "Confirmed after the game.",
      reportType: "SCORE",
    },
    editor,
  );

  assert.equal(queued.sync?.pendingOperations[0]?.kind, "SUBMIT_REPORT");
  assert.equal(
    queued.sync?.pendingOperations[0]?.kind === "SUBMIT_REPORT"
      ? queued.sync.pendingOperations[0].payload.teamId
      : null,
    teamId,
  );
  assert.doesNotThrow(() => assertPortableDocument(queued));
});

test("archive and reopen are explicit local revisions", () => {
  const editor = context();
  const source = localFixture(editor);
  const archived = setLeagueArchived(source, true, editor);
  const reopened = setLeagueArchived(archived, false, editor);

  assert.ok(archived.league.archivedAt);
  assert.equal(reopened.league.archivedAt, null);
  assert.equal(reopened.dataRevision, source.dataRevision + 2);
});

test("connected team rename leaves a readable pending projection", () => {
  const editor = context();
  const source = localFixture(editor);
  source.export.source = "connected";
  source.sync = {
    clientId: "client_connected_123456",
    lastSyncedRevision: source.dataRevision,
    mode: "connected",
    pendingOperations: [],
  };
  const connected = assertPortableDocument(source);
  const team = connected.teams[0];
  const queued = renameTeam(connected, team.id, "Crimson Comets", editor);

  assert.equal(queued.teams[0].name, "Red Rockets");
  assert.equal(materializePendingOperations(queued).teams[0].name, "Crimson Comets");
});
