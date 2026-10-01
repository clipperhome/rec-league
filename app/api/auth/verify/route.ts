import { NextRequest, NextResponse } from "next/server";

import {
  getMagicLinkContext,
  setSessionCookie,
  verifyMagicLinkToken,
} from "@/lib/auth";
import { getConfiguredAppUrl } from "@/lib/email";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return authRecoveryRedirect(request.nextUrl, "missing");
  }

  let redirectBase: URL;

  try {
    redirectBase =
      process.env.NODE_ENV === "production"
        ? getConfiguredAppUrl()
        : process.env.APP_URL?.trim()
          ? getConfiguredAppUrl()
          : new URL(request.url);
  } catch (error) {
    console.error("Cannot verify magic links without a valid APP_URL.", error);
    return authRecoveryRedirect(request.nextUrl, "unavailable");
  }

  if (!TOKEN_PATTERN.test(token)) {
    return authRecoveryRedirect(redirectBase, "expired");
  }

  const context = await getMagicLinkContext(token);
  if (!context) {
    return authRecoveryRedirect(redirectBase, "expired");
  }

  const response = new NextResponse(renderConfirmationPage(token, context), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
    status: 200,
  });

  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let redirectBase: URL;

  try {
    redirectBase =
      process.env.NODE_ENV === "production"
        ? getConfiguredAppUrl()
        : process.env.APP_URL?.trim()
          ? getConfiguredAppUrl()
          : new URL(request.nextUrl.origin);
  } catch (error) {
    console.error("Cannot verify magic links without a valid APP_URL.", error);
    return authRecoveryRedirect(request.nextUrl, "unavailable", 303);
  }

  if (!isSameOriginFormPost(request, redirectBase)) {
    return authRecoveryRedirect(redirectBase, "expired", 303);
  }

  let token: string | null = null;

  try {
    const formData = await request.formData();
    const value = formData.get("token");
    token = typeof value === "string" ? value : null;
  } catch {
    // Keep malformed submissions on the same generic recovery path as invalid,
    // expired, and already-used links.
  }

  if (!token || !TOKEN_PATTERN.test(token)) {
    return authRecoveryRedirect(redirectBase, "expired", 303);
  }

  const result = await verifyMagicLinkToken(token);

  if (!result) {
    return authRecoveryRedirect(redirectBase, "expired", 303);
  }

  await setSessionCookie(result.sessionToken);

  const response = NextResponse.redirect(
    new URL(
      result.teamId
        ? `/team/${encodeURIComponent(result.teamId)}`
        : `/dashboard/${encodeURIComponent(result.slug)}`,
      redirectBase,
    ),
    303,
  );
  setPrivateResponseHeaders(response);
  return response;
}

function authRecoveryRedirect(
  requestUrl: URL,
  reason: "expired" | "missing" | "unavailable",
  status: 303 | 307 = 307,
): NextResponse {
  const recoveryUrl = new URL("/manage", requestUrl.origin);
  recoveryUrl.searchParams.set("authError", reason);
  const response = NextResponse.redirect(recoveryUrl, status);
  setPrivateResponseHeaders(response);
  return response;
}

function isSameOriginFormPost(
  request: NextRequest,
  redirectBase: URL,
): boolean {
  const source = request.headers.get("origin") ?? request.headers.get("referer");

  if (!source) return false;

  try {
    const sourceOrigin = new URL(source).origin;

    return process.env.NODE_ENV === "production"
      ? sourceOrigin === redirectBase.origin
      : sourceOrigin === redirectBase.origin || sourceOrigin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function setPrivateResponseHeaders(response: NextResponse): void {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
}

function renderConfirmationPage(
  token: string,
  context: {
    leagueName: string;
    purpose: "ORGANIZER_EMAIL_CHANGE" | "SIGN_IN" | "TEAM_MANAGER_INVITE";
    teamName: string | null;
  },
): string {
  const leagueName = escapeHtml(context.leagueName);
  const teamName = context.teamName ? escapeHtml(context.teamName) : null;
  const isTransfer = context.purpose === "ORGANIZER_EMAIL_CHANGE";
  const isInvite = context.purpose === "TEAM_MANAGER_INVITE";
  const title = isTransfer
    ? "Accept organizer ownership?"
    : isInvite
      ? "Accept your team-manager invitation."
      : "Finish signing in.";
  const eyebrow = isTransfer
    ? "League ownership transfer"
    : isInvite
      ? "Team-manager invitation"
      : "Secure league staff access";
  const copy = isTransfer
    ? `Continuing makes you the organizer of <strong>${leagueName}</strong> and replaces its current organizer. You will control the official schedule, results, access, and season lifecycle.`
    : isInvite
      ? `Continuing gives you access to report updates for <strong>${teamName ?? "your team"}</strong> in <strong>${leagueName}</strong>. The organizer must approve your reports before they become official.`
      : `Confirm that you want to open your ${teamName ? `<strong>${teamName}</strong> team-manager desk for ` : "workspace for "}<strong>${leagueName}</strong>. This keeps automatic email checks from using your one-time link.`;
  const buttonLabel = isTransfer
    ? "Accept organizer ownership →"
    : isInvite
      ? "Accept invitation →"
      : "Continue to my dashboard →";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>${isTransfer ? "Accept ownership" : isInvite ? "Accept invitation" : "Confirm sign-in"} · Rec League</title>
    <style>
      :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; background: #f3f6f2; color: #10231c; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #f3f6f2; }
      header { border-bottom: 1px solid #d9e2dc; background: #fff; }
      .header-inner { width: min(100% - 2rem, 72rem); margin: 0 auto; padding: 1rem 0; }
      .brand { display: inline-flex; align-items: center; gap: .75rem; color: #10231c; font-weight: 700; text-decoration: none; }
      .mark { display: grid; width: 2.25rem; height: 2.25rem; place-items: center; border-radius: .5rem; background: #0f5138; color: #fff; font-size: .875rem; font-weight: 900; }
      main { display: grid; min-height: calc(100vh - 69px); place-items: center; padding: 3rem 1rem; }
      .card { width: min(100%, 30rem); overflow: hidden; border: 1px solid #cad7cf; border-radius: 1rem; background: #fff; box-shadow: 0 18px 50px rgba(15, 81, 56, .08); }
      .content { padding: 2rem; }
      .eyebrow { margin: 0; color: #0f6a48; font-size: .8rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: .75rem 0 0; font-size: clamp(2rem, 8vw, 2.75rem); line-height: 1.05; letter-spacing: -.04em; }
      .copy { margin: 1rem 0 0; color: #627068; font-size: 1rem; line-height: 1.65; }
      form { margin-top: 1.5rem; }
      button { width: 100%; min-height: 3rem; border: 0; border-radius: .75rem; background: #0f5138; color: #fff; cursor: pointer; font: inherit; font-weight: 800; padding: .75rem 1.25rem; }
      button:hover { background: #0a3828; }
      button:focus-visible { outline: 3px solid rgba(15, 81, 56, .28); outline-offset: 3px; }
      .note { margin: 1rem 0 0; color: #627068; font-size: .82rem; line-height: 1.5; text-align: center; }
      .footer { border-top: 1px solid #e1e8e3; background: #f8faf8; padding: 1rem 2rem; color: #627068; font-size: .8rem; line-height: 1.5; }
    </style>
  </head>
  <body>
    <header>
      <div class="header-inner">
        <a class="brand" href="/"><span class="mark">RL</span>Rec League</a>
      </div>
    </header>
    <main>
      <section class="card" aria-labelledby="sign-in-title">
        <div class="content">
          <p class="eyebrow">${eyebrow}</p>
          <h1 id="sign-in-title">${title}</h1>
          <p class="copy">${copy}</p>
          <form action="/api/auth/verify" method="post">
            <input name="token" type="hidden" value="${escapeHtml(token)}" />
            <button type="submit">${buttonLabel}</button>
          </form>
          <p class="note">The link is used only after you press continue.</p>
        </div>
        <div class="footer">If you did not request this link, close this page. No account changes have been made.</div>
      </section>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
