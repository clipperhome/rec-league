import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <main className="w-full max-w-2xl px-6 py-24 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Rec League Commissioner
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
          Schedules & standings
          <br />
          without the hassle
        </h1>
        <p className="mx-auto mt-6 max-w-md text-base leading-7 text-zinc-600">
          Create a league, generate a round-robin schedule, and share a public
          page with players — no app installs, no accounts, no fees.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            className="inline-flex h-12 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white transition hover:bg-zinc-700"
            href="/new"
          >
            Create a league
          </Link>
        </div>
        <div className="mx-auto mt-16 grid max-w-lg gap-6 text-left sm:grid-cols-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900">5-minute setup</p>
            <p className="mt-1 text-sm text-zinc-500">
              Add teams, generate a schedule, and you&#39;re live.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              No app required
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Players get a link — works on any phone browser.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              100% free
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              No upsells, no ads, no premium tier.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
