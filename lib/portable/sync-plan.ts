import { findGameConflict } from "../game-conflicts";
import { managerReportRuleViolation } from "../manager-report-rules";
import type {
  LeagueDocumentV1,
  PortableGame,
  PortableOperation,
} from "./types";

export type PortableSyncActor =
  | { role: "ORGANIZER" }
  | { role: "MANAGER"; teamId: string };

export type PortableSyncPreviewStatus =
  | "blocked-by-dependency"
  | "conflict"
  | "ready"
  | "rejected";

export type PortableSyncPreviewItem = {
  kind: PortableOperation["kind"];
  message: string;
  operationId: string;
  status: PortableSyncPreviewStatus;
};

export type PortableSyncPreview = {
  blockedCount: number;
  conflictCount: number;
  items: PortableSyncPreviewItem[];
  readyCount: number;
  rejectedCount: number;
};

export function planPortableOperations(
  current: LeagueDocumentV1,
  incoming: LeagueDocumentV1,
  actor: PortableSyncActor,
): PortableSyncPreview {
  if (incoming.documentId !== current.documentId) {
    throw new Error("The offline file belongs to a different league.");
  }
  if (!incoming.sync || incoming.sync.mode !== "connected") {
    throw new Error("The file does not contain a connected-mode operation outbox.");
  }

  const games = new Map(
    current.games.map((game) => [game.id, structuredClone(game)]),
  );
  const teams = new Map(
    current.teams.map((team) => [team.id, structuredClone(team)]),
  );
  let leagueVersion = current.league.version;
  let archived = current.league.archivedAt !== null;
  const failedTargets = new Set<string>();
  const items: PortableSyncPreviewItem[] = [];

  for (const operation of incoming.sync.pendingOperations) {
    const target = portableOperationTarget(operation);
    if (target && failedTargets.has(target)) {
      items.push(item(operation, "blocked-by-dependency", "An earlier operation for this record needs attention first."));
      continue;
    }

    let result: Omit<PortableSyncPreviewItem, "kind" | "operationId">;
    if (operation.baseRevision > current.dataRevision) {
      result = {
        message: "The operation was created from a newer server revision.",
        status: "conflict",
      };
    } else if (actor.role === "MANAGER" && operation.kind !== "SUBMIT_REPORT") {
      result = {
        message: "Team managers may synchronize report submissions only.",
        status: "rejected",
      };
    } else if (actor.role === "ORGANIZER" && operation.kind === "SUBMIT_REPORT") {
      result = {
        message: "An organizer file cannot impersonate a team manager.",
        status: "rejected",
      };
    } else if (
      archived &&
      !(
        actor.role === "ORGANIZER" &&
        operation.kind === "ARCHIVE_LEAGUE" &&
        operation.payload.archived === false
      )
    ) {
      result = { message: "The connected league is archived.", status: "rejected" };
    } else {
      result = previewOne(
        operation,
        actor,
        games,
        teams,
        current,
        leagueVersion,
      );
    }

    if (result.status === "ready") {
      switch (operation.kind) {
        case "SET_SCORE":
        case "MARK_RAINOUT":
        case "RESCHEDULE_GAME": {
          const game = games.get(operation.payload.gameId);
          if (game) {
            game.version += 1;
            if (operation.kind === "SET_SCORE") game.status = "COMPLETED";
            if (operation.kind === "MARK_RAINOUT") game.status = "RAINED_OUT";
            if (operation.kind === "RESCHEDULE_GAME") {
              game.fieldName = operation.payload.fieldName;
              game.scheduled = operation.payload.scheduled;
              if (game.status !== "COMPLETED") game.status = "RESCHEDULED";
            }
          }
          break;
        }
        case "UPDATE_LEAGUE":
          leagueVersion += 1;
          break;
        case "ARCHIVE_LEAGUE":
          leagueVersion += 1;
          archived = operation.payload.archived;
          break;
        case "RENAME_TEAM": {
          const team = teams.get(operation.payload.teamId);
          if (team) {
            team.name = operation.payload.name;
            team.version += 1;
          }
          break;
        }
        case "ADD_TEAM":
        case "REMOVE_TEAM":
        case "REVIEW_REPORT":
        case "SUBMIT_REPORT":
          break;
      }
    } else if (target) {
      failedTargets.add(target);
    }
    items.push({ ...result, kind: operation.kind, operationId: operation.operationId });
  }

  return {
    blockedCount: items.filter((entry) => entry.status === "blocked-by-dependency").length,
    conflictCount: items.filter((entry) => entry.status === "conflict").length,
    items,
    readyCount: items.filter((entry) => entry.status === "ready").length,
    rejectedCount: items.filter((entry) => entry.status === "rejected").length,
  };
}

function previewOne(
  operation: PortableOperation,
  actor: PortableSyncActor,
  games: Map<string, PortableGame>,
  teams: Map<string, LeagueDocumentV1["teams"][number]>,
  current: LeagueDocumentV1,
  leagueVersion: number,
): Omit<PortableSyncPreviewItem, "kind" | "operationId"> {
  switch (operation.kind) {
    case "SET_SCORE":
    case "MARK_RAINOUT": {
      const game = games.get(operation.payload.gameId);
      if (!game) return conflictPreview("The game was removed online.");
      if (game.locked) return conflictPreview("The game is locked online.");
      if (game.version !== operation.payload.expectedGameVersion) {
        return conflictPreview("The game changed online.");
      }
      return readyPreview("Ready to update the official game.");
    }
    case "RESCHEDULE_GAME": {
      const game = games.get(operation.payload.gameId);
      if (!game) return conflictPreview("The game was removed online.");
      if (game.locked) return conflictPreview("The game is locked online.");
      if (game.version !== operation.payload.expectedGameVersion) {
        return conflictPreview("The game changed online.");
      }
      if (operation.payload.scheduled.timeZone !== current.league.timeZone) {
        return conflictPreview(
          "The league time zone changed after this reschedule was prepared.",
        );
      }
      const conflict = findGameConflict(
        {
          awayTeamId: game.awayTeamId,
          fieldName: operation.payload.fieldName,
          homeTeamId: game.homeTeamId,
          id: game.id,
          scheduledAt: new Date(operation.payload.scheduled.utc),
        },
        [...games.values()].map((candidate) => ({
          awayTeamId: candidate.awayTeamId,
          fieldName: candidate.fieldName,
          homeTeamId: candidate.homeTeamId,
          id: candidate.id,
          scheduledAt: candidate.scheduled
            ? new Date(candidate.scheduled.utc)
            : null,
          status: candidate.status,
        })),
        current.league.schedule.durationMinutes,
      );
      return conflict
        ? conflictPreview(`The proposed slot now overlaps game ${conflict.id}.`)
        : readyPreview("Ready to reschedule the official game.");
    }
    case "UPDATE_LEAGUE":
      if (operation.payload.changes.schedule || operation.payload.changes.timeZone) {
        return rejectedPreview(
          "Schedule rhythm and time-zone changes need an online rebuild preview.",
        );
      }
      return leagueVersion === operation.payload.expectedLeagueVersion
        ? readyPreview("Ready to update league settings.")
        : conflictPreview("League settings changed online.");
    case "ARCHIVE_LEAGUE":
      return leagueVersion === operation.payload.expectedLeagueVersion
        ? readyPreview(
            operation.payload.archived
              ? "Ready to archive the season."
              : "Ready to reopen the season.",
          )
        : conflictPreview("League lifecycle changed online.");
    case "RENAME_TEAM": {
      const team = teams.get(operation.payload.teamId);
      if (!team) return conflictPreview("The team was removed online.");
      if (team.version !== operation.payload.expectedTeamVersion) {
        return conflictPreview("The team changed online.");
      }
      const duplicate = [...teams.values()].some(
        (candidate) =>
          candidate.id !== team.id &&
          candidate.name.trim().toLocaleLowerCase() ===
            operation.payload.name.trim().toLocaleLowerCase(),
      );
      return duplicate
        ? conflictPreview("Another team already uses that name.")
        : readyPreview("Ready to rename the team.");
    }
    case "SUBMIT_REPORT": {
      if (actor.role !== "MANAGER" || operation.payload.teamId !== actor.teamId) {
        return rejectedPreview("The report is outside this manager assignment.");
      }
      const game = games.get(operation.payload.gameId);
      if (!game) return conflictPreview("The game was removed online.");
      if (game.locked || game.version !== operation.payload.expectedGameVersion) {
        return conflictPreview("The official game changed or is locked.");
      }
      if (game.homeTeamId !== actor.teamId && game.awayTeamId !== actor.teamId) {
        return rejectedPreview("The assigned team is not part of this game.");
      }
      const ruleViolation = managerReportRuleViolation({
        game: {
          awayTeamId: game.awayTeamId,
          hasResult: current.results.some(
            (result) => result.gameId === operation.payload.gameId,
          ),
          homeTeamId: game.homeTeamId,
          id: game.id,
        },
        gameDurationMinutes: current.league.schedule.durationMinutes,
        games: [...games.values()].map((candidate) => ({
          awayTeamId: candidate.awayTeamId,
          fieldName: candidate.fieldName,
          homeTeamId: candidate.homeTeamId,
          id: candidate.id,
          scheduledAt: candidate.scheduled
            ? new Date(candidate.scheduled.utc)
            : null,
          status: candidate.status,
        })),
        leagueTimeZone: current.league.timeZone,
        proposedSlot: operation.payload.proposedScheduled
          ? {
              fieldName: operation.payload.proposedFieldName,
              scheduledAt: new Date(operation.payload.proposedScheduled.utc),
              timeZone: operation.payload.proposedScheduled.timeZone,
            }
          : null,
        reportType: operation.payload.reportType,
      });
      if (ruleViolation) return conflictPreview(ruleViolation);
      return readyPreview("Ready to submit for organizer review.");
    }
    case "ADD_TEAM":
    case "REMOVE_TEAM":
      return rejectedPreview(
        "Team roster changes require the connected schedule-rebuild workflow.",
      );
    case "REVIEW_REPORT":
      return rejectedPreview("Review reports from the connected organizer board.");
  }
}

export function portableOperationTarget(operation: PortableOperation): string | null {
  switch (operation.kind) {
    case "SET_SCORE":
    case "MARK_RAINOUT":
    case "RESCHEDULE_GAME":
    case "SUBMIT_REPORT":
      return `game:${operation.payload.gameId}`;
    case "ADD_TEAM":
      return `team:${operation.payload.proposedTeamId}`;
    case "REMOVE_TEAM":
    case "RENAME_TEAM":
      return `team:${operation.payload.teamId}`;
    case "REVIEW_REPORT":
      return `report:${operation.payload.reportId}`;
    case "ARCHIVE_LEAGUE":
    case "UPDATE_LEAGUE":
      return "league";
  }
}

function item(
  operation: PortableOperation,
  status: PortableSyncPreviewStatus,
  message: string,
): PortableSyncPreviewItem {
  return { kind: operation.kind, message, operationId: operation.operationId, status };
}

function readyPreview(message: string) {
  return { message, status: "ready" as const };
}

function conflictPreview(message: string) {
  return { message, status: "conflict" as const };
}

function rejectedPreview(message: string) {
  return { message, status: "rejected" as const };
}
