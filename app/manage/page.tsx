import { BrandLink } from "@/app/components/brand-link";
import { Notice } from "@/app/components/notice";

import { ManageForm } from "./manage-form";

type ManagePageProps = {
  searchParams: Promise<{ authError?: string; slug?: string; team?: string }>;
};

export default async function ManagePage({ searchParams }: ManagePageProps) {
  const { authError, slug, team } = await searchParams;
  const errorMessage = authErrorMessage(authError);

  return (
    <div className="min-h-screen bg-[#f3f6f2] text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <BrandLink />
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_25rem] lg:items-center lg:py-24">
        <div className="max-w-xl">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">League staff access</p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Get back to game night.</h1>
          <p className="mt-4 text-lg leading-8 text-[#627068]">
            Organizers and team managers use a secure email link—no password to remember or share.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-[#526159] sm:grid-cols-3 lg:grid-cols-1">
            <p><span className="font-bold text-[#10231c]">15 minutes</span><br />for the link to be used</p>
            <p><span className="font-bold text-[#10231c]">30 days</span><br />before sign-in is needed again</p>
            <p><span className="font-bold text-[#10231c]">Zero passwords</span><br />stored or shared</p>
          </div>
        </div>
        <section className="rounded-2xl border border-[#cad7cf] bg-white p-6 shadow-[0_18px_50px_rgba(15,81,56,0.08)] sm:p-8">
          <h2 className="text-xl font-bold">Send me a sign-in link</h2>
          <p className="mb-6 mt-2 text-sm leading-6 text-[#627068]">
            We’ll use it only to find leagues you manage.
          </p>
          {errorMessage ? (
            <div className="mb-5">
              <Notice message={errorMessage} tone="error" />
            </div>
          ) : null}
          <ManageForm slug={slug} teamId={team} />
        </section>
      </main>
    </div>
  );
}

function authErrorMessage(reason?: string): string | undefined {
  if (reason === "expired") {
    return "That sign-in link is invalid, expired, or already used. Request a fresh one below.";
  }
  if (reason === "missing") {
    return "That sign-in link is incomplete. Request a fresh one below.";
  }
  if (reason === "unavailable") {
    return "Sign-in is temporarily unavailable. Please try again in a moment.";
  }
  if (reason === "setup-session") {
    return "Your league was created, but we couldn’t open its dashboard. Request a secure sign-in link below.";
  }
  return undefined;
}
