import { openDB } from "idb";

import {
  parsePortableDocument,
  serializePortableDocument,
  type LeagueDocumentV1,
} from "@/lib/portable";

const DATABASE = "gameology-rec-league-recovery";
const STORE = "working-copies";
const CURRENT_KEY = "current";

export type RecoveryCopy = {
  document: LeagueDocumentV1;
  fileName: string;
  savedAt: string;
};

export async function saveRecoveryCopy(
  document: LeagueDocumentV1,
  fileName: string,
): Promise<void> {
  const database = await recoveryDatabase();
  await database.put(
    STORE,
    {
      bytes: serializePortableDocument(document),
      fileName,
      savedAt: new Date().toISOString(),
    },
    CURRENT_KEY,
  );
}

export async function loadRecoveryCopy(): Promise<RecoveryCopy | null> {
  const database = await recoveryDatabase();
  const value = (await database.get(STORE, CURRENT_KEY)) as
    | { bytes: string; fileName: string; savedAt: string }
    | undefined;
  if (!value) return null;
  return {
    document: parsePortableDocument(value.bytes),
    fileName: value.fileName,
    savedAt: value.savedAt,
  };
}

export async function clearRecoveryCopy(): Promise<void> {
  const database = await recoveryDatabase();
  await database.delete(STORE, CURRENT_KEY);
}

function recoveryDatabase() {
  return openDB(DATABASE, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE);
      }
    },
  });
}
