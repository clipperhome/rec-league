import { useState, type FormEvent } from "react";

import type { CreateLocalLeagueInput } from "@/lib/portable";

import type { RecoveryCopy } from "../recovery";

export function StartScreen({
  busy,
  error,
  onCreate,
  onDiscardRecovery,
  onOpen,
  onRecover,
  recovery,
}: {
  busy: boolean;
  error: string | null;
  onCreate(input: CreateLocalLeagueInput): void;
  onDiscardRecovery(): void;
  onOpen(): void;
  onRecover(): void;
  recovery: RecoveryCopy | null;
}) {
  const [creating, setCreating] = useState(false);
  const defaultTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onCreate({
      name: String(form.get("name") ?? ""),
      seasonLabel: String(form.get("seasonLabel") ?? ""),
      sport: String(form.get("sport") ?? ""),
      teamNames: String(form.get("teams") ?? "").split(/\r?\n/u),
      timeZone: String(form.get("timeZone") ?? defaultTimeZone),
    });
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-[#0f5138] text-lg font-black text-white shadow-sm">
              RL
            </span>
            <div>
              <p className="font-black tracking-tight">Rec League</p>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#627068]">
                Portable desk
              </p>
            </div>
          </div>
          <span className="rounded-full border border-[#cad7cf] bg-white px-3 py-1.5 text-xs font-bold text-[#526159]">
            Offline-ready
          </span>
        </header>

        <section className="mt-12 grid gap-10 lg:grid-cols-[1.15fr_.85fr] lg:items-start">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-[#0f6a48]">
              Your league. Your file.
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-[-0.05em] text-[#10231c] sm:text-6xl">
              Run the season without giving up your data.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[#526159]">
              Open a human-readable league file, work without a connection, and
              save it wherever you choose. Replacing this webpage upgrades the
              tool—your JSON stays separate.
            </p>

            {error ? (
              <p
                className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                className="min-h-12 rounded-xl bg-[#0f5138] px-5 py-3 font-black text-white shadow-sm hover:bg-[#0a3828] disabled:opacity-50"
                disabled={busy}
                onClick={onOpen}
                type="button"
              >
                {busy ? "Opening…" : "Open league file"}
              </button>
              <button
                className="min-h-12 rounded-xl border border-[#0f5138] bg-white px-5 py-3 font-black text-[#0f5138] hover:bg-[#e9f0eb]"
                onClick={() => setCreating((value) => !value)}
                type="button"
              >
                {creating ? "Cancel new league" : "Create local league"}
              </button>
            </div>

            {recovery ? (
              <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                <p className="font-black">Recovery copy on this browser/device</p>
                <p className="mt-1 text-sm leading-6">
                  {recovery.document.league.name} · saved {formatSavedAt(recovery.savedAt)}.
                  This is not a replacement for your downloaded league file.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="min-h-11 rounded-lg bg-amber-950 px-4 py-2 text-sm font-bold text-white"
                    onClick={onRecover}
                    type="button"
                  >
                    Recover working copy
                  </button>
                  <button
                    className="min-h-11 rounded-lg px-3 py-2 text-sm font-bold text-amber-950 underline underline-offset-4"
                    onClick={onDiscardRecovery}
                    type="button"
                  >
                    Clear recovery copy
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="rounded-3xl border border-[#cad7cf] bg-white p-6 shadow-[0_24px_70px_rgba(16,35,28,.12)] sm:p-7">
            {creating ? (
              <form className="space-y-4" onSubmit={submit}>
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.14em] text-[#0f6a48]">
                    New local-only league
                  </p>
                  <h2 className="mt-1 text-2xl font-black">Start with the basics</h2>
                  <p className="mt-2 text-sm leading-6 text-[#627068]">
                    This JSON file becomes the official copy. One trusted organizer
                    should edit it at a time.
                  </p>
                </div>
                <Field label="League name" name="name" required />
                <div className="grid gap-3 min-[360px]:grid-cols-2">
                  <Field label="Sport" name="sport" placeholder="Soccer" />
                  <Field label="Season" name="seasonLabel" placeholder="Fall 2026" />
                </div>
                <Field
                  defaultValue={defaultTimeZone}
                  label="Time zone"
                  name="timeZone"
                  required
                />
                <label className="block text-sm font-bold">
                  <span>Teams, one per line</span>
                  <textarea
                    className="mt-1.5 min-h-32 w-full rounded-xl border border-[#bdcbc2] px-3 py-2.5 text-base font-normal"
                    defaultValue={"Red Rockets\nBlue Birds\nGreen Giants\nGold Stars"}
                    name="teams"
                    required
                  />
                </label>
                <button
                  className="min-h-12 w-full rounded-xl bg-[#10231c] px-4 py-3 font-black text-white hover:bg-black"
                  type="submit"
                >
                  Create working file
                </button>
              </form>
            ) : (
              <div>
                <p className="text-sm font-black uppercase tracking-[0.14em] text-[#0f6a48]">
                  How saving works
                </p>
                <ol className="mt-5 space-y-5">
                  <Step number="1" title="Open or create">
                    The webpage reads your separate .rec-league.json file.
                  </Step>
                  <Step number="2" title="Make changes">
                    Local-only files update directly. Connected files build a safe
                    operation outbox for the official online league.
                  </Step>
                  <Step number="3" title="Save the JSON">
                    Supported browsers save in place; every browser can download an
                    updated copy.
                  </Step>
                </ol>
                <p className="mt-6 rounded-xl bg-[#f3f6f2] px-4 py-3 text-sm leading-6 text-[#526159]">
                  Spreadsheet files are for import/export later. They are never the
                  app’s source of truth.
                </p>
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}

function Field({
  defaultValue,
  label,
  name,
  placeholder,
  required,
}: {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-bold">
      <span>{label}</span>
      <input
        className="mt-1.5 min-h-11 w-full rounded-xl border border-[#bdcbc2] px-3 text-base font-normal"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function Step({
  children,
  number,
  title,
}: {
  children: React.ReactNode;
  number: string;
  title: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e9f0eb] text-sm font-black text-[#0f5138]">
        {number}
      </span>
      <div>
        <p className="font-black">{title}</p>
        <p className="mt-0.5 text-sm leading-6 text-[#627068]">{children}</p>
      </div>
    </li>
  );
}

function formatSavedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
