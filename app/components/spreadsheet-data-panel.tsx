"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PlanItem = {
  kind: string;
  message: string;
  operationId: string;
  status: "blocked-by-dependency" | "conflict" | "ready" | "rejected";
};

type SpreadsheetPreview = {
  changes: Array<{
    after: string;
    before: string;
    kind: string;
    operationId: string;
    target: string;
  }>;
  plan: {
    blockedCount: number;
    conflictCount: number;
    items: PlanItem[];
    readyCount: number;
    rejectedCount: number;
  };
  previewId: string;
  sourceHash: string;
  warnings: string[];
};

type SpreadsheetApplyResult = {
  appliedCount: number;
  backupUrl: string;
  dataRevision: number;
  workbookUrl: string;
};

export function SpreadsheetDataPanel({
  slug,
  verified,
}: {
  slug: string;
  verified: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SpreadsheetPreview | null>(null);
  const [result, setResult] = useState<SpreadsheetApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"apply" | "preview" | null>(null);
  const base = `/api/leagues/${encodeURIComponent(slug)}/portable/spreadsheet`;
  const allReady =
    preview !== null &&
    preview.changes.length > 0 &&
    preview.plan.readyCount === preview.changes.length &&
    preview.plan.blockedCount === 0 &&
    preview.plan.conflictCount === 0 &&
    preview.plan.rejectedCount === 0;

  async function previewWorkbook() {
    if (!file) {
      setError("Choose the edited .xlsx workbook first.");
      return;
    }
    setWorking("preview");
    setError(null);
    setPreview(null);
    setResult(null);
    try {
      const response = await fetch(`${base}/import/preview`, {
        body: file,
        credentials: "same-origin",
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        method: "POST",
      });
      const body = (await response.json()) as
        | SpreadsheetPreview
        | { error?: string; issues?: Array<{ message: string; path: string }> };
      if (!response.ok || !("previewId" in body)) {
        const firstIssue = "issues" in body ? body.issues?.[0] : undefined;
        throw new Error(
          firstIssue
            ? `${firstIssue.path}: ${firstIssue.message}`
            : "error" in body && body.error
              ? body.error
              : "The workbook could not be previewed.",
        );
      }
      setPreview(body);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The workbook could not be previewed.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function applyWorkbook() {
    if (!preview || !allReady) return;
    setWorking("apply");
    setError(null);
    try {
      const response = await fetch(`${base}/import/apply`, {
        body: JSON.stringify({ previewId: preview.previewId }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as
        | SpreadsheetApplyResult
        | { error?: string };
      if (!response.ok || !("appliedCount" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "No spreadsheet changes were applied.",
        );
      }
      setResult(body);
      setPreview(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No spreadsheet changes were applied.",
      );
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white">
      <div className="border-b border-[#e1e8e3] p-5 sm:p-6">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#0f6a48]">
          Excel and Google Sheets
        </p>
        <h3 className="mt-1 text-2xl font-bold">Analyze or prepare checked bulk edits</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#627068]">
          JSON remains the complete backup. The workbook is a private interchange
          copy with stable IDs, manager emails, report notes, activity, and derived
          standings. Google Sheets can open the .xlsx file. CSV downloads are
          analysis-only and cannot be imported.
        </p>
      </div>

      <div className="grid gap-4 border-b border-[#e1e8e3] p-5 sm:grid-cols-2 sm:p-6">
        <article className="rounded-xl border border-[#d9e2dc] p-4">
          <p className="font-bold">Private operations workbook</p>
          <p className="mt-1 text-sm leading-6 text-[#627068]">
            Edit literal values only. Keep record_id and record_version unchanged;
            missing rows never delete data.
          </p>
          <a
            aria-disabled={!verified}
            className={`mt-4 inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-bold ${verified ? "bg-[#0f5138] text-white hover:bg-[#0a3828]" : "pointer-events-none bg-[#d9e2dc] text-[#627068]"}`}
            href={base}
          >
            Download .xlsx workbook
          </a>
        </article>

        <article className="rounded-xl border border-[#d9e2dc] p-4">
          <p className="font-bold">Safe CSV tables</p>
          <p className="mt-1 text-sm leading-6 text-[#627068]">
            UTF-8 tables for pivots, charts, and sharing into another spreadsheet.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["teams", "games", "results", "standings"] as const).map((table) => (
              <a
                aria-disabled={!verified}
                className={`inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-bold capitalize ${verified ? "border-[#0f5138] text-[#0f5138] hover:bg-[#e9f0eb]" : "pointer-events-none border-[#d9e2dc] text-[#829087]"}`}
                href={`${base}?format=csv&table=${table}`}
                key={table}
              >
                {table} CSV
              </a>
            ))}
          </div>
        </article>
      </div>

      <div className="p-5 sm:p-6">
        <h4 className="text-lg font-black">Preview an edited workbook</h4>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#627068]">
          Formulas and coerced dates are rejected. Every proposed edit is compared
          with the current online record. Nothing is written unless every item is
          ready, and the whole set commits in one transaction.
        </p>
        <label className="mt-4 block text-sm font-bold" htmlFor="spreadsheet-file">
          Edited .xlsx workbook
        </label>
        <input
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="mt-2 block w-full rounded-lg border border-[#bdcbc2] bg-white px-3 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#e9f0eb] file:px-3 file:py-2 file:font-bold file:text-[#0f5138]"
          disabled={!verified || working !== null}
          id="spreadsheet-file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setResult(null);
            setError(null);
          }}
          ref={inputRef}
          type="file"
        />
        <button
          className="mt-4 min-h-11 rounded-lg bg-[#10231c] px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!verified || !file || working !== null}
          onClick={previewWorkbook}
          type="button"
        >
          {working === "preview" ? "Checking workbook…" : "Preview workbook changes"}
        </button>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">
            {error}
          </p>
        ) : null}

        {preview ? (
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950 sm:p-5">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <PlanStat label="Ready" value={preview.plan.readyCount} />
              <PlanStat label="Conflicts" value={preview.plan.conflictCount} />
              <PlanStat label="Rejected" value={preview.plan.rejectedCount} />
              <PlanStat label="Blocked" value={preview.plan.blockedCount} />
            </dl>
            <ol className="mt-4 max-h-96 divide-y divide-blue-100 overflow-y-auto rounded-lg border border-blue-200 bg-white">
              {preview.changes.map((change) => {
                const planned = preview.plan.items.find(
                  (item) => item.operationId === change.operationId,
                );
                return (
                  <li className="px-3 py-3 text-sm" key={change.operationId}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{change.target}</strong>
                      <Status status={planned?.status ?? "rejected"} />
                    </div>
                    <p className="mt-2 text-[#526159]">
                      <span className="line-through">{change.before}</span>
                      <span aria-hidden="true"> → </span>
                      <strong className="text-[#10231c]">{change.after}</strong>
                    </p>
                    <p className="mt-1 text-[#627068]">
                      {planned?.message ?? "This change could not be planned."}
                    </p>
                  </li>
                );
              })}
            </ol>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-6">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            {allReady ? (
              <button
                className="mt-5 min-h-11 rounded-lg bg-blue-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
                disabled={working !== null}
                onClick={applyWorkbook}
                type="button"
              >
                {working === "apply"
                  ? "Applying all changes…"
                  : `Apply all ${preview.plan.readyCount} ${preview.plan.readyCount === 1 ? "change" : "changes"}`}
              </button>
            ) : (
              <p className="mt-5 rounded-lg bg-amber-100 px-4 py-3 text-sm font-bold text-amber-950">
                Nothing can be applied yet. Fix every conflict or rejected edit in
                the workbook, then preview it again.
              </p>
            )}
          </div>
        ) : null}

        {result ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 sm:p-5">
            <p className="font-black">
              {result.appliedCount} spreadsheet {result.appliedCount === 1 ? "change" : "changes"} applied together
            </p>
            <p className="mt-1 text-sm leading-6">
              The official league is now revision {result.dataRevision}. The uploaded
              workbook is not application storage; download a fresh copy before the
              next editing round.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a className="font-bold underline underline-offset-4" href={result.workbookUrl}>
                Download fresh workbook
              </a>
              <a className="font-bold underline underline-offset-4" href={result.backupUrl}>
                Download fresh JSON backup
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PlanStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/80 px-3 py-2">
      <dt className="text-blue-900/70">{label}</dt>
      <dd className="mt-0.5 text-lg font-black">{value}</dd>
    </div>
  );
}

function Status({ status }: { status: PlanItem["status"] }) {
  const styles = {
    "blocked-by-dependency": "bg-slate-100 text-slate-800",
    conflict: "bg-amber-100 text-amber-900",
    ready: "bg-emerald-100 text-emerald-900",
    rejected: "bg-red-100 text-red-900",
  };
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-bold ${styles[status]}`}>
      {status === "blocked-by-dependency"
        ? "Blocked"
        : status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
