import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import ExcelJS, { type Worksheet } from "exceljs";

import {
  assertPortableDocument,
  createLocalLeagueDocument,
  generateLocalSchedule,
  planPortableOperations,
  setScore,
  updateLeagueSettings,
  type LeagueDocumentV1,
  type PortableEditorContext,
} from "./portable";
import {
  SpreadsheetImportError,
  buildLeagueCsv,
  buildLeagueWorkbook,
  describeSpreadsheetChanges,
  workbookToConnectedDocument,
} from "./spreadsheet/league-workbook";

function context(): PortableEditorContext {
  let sequence = 0;
  return {
    newId(prefix) {
      sequence += 1;
      return `${prefix}_sheet_${String(sequence).padStart(10, "0")}`;
    },
    now() {
      return new Date("2026-09-15T20:00:00.000Z");
    },
  };
}

function fixture(): LeagueDocumentV1 {
  const editor = context();
  const created = createLocalLeagueDocument(
    {
      name: "Saturday Soccer",
      seasonLabel: "Fall 2026",
      sport: "Soccer",
      teamNames: ["Red Rockets", "Blue Birds", "Green Giants", "Gold Stars"],
      timeZone: "America/Los_Angeles",
    },
    editor,
  );
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
  const scheduled = generateLocalSchedule(configured, 1, editor);
  const scored = setScore(scheduled, scheduled.games[0].id, 3, 1, editor);
  scored.export.source = "connected";
  scored.sync = {
    clientId: "client_spreadsheet_fixture",
    lastSyncedRevision: scored.dataRevision,
    mode: "connected",
    pendingOperations: [],
  };
  return assertPortableDocument(scored);
}

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return workbook;
}

async function saveWorkbook(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes as ArrayBuffer);
}

function column(sheet: Worksheet, header: string): number {
  for (let index = 1; index <= sheet.columnCount; index += 1) {
    if (sheet.getCell(1, index).value === header) return index;
  }
  throw new Error(`Missing ${header} column.`);
}

function rowFor(sheet: Worksheet, header: string, value: string): number {
  const index = column(sheet, header);
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    if (sheet.getCell(row, index).value === value) return row;
  }
  throw new Error(`Missing ${value} row.`);
}

test("workbook export includes editable, private, and derived sheets with stable headers", async () => {
  const source = fixture();
  const workbook = await loadWorkbook(await buildLeagueWorkbook(source));

  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    [
      "README",
      "League",
      "Teams",
      "Games",
      "Results",
      "Managers",
      "Reports",
      "Activity",
      "Standings",
    ],
  );
  assert.equal(workbook.getWorksheet("Games")?.getCell("A1").value, "record_id");
  assert.equal(workbook.getWorksheet("Results")?.rowCount, source.games.length + 1);
  assert.equal(workbook.getWorksheet("Managers")?.getCell("A1").value, "record_id");
});

test("edited workbook becomes typed operations with auditable before and after values", async () => {
  const source = fixture();
  const workbook = await loadWorkbook(await buildLeagueWorkbook(source));
  const teams = workbook.getWorksheet("Teams")!;
  teams.getCell(2, column(teams, "name")).value = "Crimson Comets";

  const unscoredGame = source.games.find(
    (game) => !source.results.some((result) => result.gameId === game.id),
  )!;
  const results = workbook.getWorksheet("Results")!;
  const resultRow = rowFor(results, "game_id", unscoredGame.id);
  results.getCell(resultRow, column(results, "home_score")).value = 2;
  results.getCell(resultRow, column(results, "away_score")).value = 0;

  const imported = await workbookToConnectedDocument(
    await saveWorkbook(workbook),
    source,
    {
      clientId: "client_spreadsheet_test",
      now: new Date("2026-09-15T21:00:00.000Z"),
    },
  );
  assert.deepEqual(
    imported.document.sync?.pendingOperations.map((operation) => operation.kind),
    ["RENAME_TEAM", "SET_SCORE"],
  );
  const changes = describeSpreadsheetChanges(source, imported.document);
  assert.equal(changes[0].before, "Red Rockets");
  assert.equal(changes[0].after, "Crimson Comets");
  assert.equal(changes[1].before, "No official score");
  assert.equal(changes[1].after, "2–0");
});

test("unchanged, formula, and coerced-date workbooks are rejected without operations", async () => {
  const source = fixture();
  const original = await buildLeagueWorkbook(source);
  await assert.rejects(
    workbookToConnectedDocument(original, source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError && /does not contain any supported changes/u.test(error.message),
  );

  const formulaWorkbook = await loadWorkbook(original);
  formulaWorkbook.getWorksheet("Teams")!.getCell("D2").value = {
    formula: 'CONCAT("Unsafe", " Team")',
    result: "Unsafe Team",
  };
  await assert.rejects(
    workbookToConnectedDocument(await saveWorkbook(formulaWorkbook), source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError &&
      error.issues.some((issue) => /Formula cells/u.test(issue.message)),
  );

  const dateWorkbook = await loadWorkbook(original);
  const games = dateWorkbook.getWorksheet("Games")!;
  games.getCell(2, column(games, "local_date")).value = new Date("2026-09-20T00:00:00.000Z");
  await assert.rejects(
    workbookToConnectedDocument(await saveWorkbook(dateWorkbook), source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError &&
      error.issues.some((issue) => /automatically coerced/u.test(issue.message)),
  );
});

test("stale game versions remain conflicts instead of borrowing the live version", async () => {
  const source = fixture();
  const workbook = await loadWorkbook(await buildLeagueWorkbook(source));
  const unscoredGame = source.games.find(
    (game) => !source.results.some((result) => result.gameId === game.id),
  )!;
  const games = workbook.getWorksheet("Games")!;
  const gameRow = rowFor(games, "record_id", unscoredGame.id);
  games.getCell(gameRow, column(games, "record_version")).value = unscoredGame.version + 1;
  const results = workbook.getWorksheet("Results")!;
  const resultRow = rowFor(results, "game_id", unscoredGame.id);
  results.getCell(resultRow, column(results, "home_score")).value = 1;
  results.getCell(resultRow, column(results, "away_score")).value = 0;

  const imported = await workbookToConnectedDocument(
    await saveWorkbook(workbook),
    source,
  );
  const plan = planPortableOperations(source, imported.document, { role: "ORGANIZER" });
  assert.equal(plan.conflictCount, 1);
  assert.match(plan.items[0].message, /game changed online/u);
});

test("CSV output protects string formulas without converting negative numbers to text", () => {
  const source = fixture();
  source.teams[0].name = "  =HYPERLINK(\"https://example.invalid\")";
  source.privateData!.organizerContactEmail = "private@example.com";
  const teams = buildLeagueCsv(assertPortableDocument(source), "teams");
  const standings = buildLeagueCsv(source, "standings");

  assert.equal(teams.startsWith("\uFEFF"), true);
  assert.equal(teams.endsWith("\r\n"), true);
  assert.match(teams, /"'  =HYPERLINK/);
  assert.match(standings, /"-2"/u);
  assert.doesNotMatch(standings, /"'-2"/u);
  for (const table of ["teams", "games", "results", "standings"] as const) {
    assert.doesNotMatch(buildLeagueCsv(source, table), /private@example\.com/u);
  }
});

test("duplicate result rows and missing required headers fail with sheet paths", async () => {
  const source = fixture();
  const duplicateWorkbook = await loadWorkbook(await buildLeagueWorkbook(source));
  const results = duplicateWorkbook.getWorksheet("Results")!;
  results.duplicateRow(2, 1, true);
  await assert.rejects(
    workbookToConnectedDocument(await saveWorkbook(duplicateWorkbook), source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError &&
      error.issues.some((issue) => /Duplicate result record_id|one Results row/u.test(issue.message)),
  );

  const missingHeaderWorkbook = await loadWorkbook(await buildLeagueWorkbook(source));
  missingHeaderWorkbook.getWorksheet("Teams")!.getCell("D1").value = "";
  await assert.rejects(
    workbookToConnectedDocument(await saveWorkbook(missingHeaderWorkbook), source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError &&
      error.issues.some(
        (issue) => issue.path === "Teams!1" && /Missing required name/u.test(issue.message),
      ),
  );
});

test("unscheduled games and schedule field names containing pipes round-trip losslessly", async () => {
  const source = fixture();
  const unscored = source.games.find(
    (game) => !source.results.some((result) => result.gameId === game.id),
  )!;
  unscored.scheduled = null;
  unscored.fieldName = null;
  unscored.status = "SCHEDULED";
  source.league.schedule.fields = ["North", "Field 1 | East"];
  const valid = assertPortableDocument(source);

  await assert.rejects(
    workbookToConnectedDocument(await buildLeagueWorkbook(valid), valid),
    (error: unknown) =>
      error instanceof SpreadsheetImportError &&
      /does not contain any supported changes/u.test(error.message),
  );
});

test("future workbook schemas are refused and validation issue output is capped", async () => {
  const source = fixture();
  const future = await loadWorkbook(await buildLeagueWorkbook(source));
  const league = future.getWorksheet("League")!;
  league.getCell(2, column(league, "workbook_schema_version")).value = 2;
  await assert.rejects(
    workbookToConnectedDocument(await saveWorkbook(future), source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError &&
      error.issues.some((issue) => /newer app/u.test(issue.message)),
  );

  const formulas = await loadWorkbook(await buildLeagueWorkbook(source));
  const activity = formulas.getWorksheet("Activity")!;
  for (let row = 2; row < 152; row += 1) {
    activity.getCell(row, 1).value = { formula: "1+1", result: 2 };
  }
  await assert.rejects(
    workbookToConnectedDocument(await saveWorkbook(formulas), source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError && error.issues.length === 100,
  );
});

test("actual inflated workbook bytes are bounded even when ZIP metadata lies", async () => {
  const source = fixture();
  const forged = forgedSingleEntryZip(64 * 1024 * 1024 + 1);
  assert.ok(forged.byteLength < 5 * 1024 * 1024);
  await assert.rejects(
    workbookToConnectedDocument(forged, source),
    (error: unknown) =>
      error instanceof SpreadsheetImportError &&
      /expanded workbook is too large/u.test(error.message),
  );
});

function forgedSingleEntryZip(inflatedBytes: number): Buffer {
  const name = Buffer.from("xl/bomb.xml", "utf8");
  const compressed = deflateRawSync(Buffer.alloc(inflatedBytes, 65), { level: 9 });
  const advertisedSize = 1;
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(advertisedSize, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(advertisedSize, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, eocd]);
}
