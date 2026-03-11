"use client";

import { useActionState } from "react";
import { useParams } from "next/navigation";

import {
  sendMagicLinkAction,
  type SendMagicLinkState,
} from "@/app/actions/auth";

const initialState: SendMagicLinkState = {
  email: "",
  error: null,
  magicLinkUrl: null,
  success: false,
};

export default function DashboardLoginPage() {
  const params = useParams<{ slug: string }>();
  const [state, formAction, isPending] = useActionState(
    sendMagicLinkAction,
    initialState,
  );

  return (
    <div className="min-h-screen bg-zinc-50 py-10">
      <main className="mx-auto max-w-md px-4">
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Commissioner Login
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
            Sign in to manage your league
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Enter the commissioner email used when the league was created. We'll
            send you a login link — no password needed.
          </p>

          {state.success ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                If that email matches this league, a login link has been sent.
                Check your inbox.
              </div>
              {state.magicLinkUrl ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                  <p className="font-semibold text-blue-800">
                    Dev mode — click to log in:
                  </p>
                  <a
                    className="mt-1 inline-block break-all text-blue-700 underline"
                    href={state.magicLinkUrl}
                  >
                    {state.magicLinkUrl}
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <form action={formAction} className="mt-6 space-y-4">
              {state.error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}

              <input name="slug" type="hidden" value={params.slug} />

              <label className="block space-y-2">
                <span className="text-sm font-medium text-zinc-900">
                  Commissioner email
                </span>
                <input
                  autoFocus
                  className="w-full rounded-2xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-900"
                  defaultValue={state.email}
                  name="email"
                  placeholder="you@example.com"
                  required
                  type="email"
                />
              </label>

              <button
                className="w-full rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
                disabled={isPending}
                type="submit"
              >
                {isPending ? "Sending link..." : "Send login link"}
              </button>
            </form>
          )}

          <div className="mt-6 border-t border-zinc-200 pt-4">
            <a
              className="text-sm text-zinc-500 transition hover:text-zinc-900"
              href={`/l/${params.slug}`}
            >
              ← View public league page
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
