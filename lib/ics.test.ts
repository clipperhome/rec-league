import assert from "node:assert/strict";
import test from "node:test";

import { buildLeagueCalendar, escapeIcsText, foldIcsLine } from "./ics";

test("escapes calendar text including punctuation and line breaks", () => {
  assert.equal(
    escapeIcsText("Café, North; A\\B\nGate 2"),
    "Café\\, North\\; A\\\\B\\nGate 2",
  );
});

test("folds long Unicode lines to at most 75 UTF-8 octets", () => {
  const lines = foldIcsLine(`SUMMARY:${"⚽".repeat(40)}`);
  const encoder = new TextEncoder();
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => encoder.encode(line).length <= 75));
  assert.ok(lines.slice(1).every((line) => line.startsWith(" ")));
});

test("keeps a stable UID and marks a dated rainout cancelled", () => {
  const calendar = buildLeagueCalendar({
    durationMinutes: 75,
    games: [
      {
        awayTeamName: "Owls",
        fieldName: "Field 1",
        homeTeamName: "Foxes",
        id: "game-1",
        scheduledAt: new Date("2026-09-15T18:00:00Z"),
        status: "RAINED_OUT",
        updatedAt: new Date("2026-09-15T17:00:00Z"),
      },
    ],
    leagueName: "Autumn League",
    publicUrl: "https://example.com/l/autumn",
    venueAddress: "1 Main St",
    venueName: "Rec Center",
  });

  assert.match(calendar, /UID:game-1@example\.com/);
  assert.match(calendar, /DTEND:20260915T191500Z/);
  assert.match(calendar, /STATUS:CANCELLED/);
  assert.ok(calendar.endsWith("\r\n"));
});
