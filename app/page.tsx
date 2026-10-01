import Link from "next/link";

import { BrandLink } from "@/app/components/brand-link";

const steps = [
  ["01", "Add the league", "Paste in the teams and choose your game days."],
  ["02", "Get the season", "Every matchup gets a date, time, and field."],
  ["03", "Share one link", "Scores and standings stay current for everyone."],
] as const;

const roles = [
  {
    copy: "Build the season, resolve rainouts, approve team reports, and own the official record.",
    eyebrow: "League-wide control",
    title: "Organizer",
  },
  {
    copy: "Use a team-only desk to report scores, flag rainouts, and propose a new time for organizer approval.",
    eyebrow: "One-team operations",
    title: "Team manager",
  },
  {
    copy: "Open a public team view for the next game, venue, updates, results, standings, and calendar—no account needed.",
    eyebrow: "Fast public answers",
    title: "Players and families",
  },
] as const;

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f3f6f2] text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <BrandLink />
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-[#526159] transition hover:text-[#0f5138]"
            href="/dashboard"
          >
            League staff sign-in
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#10231c] text-white">
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 opacity-25 lg:block">
            <div className="absolute inset-12 rounded-full border border-white/30" />
            <div className="absolute inset-y-0 left-1/2 border-l border-white/20" />
          </div>
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#8fd1ad]">
                Built for volunteer rec leagues
              </p>
              <h1 className="mt-4 text-5xl font-bold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
                Your league schedule, done tonight.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/75">
                Turn a team list into a complete round-robin season. Share one public page for game times, results, and standings—no app or player account required.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#f4b942] px-6 py-3 text-base font-bold text-[#10231c] transition hover:bg-[#ffd16c]"
                  href="/new"
                >
                  Build a schedule →
                </Link>
                <Link
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/25 px-6 py-3 text-base font-semibold text-white transition hover:bg-white/10"
                  href="/manage"
                >
                  Staff sign-in
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-4 shadow-2xl backdrop-blur-sm sm:p-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-sm font-bold text-[#8fd1ad]">SATURDAY • 9:00 AM</p>
                  <p className="mt-1 text-lg font-semibold">Opening day</p>
                </div>
                <span className="rounded-lg bg-[#0f6a48] px-3 py-1.5 text-sm font-bold">3 games</span>
              </div>
              <div className="divide-y divide-white/10">
                {[
                  ["Red Hawks", "Blue Bears", "North Field"],
                  ["Golden Foxes", "Green Giants", "South Field"],
                  ["City Strikers", "Rovers", "Main Court"],
                ].map(([home, away, field]) => (
                  <div className="grid grid-cols-[1fr_auto] gap-4 py-4" key={home}>
                    <p className="font-semibold">
                      {home} <span className="px-1 text-white/35">vs</span> {away}
                    </p>
                    <p className="text-sm text-white/75">{field}</p>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-2 rounded-xl bg-[#f4b942] px-4 py-3 text-sm font-bold text-[#10231c]">
                <span aria-hidden="true">✓</span>
                Ready to send to the league
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="mb-12">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">Three people, three different jobs</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Everyone gets the smallest workspace they need.</h2>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {roles.map((role) => (
                <article className="rounded-2xl border border-[#cad7cf] bg-white p-6" key={role.title}>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#0f6a48]">{role.eyebrow}</p>
                  <h3 className="mt-3 text-2xl font-bold">{role.title}</h3>
                  <p className="mt-2 leading-7 text-[#627068]">{role.copy}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-[#cad7cf] bg-[#cad7cf] md:grid-cols-3">
            {steps.map(([number, title, copy]) => (
              <article className="bg-white p-6 sm:p-8" key={number}>
                <p className="text-sm font-black text-[#0f6a48]">{number}</p>
                <h2 className="mt-6 text-xl font-bold tracking-tight">{title}</h2>
                <p className="mt-2 text-base leading-7 text-[#627068]">{copy}</p>
              </article>
            ))}
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-5 border-t border-[#cad7cf] pt-8 sm:flex-row sm:items-center">
            <div>
              <p className="text-lg font-bold">No subscriptions. No ads. No app install.</p>
              <p className="mt-1 text-sm text-[#627068]">Organizer control, team reporting, and a public game-day view.</p>
            </div>
            <Link className="font-bold text-[#0f5138] underline decoration-[#f4b942] decoration-4 underline-offset-4" href="/new">
              Start with your teams
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
