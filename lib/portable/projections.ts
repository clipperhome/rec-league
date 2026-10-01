import type {
  LeagueDocumentV1,
  PortableExportMetadata,
  PortableTeamPacketReport,
} from "./types";
import { assertPortableDocument } from "./validate";

export type ProjectionMetadata = {
  appVersion?: string;
  exportedAt?: string;
};

export function projectPublicSnapshot(
  source: LeagueDocumentV1,
  metadata: ProjectionMetadata = {},
): LeagueDocumentV1 {
  const document = requireOrganizerSource(source);
  return assertPortableDocument({
    ...publicDomainData(document),
    export: exportMetadata(document, "public-snapshot", false, metadata),
  });
}

export function projectSpreadsheetOperations(
  source: LeagueDocumentV1,
  metadata: ProjectionMetadata = {},
): LeagueDocumentV1 {
  const document = requireOrganizerSource(source);
  return assertPortableDocument({
    ...publicDomainData(document),
    export: exportMetadata(document, "spreadsheet-operations", false, metadata),
  });
}

export function projectTeamManagerPacket(
  source: LeagueDocumentV1,
  teamId: string,
  metadata: ProjectionMetadata = {},
): LeagueDocumentV1 {
  const document = requireOrganizerSource(source);
  if (!document.teams.some((team) => team.id === teamId)) {
    throw new Error("The team does not belong to this league.");
  }

  const games = document.games.filter(
    (game) => game.homeTeamId === teamId || game.awayTeamId === teamId,
  );
  const gameIds = new Set(games.map((game) => game.id));
  const includedTeamIds = new Set(
    games.flatMap((game) => [game.homeTeamId, game.awayTeamId]),
  );
  includedTeamIds.add(teamId);

  const reports: PortableTeamPacketReport[] = (document.privateData?.reports ?? [])
    .filter((report) => report.teamId === teamId && gameIds.has(report.gameId))
    .map((report) => ({
      awayScore: report.awayScore,
      createdAt: report.createdAt,
      decisionNote: report.decisionNote,
      gameId: report.gameId,
      gameVersion: report.gameVersion,
      homeScore: report.homeScore,
      id: report.id,
      note: report.note,
      proposedFieldName: report.proposedFieldName,
      proposedScheduled: report.proposedScheduled,
      reviewedAt: report.reviewedAt,
      status: report.status,
      teamId: report.teamId,
      type: report.type,
      updatedAt: report.updatedAt,
      version: report.version,
    }));

  return assertPortableDocument({
    $schema: document.$schema,
    dataRevision: document.dataRevision,
    documentId: document.documentId,
    export: exportMetadata(document, "team-manager-packet", true, metadata),
    format: document.format,
    games,
    league: document.league,
    results: document.results.filter((result) => gameIds.has(result.gameId)),
    schemaVersion: document.schemaVersion,
    teamPacket: { reports, teamId },
    teams: document.teams.filter((team) => includedTeamIds.has(team.id)),
  });
}

function publicDomainData(document: LeagueDocumentV1) {
  return {
    $schema: document.$schema,
    dataRevision: document.dataRevision,
    documentId: document.documentId,
    format: document.format,
    games: document.games,
    league: document.league,
    results: document.results,
    schemaVersion: document.schemaVersion,
    teams: document.teams,
  };
}

function requireOrganizerSource(source: LeagueDocumentV1): LeagueDocumentV1 {
  const document = assertPortableDocument(source);
  if (document.export.scope !== "organizer-backup" || !document.privateData) {
    throw new Error("A projection must start from a complete organizer backup.");
  }
  return document;
}

function exportMetadata(
  source: LeagueDocumentV1,
  scope: PortableExportMetadata["scope"],
  containsPrivateData: boolean,
  metadata: ProjectionMetadata,
): PortableExportMetadata {
  return {
    appVersion: metadata.appVersion ?? source.export.appVersion,
    containsPrivateData,
    exportedAt: metadata.exportedAt ?? new Date().toISOString(),
    scope,
    source: source.export.source,
  };
}
