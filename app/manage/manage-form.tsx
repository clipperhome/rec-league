"use client";

import { useActionState } from "react";

import {
  sendMagicLinkAction,
  type SendMagicLinkState,
} from "@/app/actions/auth";
import { SubmitButton } from "@/app/components/submit-button";

const initialState: SendMagicLinkState = {
  email: "",
  error: null,
  magicLinkUrl: null,
  success: false,
};

export function ManageForm({ slug, teamId }: { slug?: string; teamId?: string }) {
  const [state, formAction] = useActionState(sendMagicLinkAction, initialState);

  if (state.success) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950" role="status">
          <p className="font-bold">Check your inbox</p>
          <p className="mt-1 text-sm leading-6 text-emerald-800">
            If that address is on a league staff list, its secure sign-in link is on the way. The link lasts 15 minutes.
          </p>
        </div>
        {state.magicLinkUrl ? (
          <a
            className="flex min-h-12 items-center justify-center rounded-xl bg-[#0f5138] px-5 py-3 text-center font-bold text-white hover:bg-[#0a3828]"
            href={state.magicLinkUrl}
          >
            Open development sign-in link →
          </a>
        ) : null}
        <a className="block text-center text-sm font-semibold text-[#526159] hover:text-[#0f5138]" href={teamId ? `/manage?team=${encodeURIComponent(teamId)}` : slug ? `/manage?slug=${encodeURIComponent(slug)}` : "/manage"}>
          Send another link or use a different email
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {state.error}
        </div>
      ) : null}
      {slug ? <input name="slug" type="hidden" value={slug} /> : null}
      {teamId ? <input name="teamId" type="hidden" value={teamId} /> : null}
      <label className="block space-y-2">
        <span className="text-sm font-semibold text-[#10231c]">Email address</span>
        <input
          autoComplete="email"
          autoFocus
          className="w-full rounded-xl border border-[#bdcbc2] px-4 py-3 text-base outline-none transition focus:border-[#0f5138] focus:ring-2 focus:ring-[#0f5138]/15"
          defaultValue={state.email}
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>
      <SubmitButton
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#0f5138] px-5 py-3 font-bold text-white transition hover:bg-[#0a3828] disabled:cursor-not-allowed disabled:bg-[#82968a]"
        idleLabel="Email my sign-in link →"
        pendingLabel="Sending sign-in link…"
      />
    </form>
  );
}
