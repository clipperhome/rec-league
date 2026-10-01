export type CalendarGame = {
  awayTeamName: string;
  fieldName: string | null;
  homeTeamName: string;
  id: string;
  scheduledAt: Date;
  status: "COMPLETED" | "RAINED_OUT" | "RESCHEDULED" | "SCHEDULED";
  updatedAt: Date;
};

export function buildLeagueCalendar(input: {
  durationMinutes: number;
  games: CalendarGame[];
  leagueName: string;
  publicUrl: string;
  venueAddress: string | null;
  venueName: string | null;
}): string {
  const host = safeUidHost(input.publicUrl);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rec League//League Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.leagueName)}`,
  ];

  for (const game of input.games) {
    const endsAt = new Date(
      game.scheduledAt.getTime() + input.durationMinutes * 60_000,
    );
    const location = [game.fieldName, input.venueName, input.venueAddress]
      .filter(Boolean)
      .join(", ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(`${game.id}@${host}`)}`,
      `DTSTAMP:${formatIcsDate(game.updatedAt)}`,
      `LAST-MODIFIED:${formatIcsDate(game.updatedAt)}`,
      `SEQUENCE:${Math.floor(game.updatedAt.getTime() / 1000)}`,
      `DTSTART:${formatIcsDate(game.scheduledAt)}`,
      `DTEND:${formatIcsDate(endsAt)}`,
      `SUMMARY:${escapeIcsText(`${game.homeTeamName} vs ${game.awayTeamName}`)}`,
      `URL:${escapeIcsText(input.publicUrl)}`,
    );
    if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
    if (game.status === "RAINED_OUT") {
      lines.push("STATUS:CANCELLED");
    } else if (game.status === "COMPLETED") {
      lines.push("STATUS:CONFIRMED", "TRANSP:TRANSPARENT");
    } else {
      lines.push("STATUS:CONFIRMED");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}

export function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

export function foldIcsLine(line: string): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  let limit = 75;

  for (const character of line) {
    const size = encoder.encode(character).length;
    if (chunk && bytes + size > limit) {
      chunks.push(chunks.length ? ` ${chunk}` : chunk);
      chunk = character;
      bytes = size;
      limit = 74;
    } else {
      chunk += character;
      bytes += size;
    }
  }

  chunks.push(chunks.length ? ` ${chunk}` : chunk);
  return chunks;
}

function formatIcsDate(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function safeUidHost(value: string): string {
  try {
    return new URL(value).hostname || "rec-league.local";
  } catch {
    return "rec-league.local";
  }
}
