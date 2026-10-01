import {
  PORTABLE_FORMAT,
  PORTABLE_SCHEMA_VERSION,
  type LeagueDocumentV1,
} from "./types";
import { PortableDocumentValidationError, assertPortableDocument } from "./validate";

type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

// Version 1 is the first public format. New releases add one pure vN -> vN+1
// function here and fixture-test it before increasing PORTABLE_SCHEMA_VERSION.
const migrations = new Map<number, Migration>();

export function migratePortableDocument(value: unknown): LeagueDocumentV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return assertPortableDocument(value);
  }

  const candidate = structuredClone(value) as Record<string, unknown>;
  if (candidate.format !== PORTABLE_FORMAT) return assertPortableDocument(candidate);

  const version = candidate.schemaVersion;
  if (!Number.isInteger(version)) return assertPortableDocument(candidate);
  if ((version as number) > PORTABLE_SCHEMA_VERSION) {
    throw new PortableDocumentValidationError([
      {
        code: "unsupported-version",
        message: `This file uses schema version ${version}. Upgrade the app before editing it; this version supports through ${PORTABLE_SCHEMA_VERSION}.`,
        path: "$.schemaVersion",
      },
    ]);
  }

  let current = candidate;
  let currentVersion = version as number;
  while (currentVersion < PORTABLE_SCHEMA_VERSION) {
    const migrate = migrations.get(currentVersion);
    if (!migrate) {
      throw new PortableDocumentValidationError([
        {
          code: "unsupported-version",
          message: `Schema version ${currentVersion} cannot be migrated by this app.`,
          path: "$.schemaVersion",
        },
      ]);
    }
    current = migrate(current);
    currentVersion += 1;
    current.schemaVersion = currentVersion;
  }

  return assertPortableDocument(current);
}
