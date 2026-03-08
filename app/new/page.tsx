"use client";

import { useActionState } from "react";

import {
  createLeagueAction,
  type CreateLeagueActionState,
} from "@/app/actions/league";

const initialState: CreateLeagueActionState = {
  fieldErrors: {},
  fields: {
    leagueName: "",
    seasonLabel: "",
    sport: "",
    teamNames: "",
  },
  formError: null,
};

export default function NewLeaguePage() {
  const [state, formAction, isPending] = useActionState(
    createLeagueAction,
    initialState,
  );

  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <main className="mx-auto max-w-3xl px-4">
        <div className="mb-8 space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
            New League
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Start a league and generate the first schedule
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600">
            Enter the league basics and at least two teams. The first round-robin
            schedule is created on submit and the public page is ready to share.
          </p>
        </div>

        <form
          action={formAction}
          className="space-y-6 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8"
        >
          {state.formError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {state.formError}
            </div>
          ) : null}

          <div className="grid gap-6 sm:grid-cols-2">
            <label className="space-y-2 sm:col-span-2">
              <span className="text-sm font-medium text-zinc-900">
                League name
              </span>
              <input
                aria-invalid={Boolean(state.fieldErrors.leagueName)}
                className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-900"
                defaultValue={state.fields.leagueName}
                name="leagueName"
                placeholder="Sunday Soccer"
                required
                type="text"
              />
              {state.fieldErrors.leagueName ? (
                <p className="text-sm text-red-600">
                  {state.fieldErrors.leagueName}
                </p>
              ) : null}
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-900">Sport</span>
              <input
                className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-900"
                defaultValue={state.fields.sport}
                name="sport"
                placeholder="Soccer"
                type="text"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-900">
                Season label
              </span>
              <input
                className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-900"
                defaultValue={state.fields.seasonLabel}
                name="seasonLabel"
                placeholder="Spring 2026"
                type="text"
              />
            </label>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-900">
              Team names
            </span>
            <textarea
              aria-invalid={Boolean(state.fieldErrors.teamNames)}
              className="min-h-56 w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-900"
              defaultValue={state.fields.teamNames}
              name="teamNames"
              placeholder={"Red Hawks\nBlue Bears\nGreen Giants"}
              required
            />
            <p className="text-sm text-zinc-500">
              Separate teams with commas or new lines.
            </p>
            {state.fieldErrors.teamNames ? (
              <p className="text-sm text-red-600">
                {state.fieldErrors.teamNames}
              </p>
            ) : null}
          </label>

          <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              Initial schedule: one full round robin.
            </p>
            <button
              className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Creating league..." : "Create league"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
