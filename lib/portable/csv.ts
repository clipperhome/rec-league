import { buildStandings } from "../standings";
import type { LeagueDocumentV1 } from "./types";

export type PortableCsvTable = "games" | "results" | "standings" | "teams";

export function buildPortableCsv(
  document: LeagueDocumentV1,
  table: PortableCsvTable,
): string {
  const rows = csvRows(document, table);
  const headers = CSV_HEADERS[table];
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((key) => row[key]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}

const CSV_HEADERS: Record<PortableCsvTable, readonly string[]> = {
  games: [
    "record_id",
    "record_version",
    "round",
    "local_date",
    "local_time",
    "time_zone",
    "field_name",
    "home_team_id",
    "home_team_name",
    "away_team_id",
    "away_team_name",
    "status",
    "locked",
  ],
  results: [
    "record_id",
    "record_version",
    "game_id",
    "local_date",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
    "game_status",
    "updated_at",
  ],
  standings: [
    "position",
    "team_id",
    "team_name",
    "played",
    "wins",
    "ties",
    "losses",
    "score_for",
    "score_against",
    "differential",
    "points",
  ],
  teams: ["record_id", "record_version", "name"],
};

function csvRows(
  document: LeagueDocumentV1,
  table: PortableCsvTable,
): Array<Record<string, boolean | number | string>> {
  const teamNames = new Map(document.teams.map((team) => [team.id, team.name]));
  if (table === "teams") {
    return document.teams.map((team) => ({
      name: team.name,
      record_id: team.id,
      record_version: team.version,
    }));
  }
  if (table === "games") {
    return document.games.map((game) => ({
      away_team_id: game.awayTeamId,
      away_team_name: teamNames.get(game.awayTeamId) ?? "",
      field_name: game.fieldName ?? "",
      home_team_id: game.homeTeamId,
      home_team_name: teamNames.get(game.homeTeamId) ?? "",
      local_date: game.scheduled?.localDate ?? "",
      local_time: game.scheduled?.localTime ?? "",
      locked: game.locked,
      record_id: game.id,
      record_version: game.version,
      round: game.round,
      status: game.status,
      time_zone: game.scheduled?.timeZone ?? document.league.timeZone,
    }));
  }
  if (table === "results") {
    const resultByGame = new Map(
      document.results.map((result) => [result.gameId, result]),
    );
    return document.games.map((game) => {
      const result = resultByGame.get(game.id);
      return {
        away_score: result?.awayScore ?? "",
        away_team: teamNames.get(game.awayTeamId) ?? game.awayTeamId,
        game_id: game.id,
        game_status: game.status,
        home_score: result?.homeScore ?? "",
        home_team: teamNames.get(game.homeTeamId) ?? game.homeTeamId,
        local_date: game.scheduled?.localDate ?? "",
        record_id: result?.id ?? "",
        record_version: result?.version ?? "",
        updated_at: result?.updatedAt ?? "",
      };
    });
  }

  const resultByGame = new Map(
    document.results.map((result) => [result.gameId, result]),
  );
  return buildStandings(
    document.teams,
    document.games.map((game) => ({
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      result: resultByGame.get(game.id) ?? null,
      status: game.status,
    })),
    document.league.scoring,
  ).map((row, index) => ({
    differential: row.goalDifferential,
    losses: row.losses,
    played: row.played,
    points: row.points,
    position: index + 1,
    score_against: row.goalsAgainst,
    score_for: row.goalsFor,
    team_id: row.teamId,
    team_name: row.teamName,
    ties: row.ties,
    wins: row.wins,
  }));
}

function csvCell(value: boolean | number | string): string {
  let text = String(value);
  if (
    typeof value === "string" &&
    (/^[\t\r\n]/u.test(text) || /^\s*[=+\-@]/u.test(text))
  ) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
