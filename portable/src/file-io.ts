import {
  generatePublicLeagueHtml,
  buildPortableCsv,
  migratePortableDocument,
  parseStrictJsonBytes,
  projectPublicSnapshot,
  serializePortableDocument,
  type LeagueDocumentV1,
  type PortableCsvTable,
} from "@/lib/portable";

const MIME = "application/vnd.gameology.rec-league+json";

export type OpenedPortableFile = {
  document: LeagueDocumentV1;
  fileName: string;
  handle: PortableFileHandle | null;
};

export async function choosePortableFile(): Promise<OpenedPortableFile | null> {
  if (!window.showOpenFilePicker) return null;
  const [handle] = await window.showOpenFilePicker({
    excludeAcceptAllOption: false,
    multiple: false,
    types: [
      {
        accept: {
          [MIME]: [".json"],
          "application/json": [".json"],
        },
        description: "Rec League JSON",
      },
    ],
  });
  if (!handle) return null;
  const file = await handle.getFile();
  return {
    document: await readPortableFile(file),
    fileName: file.name,
    handle,
  };
}

export async function readPortableFile(file: File): Promise<LeagueDocumentV1> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return migratePortableDocument(parseStrictJsonBytes(bytes));
}

export async function savePortableFile(
  document: LeagueDocumentV1,
  handle: PortableFileHandle | null,
  fileName: string,
): Promise<{ bytes: string; usedHandle: boolean }> {
  const bytes = serializePortableDocument(document);
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return { bytes, usedHandle: true };
  }
  downloadText(bytes, fileName, MIME);
  return { bytes, usedHandle: false };
}

export function downloadPortableCopy(
  document: LeagueDocumentV1,
  fileName: string,
): string {
  const bytes = serializePortableDocument(document);
  downloadText(bytes, fileName, MIME);
  return bytes;
}

export function downloadPortableCsv(
  document: LeagueDocumentV1,
  table: PortableCsvTable,
): void {
  downloadText(
    buildPortableCsv(document, table),
    `${document.league.slug}.${table}.csv`,
    "text/csv;charset=utf-8",
  );
}

export async function downloadPublicPage(
  document: LeagueDocumentV1,
): Promise<void> {
  const exportedAt = new Date().toISOString();
  const snapshot = projectPublicSnapshot(document, { exportedAt });
  const html = await generatePublicLeagueHtml(snapshot);
  downloadText(
    html,
    `${document.league.slug}.public.html`,
    "text/html;charset=utf-8",
  );
}

export function portableFileName(document: LeagueDocumentV1): string {
  const suffix =
    document.export.scope === "team-manager-packet" ? ".team" : "";
  return `${document.league.slug}${suffix}.rec-league.json`;
}

function downloadText(text: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
