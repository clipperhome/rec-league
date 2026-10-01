"use client";

import { useEffect, useRef, useState } from "react";

import { serializePortableDocument } from "@/lib/portable/canonical-json";
import type { LeagueDocumentV1 } from "@/lib/portable/types";

import { SpreadsheetDataPanel } from "./spreadsheet-data-panel";

type ImportSummary = {
  activityCount: number;
  gameCount: number;
  leagueName: string;
  managerCount: number;
  pendingOperationCount: number;
  pendingReportCount: number;
  reportCount: number;
  resultCount: number;
  schemaVersion: number;
  sourceRevision: number;
  teamCount: number;
  warnings: string[];
};

type ImportPreview = {
  currentBackupUrl: string;
  expiresAt: string;
  previewId: string;
  sourceHash: string;
  summary: ImportSummary;
};

type SyncPlanItem = {
  kind: string;
  message: string;
  operationId: string;
  status: "blocked-by-dependency" | "conflict" | "ready" | "rejected";
};

type SyncPreview = {
  plan: {
    blockedCount: number;
    conflictCount: number;
    items: SyncPlanItem[];
    readyCount: number;
    rejectedCount: number;
  };
  previewId: string;
  sourceHash: string;
};

type SyncResult = {
  document: LeagueDocumentV1;
  results: Array<{
    kind: string;
    message: string;
    operationId: string;
    status: "applied" | "blocked-by-dependency" | "conflict" | "rejected";
  }>;
  summary: {
    applied: number;
    blocked: number;
    conflicts: number;
    rejected: number;
  };
};

export function PortableDataPanel({
  dataRevision,
  slug,
  teams,
  verified,
}: {
  dataRevision: number;
  slug: string;
  teams: Array<{ id: string; name: string }>;
  verified: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"apply" | "preview" | null>(null);
  const [syncFile, setSyncFile] = useState<File | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncWorking, setSyncWorking] = useState<"apply" | "preview" | null>(null);
  const [reconciledUrl, setReconciledUrl] = useState<string | null>(null);
  const exportBase = `/api/leagues/${encodeURIComponent(slug)}/portable`;

  useEffect(() => {
    return () => {
      if (reconciledUrl) URL.revokeObjectURL(reconciledUrl);
    };
  }, [reconciledUrl]);

  async function previewImport() {
    if (!file) {
      setError("Choose a .rec-league.json backup first.");
      inputRef.current?.focus();
      return;
    }
    setWorking("preview");
    setError(null);
    setPreview(null);
    try {
      const response = await fetch(`${exportBase}/import/preview`, {
        body: file,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/vnd.gameology.rec-league+json",
        },
        method: "POST",
      });
      const body = (await response.json()) as
        | ImportPreview
        | { error?: string; issues?: Array<{ message: string; path: string }> };
      if (!response.ok || !("previewId" in body)) {
        const firstIssue = "issues" in body ? body.issues?.[0] : undefined;
        throw new Error(
          firstIssue
            ? `${firstIssue.path}: ${firstIssue.message}`
            : "error" in body && body.error
              ? body.error
              : "The backup could not be previewed.",
        );
      }
      setPreview(body);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The backup could not be previewed.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function applyImport() {
    if (!preview) return;
    setWorking("apply");
    setError(null);
    try {
      const response = await fetch(`${exportBase}/import/apply`, {
        body: JSON.stringify({ previewId: preview.previewId }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as {
        error?: string;
        redirectUrl?: string;
      };
      if (!response.ok || !body.redirectUrl) {
        throw new Error(body.error ?? "The league copy could not be created.");
      }
      window.location.assign(body.redirectUrl);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The league copy could not be created.",
      );
      setWorking(null);
    }
  }

  async function previewSync() {
    if (!syncFile) {
      setSyncError("Choose the connected offline file first.");
      return;
    }
    setSyncWorking("preview");
    setSyncError(null);
    setSyncPreview(null);
    setSyncResult(null);
    try {
      const response = await fetch(`${exportBase}/reconcile/preview`, {
        body: syncFile,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/vnd.gameology.rec-league+json",
        },
        method: "POST",
      });
      const body = (await response.json()) as
        | SyncPreview
        | { error?: string; issues?: Array<{ message: string; path: string }> };
      if (!response.ok || !("previewId" in body)) {
        const firstIssue = "issues" in body ? body.issues?.[0] : undefined;
        throw new Error(
          firstIssue
            ? `${firstIssue.path}: ${firstIssue.message}`
            : "error" in body && body.error
              ? body.error
              : "The offline changes could not be previewed.",
        );
      }
      setSyncPreview(body);
    } catch (caught) {
      setSyncError(
        caught instanceof Error
          ? caught.message
          : "The offline changes could not be previewed.",
      );
    } finally {
      setSyncWorking(null);
    }
  }

  async function applySync() {
    if (!syncPreview) return;
    setSyncWorking("apply");
    setSyncError(null);
    try {
      const response = await fetch(`${exportBase}/reconcile/apply`, {
        body: JSON.stringify({ previewId: syncPreview.previewId }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as SyncResult | { error?: string };
      if (!response.ok || !("document" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The offline changes could not be reconciled.",
        );
      }
      if (reconciledUrl) URL.revokeObjectURL(reconciledUrl);
      const url = URL.createObjectURL(
        new Blob([serializePortableDocument(body.document)], {
          type: "application/vnd.gameology.rec-league+json",
        }),
      );
      setReconciledUrl(url);
      setSyncResult(body);
      setSyncPreview(null);
    } catch (caught) {
      setSyncError(
        caught instanceof Error
          ? caught.message
          : "The offline changes could not be reconciled.",
      );
    } finally {
      setSyncWorking(null);
    }
  }

  return (
    <div className="mt-5 space-y-5">
      {!verified ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 sm:p-6">
          <p className="font-black">Verify the organizer email first</p>
          <p className="mt-1 text-sm leading-6">
            Complete backups contain private manager emails and report notes. They
            become available after the one-use verification link confirms ownership.
          </p>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
        <div className="border-b border-[#e1e8e3] p-5 sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
            Your data, in your hands
          </p>
          <h3 className="mt-1 text-2xl font-bold">Download portable copies</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#627068]">
            JSON is the complete, human-readable source format. The app database is
            still the official copy while this league is connected. Current data
            revision: <strong className="text-[#10231c]">{dataRevision}</strong>.
          </p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <article className="rounded-xl border border-[#0f5138] bg-[#f3f8f4] p-4 sm:col-span-2">
            <p className="font-bold">Portable offline webpage</p>
            <p className="mt-1 text-sm leading-6 text-[#526159]">
              Download this self-contained app once, then double-click it whenever
              you need to open a league JSON file. Replacing the webpage upgrades
              the tool without replacing your data.
            </p>
            <a
              className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[#0f5138] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0a3828]"
              download="rec-league.html"
              href="/downloads/rec-league.html"
            >
              Download offline app
            </a>
          </article>

          <article className="rounded-xl border border-[#d9e2dc] p-4">
            <p className="font-bold">Complete organizer backup</p>
            <p className="mt-1 text-sm leading-6 text-[#627068]">
              Full-fidelity league data, including manager emails, private reports,
              and history. Keep it somewhere private.
            </p>
            <a
              aria-disabled={!verified}
              className={`mt-4 inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-bold ${verified ? "bg-[#0f5138] text-white hover:bg-[#0a3828]" : "pointer-events-none bg-[#d9e2dc] text-[#627068]"}`}
              href={`${exportBase}?scope=organizer-backup`}
            >
              Download complete JSON
            </a>
          </article>

          <article className="rounded-xl border border-[#d9e2dc] p-4">
            <p className="font-bold">Public-safe data</p>
            <p className="mt-1 text-sm leading-6 text-[#627068]">
              Schedule, teams, venue, official results, and scoring rules only. No
              emails, report notes, or private activity.
            </p>
            <a
              aria-disabled={!verified}
              className={`mt-4 inline-flex min-h-11 items-center rounded-lg border px-4 py-2.5 text-sm font-bold ${verified ? "border-[#0f5138] text-[#0f5138] hover:bg-[#e9f0eb]" : "pointer-events-none border-[#d9e2dc] text-[#829087]"}`}
              href={`${exportBase}?scope=public-snapshot`}
            >
              Download public JSON
            </a>
            <a
              aria-disabled={!verified}
              className={`ml-2 mt-4 inline-flex min-h-11 items-center rounded-lg border px-4 py-2.5 text-sm font-bold ${verified ? "border-[#0f5138] text-[#0f5138] hover:bg-[#e9f0eb]" : "pointer-events-none border-[#d9e2dc] text-[#829087]"}`}
              download
              href={`${exportBase}/public-html`}
            >
              Download family webpage
            </a>
          </article>

          <article className="rounded-xl border border-[#d9e2dc] p-4 sm:col-span-2">
            <p className="font-bold">Team-manager packet</p>
            <p className="mt-1 text-sm leading-6 text-[#627068]">
              Only one team’s games and reports, plus opponent display names. Other
              manager identities and league history stay out.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="portable-team">
                Team
              </label>
              <select
                className="min-h-11 flex-1 rounded-lg border border-[#bdcbc2] bg-white px-3 py-2 text-sm font-semibold"
                id="portable-team"
                onChange={(event) => setSelectedTeamId(event.target.value)}
                value={selectedTeamId}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <a
                aria-disabled={!verified || !selectedTeamId}
                className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-bold ${verified && selectedTeamId ? "border-[#0f5138] text-[#0f5138] hover:bg-[#e9f0eb]" : "pointer-events-none border-[#d9e2dc] text-[#829087]"}`}
                href={`${exportBase}?scope=team-manager-packet&teamId=${encodeURIComponent(selectedTeamId)}`}
              >
                Download team packet
              </a>
            </div>
          </article>
        </div>
      </section>

      <SpreadsheetDataPanel slug={slug} verified={verified} />

      <section className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
        <div className="border-b border-[#e1e8e3] p-5 sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
            Safe restore
          </p>
          <h3 className="mt-1 text-2xl font-bold">Create a separate connected copy</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#627068]">
            This never overwrites the league you are viewing. The file is validated,
            summarized, and held for 15 minutes before you confirm. Imported owner
            or manager fields cannot grant access.
          </p>
        </div>
        <div className="p-5 sm:p-6">
          <label className="block text-sm font-bold" htmlFor="portable-backup-file">
            Portable organizer backup
          </label>
          <input
            accept=".json,.rec-league.json,application/json,application/vnd.gameology.rec-league+json"
            className="mt-2 block w-full rounded-lg border border-[#bdcbc2] bg-white px-3 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#e9f0eb] file:px-3 file:py-2 file:font-bold file:text-[#0f5138]"
            disabled={!verified || working !== null}
            id="portable-backup-file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setError(null);
            }}
            ref={inputRef}
            type="file"
          />
          <button
            className="mt-4 min-h-11 rounded-lg bg-[#10231c] px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!verified || !file || working !== null}
            onClick={previewImport}
            type="button"
          >
            {working === "preview" ? "Checking backup…" : "Review before creating copy"}
          </button>

          {error ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">
              {error}
            </p>
          ) : null}

          {preview ? (
            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950 sm:p-5">
              <p className="text-sm font-bold uppercase tracking-[0.12em] text-blue-800">
                Validated preview
              </p>
              <h4 className="mt-1 text-xl font-black">{preview.summary.leagueName}</h4>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <PreviewStat label="Teams" value={preview.summary.teamCount} />
                <PreviewStat label="Games" value={preview.summary.gameCount} />
                <PreviewStat label="Results" value={preview.summary.resultCount} />
                <PreviewStat label="Reports" value={preview.summary.reportCount} />
              </dl>
              <p className="mt-4 text-sm">
                Schema {preview.summary.schemaVersion} · source revision {preview.summary.sourceRevision} · fingerprint {preview.sourceHash.slice(0, 12)}…
              </p>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-6">
                {preview.summary.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  className="min-h-11 rounded-lg bg-blue-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
                  disabled={working !== null}
                  onClick={applyImport}
                  type="button"
                >
                  {working === "apply" ? "Creating copy…" : "Create separate league copy"}
                </button>
                <a
                  className="text-sm font-bold text-blue-900 underline underline-offset-4"
                  href={preview.currentBackupUrl}
                >
                  Download current league first
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
        <div className="border-b border-[#e1e8e3] p-5 sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
            Connected offline changes
          </p>
          <h3 className="mt-1 text-2xl font-bold">Reconcile an offline working file</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#627068]">
            The online league remains official. Only typed changes in the file’s
            outbox are considered—never a whole-document overwrite. Every change is
            checked against its game, team, or league version, and conflicts remain
            in the downloaded reconciled file.
          </p>
        </div>
        <div className="p-5 sm:p-6">
          <label className="block text-sm font-bold" htmlFor="portable-sync-file">
            Connected offline working file
          </label>
          <input
            accept=".json,.rec-league.json,application/json,application/vnd.gameology.rec-league+json"
            className="mt-2 block w-full rounded-lg border border-[#bdcbc2] bg-white px-3 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#e9f0eb] file:px-3 file:py-2 file:font-bold file:text-[#0f5138]"
            disabled={!verified || syncWorking !== null}
            id="portable-sync-file"
            onChange={(event) => {
              setSyncFile(event.target.files?.[0] ?? null);
              setSyncPreview(null);
              setSyncResult(null);
              setSyncError(null);
            }}
            type="file"
          />
          <button
            className="mt-4 min-h-11 rounded-lg bg-[#10231c] px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!verified || !syncFile || syncWorking !== null}
            onClick={previewSync}
            type="button"
          >
            {syncWorking === "preview" ? "Checking changes…" : "Preview offline changes"}
          </button>

          {syncError ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">
              {syncError}
            </p>
          ) : null}

          {syncPreview ? (
            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950 sm:p-5">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <PreviewStat label="Ready" value={syncPreview.plan.readyCount} />
                <PreviewStat label="Conflicts" value={syncPreview.plan.conflictCount} />
                <PreviewStat label="Rejected" value={syncPreview.plan.rejectedCount} />
                <PreviewStat label="Blocked" value={syncPreview.plan.blockedCount} />
              </div>
              <ol className="mt-4 max-h-80 divide-y divide-blue-100 overflow-y-auto rounded-lg border border-blue-200 bg-white">
                {syncPreview.plan.items.map((item) => (
                  <li className="flex gap-3 px-3 py-3 text-sm" key={item.operationId}>
                    <SyncStatus status={item.status} />
                    <span>
                      <strong>{readableOperation(item.kind)}</strong>
                      <span className="mt-0.5 block text-[#627068]">{item.message}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <button
                className="mt-5 min-h-11 rounded-lg bg-blue-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
                disabled={syncWorking !== null}
                onClick={applySync}
                type="button"
              >
                {syncWorking === "apply"
                  ? "Reconciling…"
                  : syncPreview.plan.readyCount
                    ? `Apply ${syncPreview.plan.readyCount} safe ${syncPreview.plan.readyCount === 1 ? "change" : "changes"}`
                    : "Refresh file and preserve conflicts"}
              </button>
            </div>
          ) : null}

          {syncResult ? (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 sm:p-5">
              <p className="font-black">
                {syncResult.summary.applied} offline {syncResult.summary.applied === 1 ? "change" : "changes"} applied
              </p>
              <p className="mt-1 text-sm leading-6">
                {syncResult.summary.conflicts + syncResult.summary.rejected + syncResult.summary.blocked} need attention and remain in the reconciled file.
              </p>
              <ol className="mt-4 max-h-72 divide-y divide-emerald-100 overflow-y-auto rounded-lg border border-emerald-200 bg-white">
                {syncResult.results.map((item) => (
                  <li className="px-3 py-3 text-sm" key={item.operationId}>
                    <strong>
                      {readableOperation(item.kind)} · {item.status === "applied" ? "Applied" : item.status === "blocked-by-dependency" ? "Blocked" : item.status[0].toUpperCase() + item.status.slice(1)}
                    </strong>
                    <span className="mt-0.5 block text-[#627068]">{item.message}</span>
                  </li>
                ))}
              </ol>
              {reconciledUrl ? (
                <a
                  className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-emerald-950 px-4 py-2.5 text-sm font-bold text-white"
                  download={`${slug}.reconciled.rec-league.json`}
                  href={reconciledUrl}
                >
                  Download reconciled working file
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/80 px-3 py-2">
      <dt className="text-blue-900/70">{label}</dt>
      <dd className="mt-0.5 text-lg font-black">{value}</dd>
    </div>
  );
}

function SyncStatus({ status }: { status: SyncPlanItem["status"] }) {
  const styles = {
    "blocked-by-dependency": "bg-slate-100 text-slate-800",
    conflict: "bg-amber-100 text-amber-900",
    ready: "bg-emerald-100 text-emerald-900",
    rejected: "bg-red-100 text-red-900",
  };
  return (
    <span className={`h-fit shrink-0 rounded-full px-2 py-1 text-xs font-bold ${styles[status]}`}>
      {status === "blocked-by-dependency" ? "Blocked" : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

function readableOperation(value: string): string {
  return value
    .toLocaleLowerCase()
    .split("_")
    .map((part) => part[0]?.toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
