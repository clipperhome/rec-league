import type { LeagueDocumentV1, PortableJsonValue } from "./types";
import { assertPortableDocument } from "./validate";

export function canonicalizePortableDocument(
  input: LeagueDocumentV1,
): LeagueDocumentV1 {
  const document = assertPortableDocument(input);
  const normalized: LeagueDocumentV1 = {
    ...document,
    games: [...document.games].sort(
      (left, right) => left.round - right.round || left.id.localeCompare(right.id),
    ),
    results: [...document.results].sort(
      (left, right) =>
        left.gameId.localeCompare(right.gameId) || left.id.localeCompare(right.id),
    ),
    teams: [...document.teams].sort((left, right) => left.id.localeCompare(right.id)),
  };

  if (document.privateData) {
    normalized.privateData = {
      ...document.privateData,
      activity: [...document.privateData.activity].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
      managers: [...document.privateData.managers].sort(
        (left, right) =>
          left.teamId.localeCompare(right.teamId) ||
          left.email.localeCompare(right.email) ||
          left.id.localeCompare(right.id),
      ),
      reports: [...document.privateData.reports].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
    };
  }

  if (document.teamPacket) {
    normalized.teamPacket = {
      ...document.teamPacket,
      reports: [...document.teamPacket.reports].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      ),
    };
  }

  // Outbox order is intentional and must not be sorted.
  if (document.sync) {
    normalized.sync = {
      ...document.sync,
      pendingOperations: [...document.sync.pendingOperations],
    };
  }

  return sortObjectKeys(normalized) as LeagueDocumentV1;
}

export function serializePortableDocument(document: LeagueDocumentV1): string {
  return `${JSON.stringify(canonicalizePortableDocument(document), null, 2)}\n`;
}

export function serializeCanonicalJsonValue(value: PortableJsonValue): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): PortableJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (typeof value !== "object") {
    throw new TypeError("Portable documents may contain only JSON values.");
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObjectKeys(entry)]),
  );
}
