"use client";

import { useEffect, useState } from "react";

import { serializePortableDocument } from "@/lib/portable/canonical-json";
import type { LeagueDocumentV1 } from "@/lib/portable/types";

type SyncStatus =
  | "blocked-by-dependency"
  | "conflict"
  | "ready"
  | "rejected";

type SyncPreview = {
  plan: {
    blockedCount: number;
    conflictCount: number;
    items: Array<{
      kind: string;
      message: string;
      operationId: string;
      status: SyncStatus;
    }>;
    readyCount: number;
    rejectedCount: number;
  };
  previewId: string;
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

export function TeamPortablePanel({
  archived,
  canSync,
  teamId,
  teamName,
}: {
  archived: boolean;
  canSync: boolean;
  teamId: string;
  teamName: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"apply" | "preview" | null>(null);
  const [reconciledUrl, setReconciledUrl] = useState<string | null>(null);
  const endpoint = `/api/teams/${encodeURIComponent(teamId)}/portable`;

  useEffect(() => {
    return () => {
      if (reconciledUrl) URL.revokeObjectURL(reconciledUrl);
    };
  }, [reconciledUrl]);

  async function previewReports() {
    if (!file) {
      setError("Choose your connected team packet first.");
      return;
    }
    setWorking("preview");
    setError(null);
    setPreview(null);
    setResult(null);
    try {
      const response = await fetch(`${endpoint}/reconcile/preview`, {
        body: file,
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
        const issue = "issues" in body ? body.issues?.[0] : undefined;
        throw new Error(
          issue
            ? `${issue.path}: ${issue.message}`
            : "error" in body && body.error
              ? body.error
              : "The team packet could not be previewed.",
        );
      }
      setPreview(body);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The team packet could not be previewed.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function reconcileReports() {
    if (!preview) return;
    setWorking("apply");
    setError(null);
    try {
      const response = await fetch(`${endpoint}/reconcile/apply`, {
        body: JSON.stringify({ previewId: preview.previewId }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as SyncResult | { error?: string };
      if (!response.ok || !("document" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The reports could not be reconciled.",
        );
      }
      if (reconciledUrl) URL.revokeObjectURL(reconciledUrl);
      const url = URL.createObjectURL(
        new Blob([serializePortableDocument(body.document)], {
          type: "application/vnd.gameology.rec-league+json",
        }),
      );
      setReconciledUrl(url);
      setResult(body);
      setPreview(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The reports could not be reconciled.",
      );
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="rounded-2xl border border-[#cad7cf] bg-white p-5">
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
        Portable team desk
      </p>
      <h2 className="mt-1 text-xl font-bold">Work without a connection</h2>
      <p className="mt-2 text-sm leading-6 text-[#627068]">
        Download a private packet for {teamName}. It contains this team’s games and
        reports, but no other manager identities or organizer-only history.
      </p>
      <a
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#0f5138] px-4 py-2 text-sm font-bold text-[#0f5138] hover:bg-[#e9f0eb] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
        href={endpoint}
      >
        Download team packet
      </a>
      <a
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 py-2 text-sm font-bold text-[#0f5138] underline decoration-[#9eafa3] underline-offset-4"
        download="rec-league.html"
        href="/downloads/rec-league.html"
      >
        Download offline webpage
      </a>

      {!canSync ? (
        <p className="mt-3 text-xs leading-5 text-[#627068]">
          Organizer view: reconcile offline organizer files from the league’s
          Portable data page.
        </p>
      ) : archived ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
          This archived season is read-only. You can still download its packet.
        </p>
      ) : (
        <details className="mt-4 border-t border-[#e1e8e3] pt-4">
          <summary className="min-h-11 cursor-pointer list-none rounded-lg bg-[#f3f6f2] px-3 py-3 text-sm font-bold text-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]">
            Upload offline reports
          </summary>
          <div className="pt-4">
            <p className="text-xs leading-5 text-[#627068]">
              Only report submissions in the packet’s outbox can sync. Official
              scores and schedules still require organizer approval.
            </p>
            <label className="sr-only" htmlFor={`team-packet-${teamId}`}>
              Connected team packet
            </label>
            <input
              accept=".json,.rec-league.json,application/json,application/vnd.gameology.rec-league+json"
              className="mt-3 block w-full rounded-lg border border-[#bdcbc2] bg-white px-2 py-2 text-xs file:mr-2 file:rounded-md file:border-0 file:bg-[#e9f0eb] file:px-2 file:py-2 file:font-bold file:text-[#0f5138]"
              disabled={working !== null}
              id={`team-packet-${teamId}`}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setResult(null);
                setError(null);
              }}
              type="file"
            />
            <button
              className="mt-3 min-h-11 w-full rounded-lg bg-[#10231c] px-3 py-2 text-sm font-bold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!file || working !== null}
              onClick={previewReports}
              type="button"
            >
              {working === "preview" ? "Checking reports…" : "Preview reports"}
            </button>

            {error ? (
              <p
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-900"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            {preview ? (
              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Count label="Ready" value={preview.plan.readyCount} />
                  <Count
                    label="Need attention"
                    value={
                      preview.plan.conflictCount +
                      preview.plan.rejectedCount +
                      preview.plan.blockedCount
                    }
                  />
                </div>
                <ol className="mt-3 max-h-56 divide-y divide-blue-100 overflow-y-auto rounded-lg border border-blue-200 bg-white">
                  {preview.plan.items.map((item) => (
                    <li className="px-3 py-2 text-xs" key={item.operationId}>
                      <strong>{statusLabel(item.status)}</strong>
                      <span className="mt-0.5 block leading-5 text-[#526159]">
                        {item.message}
                      </span>
                    </li>
                  ))}
                </ol>
                <button
                  className="mt-3 min-h-11 w-full rounded-lg bg-blue-950 px-3 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
                  disabled={working !== null}
                  onClick={reconcileReports}
                  type="button"
                >
                  {working === "apply" ? "Reconciling…" : "Reconcile packet"}
                </button>
              </div>
            ) : null}

            {result ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
                <p className="text-sm font-black">
                  {result.summary.applied} {result.summary.applied === 1 ? "report" : "reports"} sent
                </p>
                <p className="mt-1 text-xs leading-5">
                  {result.summary.conflicts +
                    result.summary.rejected +
                    result.summary.blocked}{" "}
                  still need attention and remain in the reconciled packet.
                </p>
                <ol className="mt-3 max-h-52 divide-y divide-emerald-100 overflow-y-auto rounded-lg border border-emerald-200 bg-white">
                  {result.results.map((item) => (
                    <li className="px-3 py-2 text-xs" key={item.operationId}>
                      <strong>{item.status === "applied" ? "Sent" : statusLabel(item.status)}</strong>
                      <span className="mt-0.5 block leading-5 text-[#526159]">
                        {item.message}
                      </span>
                    </li>
                  ))}
                </ol>
                {reconciledUrl ? (
                  <a
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-950 px-3 py-2 text-center text-sm font-bold text-white"
                    download={`${fileName(teamName)}.reconciled.team.rec-league.json`}
                    href={reconciledUrl}
                  >
                    Download reconciled packet
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      )}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/80 px-3 py-2">
      <span className="block text-blue-900/70">{label}</span>
      <strong className="mt-0.5 block text-lg">{value}</strong>
    </div>
  );
}

function statusLabel(status: SyncStatus): string {
  return {
    "blocked-by-dependency": "Blocked",
    conflict: "Conflict",
    ready: "Ready",
    rejected: "Rejected",
  }[status];
}

function fileName(name: string): string {
  return (
    name
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "team"
  );
}
