import "server-only";

import { headers } from "next/headers";

const SWITCHER_FLAG = "REC_LEAGUE_DEV_PROFILE_SWITCHER";

export function developmentProfileSwitcherEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env[SWITCHER_FLAG]?.trim() !== "1") return false;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "file:./dev.db";
  return databaseUrl.startsWith("file:");
}

export async function isLocalDevelopmentRequest(): Promise<boolean> {
  if (!developmentProfileSwitcherEnabled()) return false;

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || requestHeaders.get("host")?.trim();
  if (!requestHost || !isLoopbackHost(requestHost)) return false;

  const origin = requestHeaders.get("origin");
  return !origin || isLoopbackHost(origin);
}

export function developmentManagerEmail(leagueId: string): string {
  return `dev-manager+${leagueId}@example.test`;
}

function isLoopbackHost(value: string): boolean {
  try {
    const url = value.includes("://")
      ? new URL(value)
      : new URL(`http://${value}`);
    return ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}
