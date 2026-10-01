import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createLocalLeagueDocument,
  generateLocalSchedule,
  generatePublicLeagueHtml,
  projectPublicSnapshot,
  setScore,
  updateLeagueSettings,
  type LeagueDocumentV1,
  type PortableEditorContext,
} from "./portable";

function context(): PortableEditorContext {
  let sequence = 0;
  return {
    newId(prefix) {
      sequence += 1;
      return `${prefix}_snapshot_${String(sequence).padStart(8, "0")}`;
    },
    now() {
      return new Date("2026-09-15T20:00:00.000Z");
    },
  };
}

function organizerFixture(): LeagueDocumentV1 {
  const editor = context();
  let document = createLocalLeagueDocument(
    {
      name: "Sunday Soccer",
      seasonLabel: "Fall 2026",
      sport: "Soccer",
      teamNames: ["Red Rockets", "Blue Birds", "Green Giants", "Gold Stars"],
      timeZone: "America/Los_Angeles",
    },
    editor,
  );
  document.privateData!.organizerContactEmail = "private-organizer@example.com";
  document.privateData!.activity[0].details = {
    sentinel: "private-activity-sentinel",
  };
  document = updateLeagueSettings(
    document,
    {
      schedule: {
        durationMinutes: 60,
        fields: ["North", "South"],
        startDate: "2026-09-20",
        startTimes: ["09:00"],
        weekdays: [0],
      },
      venue: {
        address: "123 Main St & Park Ave",
        name: "Central Park",
        url: "https://example.com/fields?league=one&day=sun",
      },
    },
    editor,
  );
  document = generateLocalSchedule(document, 1, editor);
  document = setScore(document, document.games[0].id, 2, 1, editor);
  return document;
}

test("public HTML is privacy-safe, deterministic, and injection-safe", async () => {
  const organizer = organizerFixture();
  organizer.league.name = '</script><script>globalThis.pwned=1</script> & League';
  organizer.teams[0].name = '\"><svg/onload=globalThis.pwned=2>';
  const snapshot = projectPublicSnapshot(organizer, {
    exportedAt: "2026-09-30T20:00:00.000Z",
  });

  const first = await generatePublicLeagueHtml(snapshot);
  const second = await generatePublicLeagueHtml(snapshot);

  assert.equal(first, second);
  assert.equal(first.includes("private-organizer@example.com"), false);
  assert.equal(first.includes("private-activity-sentinel"), false);
  assert.equal(first.includes("<svg/onload"), false);
  assert.equal(first.includes("</script><script>globalThis.pwned"), false);
  assert.match(first, /&lt;\/script&gt;&lt;script&gt;globalThis\.pwned=1/);
  assert.match(first, /data-game data-teams=/);
  assert.match(first, /data-race-team=/);
  assert.match(first, /id="team-filter"/);
  assert.match(first, /League race/);
  assert.match(first, /Full standings table/);
  assert.match(first, /https:\/\/example\.com\/fields\?league=one&amp;day=sun/);
  assert.doesNotMatch(first, /<(?:img|iframe|source|video|audio)\b/iu);
  assert.doesNotMatch(
    first,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u,
  );
});

test("public HTML refuses an organizer document until it is projected", async () => {
  await assert.rejects(
    () => generatePublicLeagueHtml(organizerFixture()),
    /public-snapshot document/i,
  );
});

test("public HTML CSP hashes exactly match its fixed style and script", async () => {
  const snapshot = projectPublicSnapshot(organizerFixture(), {
    exportedAt: "2026-09-30T20:00:00.000Z",
  });
  const html = await generatePublicLeagueHtml(snapshot);
  const style = html.match(/<style>([\s\S]*?)<\/style>/u)?.[1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
  assert.ok(style);
  assert.ok(script);

  const styleHash = createHash("sha256").update(style).digest("base64");
  const scriptHash = createHash("sha256").update(script).digest("base64");
  assert.match(html, new RegExp(`style-src 'sha256-${escapeRegex(styleHash)}'`));
  assert.match(html, new RegExp(`script-src 'sha256-${escapeRegex(scriptHash)}'`));
  assert.equal((html.match(/<script>/gu) ?? []).length, 1);
  assert.equal((html.match(/<style>/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /unsafe-inline/u);
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
