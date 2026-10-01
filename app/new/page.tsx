"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";

import {
  createLeagueAction,
  type CreateLeagueActionState,
} from "@/app/actions/league";

const initialState: CreateLeagueActionState = {
  fieldErrors: {},
  fields: {
    commissionerEmail: "",
    leagueName: "",
    seasonLabel: "",
    sport: "",
    teamNames: "",
    fieldNames: "Field 1\nField 2",
    gameDurationMinutes: "60",
    gameDays: ["6"],
    gameTimes: "9:00 AM\n10:30 AM",
    startDate: "",
    timezone: "America/Los_Angeles",
    venueAddress: "",
    venueName: "",
  },
  formError: null,
};

export default function NewLeaguePage() {
  const [state, formAction, isPending] = useActionState(
    createLeagueAction,
    initialState,
  );
  const timezoneInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const input = timezoneInputRef.current;
    if (
      detectedTimeZone &&
      input &&
      input.value === initialState.fields.timezone
    ) {
      input.value = detectedTimeZone;
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#f3f6f2] text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link className="flex min-h-11 items-center gap-3 font-semibold tracking-tight" href="/">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#0f5138] text-sm font-black text-white">
              RL
            </span>
            Rec League
          </Link>
          <Link className="inline-flex min-h-11 items-center text-sm font-medium text-[#526159] hover:text-[#0f5138]" href="/dashboard">
            Manage a league
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:py-14">
        <div>
          <div className="mb-8 max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">
              New league
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] text-[#10231c] sm:text-5xl">
              Turn a team list into opening day.
            </h1>
            <p className="mt-4 text-base leading-7 text-[#526159] sm:text-lg">
              Tell us who plays, when you have the fields, and when the season starts. We’ll build the matchups and put every game on the calendar.
            </p>
          </div>

          <form action={formAction} className="overflow-hidden rounded-2xl border border-[#cad7cf] bg-white shadow-[0_18px_50px_rgba(15,81,56,0.08)]">
          {state.formError ? (
            <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {state.formError}
            </div>
          ) : null}

          <section className="grid gap-6 border-b border-[#e1e8e3] p-5 sm:p-7 md:grid-cols-[8rem_1fr]">
            <div>
              <p className="text-sm font-bold text-[#0f6a48]">01</p>
              <h2 className="mt-1 text-lg font-semibold">League</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-semibold">League name</span>
              <input
                aria-invalid={Boolean(state.fieldErrors.leagueName)}
                className="w-full rounded-xl border border-[#bdcbc2] bg-white px-4 py-3 text-base outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                defaultValue={state.fields.leagueName}
                maxLength={80}
                name="leagueName"
                placeholder="Sunday Night Soccer"
                required
                type="text"
              />
              {state.fieldErrors.leagueName ? (
                <p className="text-sm text-red-700">
                  {state.fieldErrors.leagueName}
                </p>
              ) : null}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold">Sport</span>
              <input
                aria-invalid={Boolean(state.fieldErrors.sport)}
                className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                defaultValue={state.fields.sport}
                maxLength={60}
                name="sport"
                placeholder="Soccer"
                type="text"
              />
              {state.fieldErrors.sport ? <p className="text-sm text-red-700">{state.fieldErrors.sport}</p> : null}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold">Season</span>
              <input
                aria-invalid={Boolean(state.fieldErrors.seasonLabel)}
                className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                defaultValue={state.fields.seasonLabel}
                maxLength={60}
                name="seasonLabel"
                placeholder={`Fall ${new Date().getFullYear()}`}
                type="text"
              />
              {state.fieldErrors.seasonLabel ? <p className="text-sm text-red-700">{state.fieldErrors.seasonLabel}</p> : null}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold">Primary venue (public)</span>
              <input
                aria-invalid={Boolean(state.fieldErrors.venueName)}
                className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                defaultValue={state.fields.venueName}
                maxLength={80}
                name="venueName"
                placeholder="Riverside Sports Complex"
                type="text"
              />
              {state.fieldErrors.venueName ? <p className="text-sm text-red-700">{state.fieldErrors.venueName}</p> : null}
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold">Venue address (public)</span>
              <input
                aria-invalid={Boolean(state.fieldErrors.venueAddress)}
                className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                defaultValue={state.fields.venueAddress}
                maxLength={180}
                name="venueAddress"
                placeholder="123 Park Road, Springfield"
                type="text"
              />
              {state.fieldErrors.venueAddress ? <p className="text-sm text-red-700">{state.fieldErrors.venueAddress}</p> : null}
            </label>
            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-semibold">Organizer email</span>
              <input
                aria-invalid={Boolean(state.fieldErrors.commissionerEmail)}
                className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                defaultValue={state.fields.commissionerEmail}
                maxLength={254}
                name="commissionerEmail"
                placeholder="you@example.com"
                required
                type="email"
              />
              <p className="text-sm text-[#6b776f]">Used only for secure organizer access. Venue details above appear on the shared page.</p>
              {state.fieldErrors.commissionerEmail ? <p className="text-sm text-red-700">{state.fieldErrors.commissionerEmail}</p> : null}
            </label>
            </div>
          </section>

          <section className="grid gap-6 border-b border-[#e1e8e3] p-5 sm:p-7 md:grid-cols-[8rem_1fr]">
            <div>
              <p className="text-sm font-bold text-[#0f6a48]">02</p>
              <h2 className="mt-1 text-lg font-semibold">Teams</h2>
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-semibold">One team per line</span>
              <textarea
                aria-invalid={Boolean(state.fieldErrors.teamNames)}
                className="min-h-48 w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base leading-7 outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                defaultValue={state.fields.teamNames}
                name="teamNames"
                placeholder={"Red Hawks\nBlue Bears\nGreen Giants\nGolden Foxes"}
                required
              />
              <p className="text-sm text-[#6b776f]">At least two teams. We’ll make sure everyone plays everyone once.</p>
              {state.fieldErrors.teamNames ? <p className="text-sm text-red-700">{state.fieldErrors.teamNames}</p> : null}
            </label>
          </section>

          <section className="grid gap-6 p-5 sm:p-7 md:grid-cols-[8rem_1fr]">
            <div>
              <p className="text-sm font-bold text-[#0f6a48]">03</p>
              <h2 className="mt-1 text-lg font-semibold">Game rhythm</h2>
            </div>
            <div className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-3">
                <label className="space-y-2">
                  <span className="text-sm font-semibold">Season starts</span>
                  <input
                    aria-invalid={Boolean(state.fieldErrors.startDate)}
                    className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base outline-none focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                    defaultValue={state.fields.startDate}
                    name="startDate"
                    required
                    type="date"
                  />
                  {state.fieldErrors.startDate ? <p className="text-sm text-red-700">{state.fieldErrors.startDate}</p> : null}
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold">Game length</span>
                  <div className="relative">
                    <input
                      aria-invalid={Boolean(state.fieldErrors.gameDurationMinutes)}
                      className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 pr-20 text-base outline-none focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                      defaultValue={state.fields.gameDurationMinutes}
                      max={480}
                      min={15}
                      name="gameDurationMinutes"
                      required
                      step={5}
                      type="number"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-sm text-[#526159]">minutes</span>
                  </div>
                  {state.fieldErrors.gameDurationMinutes ? <p className="text-sm text-red-700">{state.fieldErrors.gameDurationMinutes}</p> : null}
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold">Time zone</span>
                  <input
                    aria-invalid={Boolean(state.fieldErrors.timezone)}
                    className="w-full rounded-xl border border-[#bdcbc2] bg-white px-4 py-3 text-base outline-none focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                    defaultValue={state.fields.timezone}
                    list="new-league-timezones"
                    name="timezone"
                    placeholder="America/Los_Angeles"
                    ref={timezoneInputRef}
                    required
                    type="text"
                  />
                  <TimeZoneOptions id="new-league-timezones" />
                  <p className="text-sm text-[#6b776f]">Detected from this device. Choose a common zone or enter any IANA time zone.</p>
                  {state.fieldErrors.timezone ? <p className="text-sm text-red-700">{state.fieldErrors.timezone}</p> : null}
                </label>
              </div>

              <fieldset>
                <legend className="text-sm font-semibold">Game days</legend>
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {[
                    [0, "Sun"], [1, "Mon"], [2, "Tue"], [3, "Wed"],
                    [4, "Thu"], [5, "Fri"], [6, "Sat"],
                  ].map(([value, label]) => (
                    <label className="cursor-pointer" key={value}>
                      <input className="peer sr-only" defaultChecked={state.fields.gameDays.includes(String(value))} name="gameDays" type="checkbox" value={value} />
                      <span className="grid min-h-11 place-items-center rounded-lg border border-[#bdcbc2] text-sm font-semibold text-[#526159] transition peer-checked:border-[#0f5138] peer-checked:bg-[#0f5138] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-[#0f5138]/30">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
                {state.fieldErrors.gameDays ? <p className="mt-2 text-sm text-red-700">{state.fieldErrors.gameDays}</p> : null}
              </fieldset>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold">Start times</span>
                  <textarea
                    aria-invalid={Boolean(state.fieldErrors.gameTimes)}
                    className="min-h-28 w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base leading-7 outline-none focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                    defaultValue={state.fields.gameTimes}
                    name="gameTimes"
                    required
                  />
                  <p className="text-sm text-[#6b776f]">One time per line.</p>
                  {state.fieldErrors.gameTimes ? <p className="text-sm text-red-700">{state.fieldErrors.gameTimes}</p> : null}
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold">Fields or courts</span>
                  <textarea
                    aria-invalid={Boolean(state.fieldErrors.fieldNames)}
                    className="min-h-28 w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base leading-7 outline-none focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
                    defaultValue={state.fields.fieldNames}
                    name="fieldNames"
                    required
                  />
                  <p className="text-sm text-[#6b776f]">One playing area per line.</p>
                  {state.fieldErrors.fieldNames ? <p className="text-sm text-red-700">{state.fieldErrors.fieldNames}</p> : null}
                </label>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-4 border-t border-[#d9e2dc] bg-[#f8faf8] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <p className="max-w-sm text-sm leading-6 text-[#627068]">
              You can review every date before sharing the public page.
            </p>
            <button
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#0f5138] px-6 py-3 text-base font-bold text-white shadow-sm transition hover:bg-[#0a3828] disabled:cursor-not-allowed disabled:bg-[#82968a]"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Building your schedule…" : "Build my schedule →"}
            </button>
          </div>
        </form>

        </div>

        <aside className="lg:pt-32">
          <div className="overflow-hidden rounded-2xl bg-[#10231c] text-white shadow-[0_18px_45px_rgba(16,35,28,0.2)] lg:sticky lg:top-6">
            <div className="border-b border-white/10 p-6">
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#8fd1ad]">Ready to share</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Your first season, organized.</h2>
            </div>
            <div className="space-y-3 p-5">
              {["Balanced round-robin matchups", "Dates, times, and fields assigned", "Standings update with each score", "One public link—no player accounts"].map((item, index) => (
                <div className="flex gap-3 rounded-xl bg-white/[0.06] p-3" key={item}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#f4b942] text-xs font-black text-[#10231c]">{index + 1}</span>
                  <p className="text-sm leading-6 text-white/85">{item}</p>
                </div>
              ))}
            </div>
            <div className="bg-[#0f5138] px-6 py-5">
              <p className="text-sm leading-6 text-white/80">Most leagues are ready in under five minutes.</p>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function TimeZoneOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {[
        "America/Los_Angeles",
        "America/Denver",
        "America/Phoenix",
        "America/Chicago",
        "America/New_York",
        "America/Anchorage",
        "Pacific/Honolulu",
        "Europe/London",
        "Europe/Paris",
        "Asia/Tokyo",
        "Australia/Sydney",
        "UTC",
      ].map((timeZone) => <option key={timeZone} value={timeZone} />)}
    </datalist>
  );
}
