import { useEffect, useMemo, useRef, useState } from "react";

import {
  PortableDocumentValidationError,
  PortableEditorError,
  createLocalLeagueDocument,
  serializePortableDocument,
  type CreateLocalLeagueInput,
  type LeagueDocumentV1,
} from "@/lib/portable";

import { StartScreen } from "./components/StartScreen";
import { Workspace } from "./components/Workspace";
import {
  choosePortableFile,
  downloadPublicPage,
  downloadPortableCopy,
  portableFileName,
  readPortableFile,
  savePortableFile,
} from "./file-io";
import {
  clearRecoveryCopy,
  loadRecoveryCopy,
  saveRecoveryCopy,
  type RecoveryCopy,
} from "./recovery";

type WorkspaceState = {
  document: LeagueDocumentV1;
  fileName: string;
  handle: PortableFileHandle | null;
  savedBytes: string;
};

export function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [history, setHistory] = useState<LeagueDocumentV1[]>([]);
  const [recovery, setRecovery] = useState<RecoveryCopy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(
    () =>
      workspace
        ? serializePortableDocument(workspace.document) !== workspace.savedBytes
        : false,
    [workspace],
  );

  useEffect(() => {
    loadRecoveryCopy()
      .then(setRecovery)
      .catch(() => setRecovery(null));
  }, []);

  useEffect(() => {
    if (!workspace) return;
    const timeout = window.setTimeout(() => {
      saveRecoveryCopy(workspace.document, workspace.fileName)
        .then(() =>
          setRecovery({
            document: workspace.document,
            fileName: workspace.fileName,
            savedAt: new Date().toISOString(),
          }),
        )
        .catch(() => {
          // Recovery is optional and must never interrupt file-based work.
        });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [workspace]);

  function openWorkspace(next: WorkspaceState) {
    setWorkspace(next);
    setHistory([]);
    setError(null);
    setNotice(null);
  }

  function createLeague(input: CreateLocalLeagueInput) {
    try {
      const document = createLocalLeagueDocument(input);
      openWorkspace({
        document,
        fileName: portableFileName(document),
        handle: null,
        savedBytes: "",
      });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function openFilePicker() {
    setBusy(true);
    setError(null);
    try {
      const opened = await choosePortableFile();
      if (!opened) {
        fileInput.current?.click();
        return;
      }
      const bytes = serializePortableDocument(opened.document);
      openWorkspace({
        document: opened.document,
        fileName: opened.fileName,
        handle: opened.handle,
        savedBytes: bytes,
      });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function openFallbackFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const document = await readPortableFile(file);
      openWorkspace({
        document,
        fileName: file.name,
        handle: null,
        savedBytes: serializePortableDocument(document),
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function recoverWorkingCopy() {
    if (!recovery) return;
    openWorkspace({
      document: recovery.document,
      fileName: recovery.fileName,
      handle: null,
      savedBytes: "",
    });
    setNotice(
      "Recovered the browser/device copy. Download or save it to make a durable file.",
    );
  }

  function commit(change: (document: LeagueDocumentV1) => LeagueDocumentV1) {
    if (!workspace) return;
    try {
      const next = change(workspace.document);
      setHistory((current) => [...current.slice(-19), workspace.document]);
      setWorkspace({ ...workspace, document: next });
      setError(null);
      setNotice(null);
    } catch (caught) {
      setError(errorMessage(caught));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function undo() {
    if (!workspace || !history.length) return;
    const previous = history[history.length - 1];
    setHistory((current) => current.slice(0, -1));
    setWorkspace({ ...workspace, document: previous });
    setError(null);
    setNotice("Undid the latest change in this session.");
  }

  async function save() {
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const result = await savePortableFile(
        workspace.document,
        workspace.handle,
        workspace.fileName,
      );
      setWorkspace({ ...workspace, savedBytes: result.bytes });
      setNotice(
        result.usedHandle
          ? "Saved to the opened league file."
          : "Downloaded an updated league file. Keep it somewhere you control.",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function downloadCopy() {
    if (!workspace) return;
    try {
      const fileName = portableFileName(workspace.document);
      const bytes = downloadPortableCopy(workspace.document, fileName);
      setWorkspace({ ...workspace, fileName, savedBytes: bytes });
      setNotice("Downloaded a portable JSON copy.");
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function downloadFamilyPage() {
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      await downloadPublicPage(workspace.document);
      setNotice("Downloaded a privacy-safe, read-only family webpage.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function closeWorkspace() {
    if (dirty && !window.confirm("Close this league? Unsaved changes remain in the browser recovery copy only.")) {
      return;
    }
    setWorkspace(null);
    setHistory([]);
    setError(null);
    setNotice(null);
  }

  async function discardRecovery() {
    try {
      await clearRecoveryCopy();
      setRecovery(null);
    } catch {
      setError("The browser recovery copy could not be cleared.");
    }
  }

  return (
    <>
      <input
        accept=".json,.rec-league.json,application/json,application/vnd.gameology.rec-league+json"
        className="hidden"
        onChange={(event) => openFallbackFile(event.target.files?.[0] ?? null)}
        ref={fileInput}
        type="file"
      />
      {workspace ? (
        <Workspace
          busy={busy}
          dirty={dirty}
          document={workspace.document}
          error={error}
          fileName={workspace.fileName}
          hasFileHandle={Boolean(workspace.handle)}
          historyCount={history.length}
          notice={notice}
          onChange={commit}
          onClose={closeWorkspace}
          onDownload={downloadCopy}
          onDownloadFamily={downloadFamilyPage}
          onSave={save}
          onUndo={undo}
        />
      ) : (
        <StartScreen
          busy={busy}
          error={error}
          onCreate={createLeague}
          onDiscardRecovery={discardRecovery}
          onOpen={openFilePicker}
          onRecover={recoverWorkingCopy}
          recovery={recovery}
        />
      )}
    </>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof PortableDocumentValidationError) {
    const issue = error.issues[0];
    return issue ? `${issue.path}: ${issue.message}` : error.message;
  }
  if (error instanceof PortableEditorError || error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Your existing file was not changed.";
}
