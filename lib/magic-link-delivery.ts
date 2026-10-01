import { headers } from "next/headers";
import { after } from "next/server";

import {
  getConfiguredAppUrl,
  sendMagicLinkEmail,
} from "@/lib/email";

type MagicLinkDelivery = {
  email: string;
  intent?: "manager-invite" | "organizer-transfer" | "sign-in";
  leagueName: string;
  magicLinkUrl: string;
  roleLabel?: string;
};

export async function buildMagicLinkUrl(token: string): Promise<string> {
  let appUrl: URL;

  if (process.env.NODE_ENV === "production" || process.env.APP_URL?.trim()) {
    appUrl = getConfiguredAppUrl();
  } else {
    const headersList = await headers();
    const host = headersList.get("host") ?? "localhost:3000";
    const protocol =
      headersList.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
        ? "https"
        : "http";
    appUrl = new URL(`${protocol}://${host}`);
  }

  const magicLinkUrl = new URL("/api/auth/verify", appUrl);
  magicLinkUrl.searchParams.set("token", token);
  return magicLinkUrl.toString();
}

export async function deliverMagicLink({
  email,
  intent = "sign-in",
  leagueName,
  magicLinkUrl,
  roleLabel = "league staff",
}: MagicLinkDelivery): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    await sendMagicLinkEmail({
      intent,
      leagueName,
      magicLinkUrl,
      roleLabel,
      to: email,
    });
    return;
  }

  console.log(`\n🔗 Magic link for ${email}:\n${magicLinkUrl}\n`);
}

export function queueMagicLinkDelivery(delivery: MagicLinkDelivery): void {
  if (process.env.NODE_ENV === "production") {
    after(async () => {
      try {
        await deliverMagicLink(delivery);
      } catch (error) {
        console.error("Could not deliver a league staff magic link.", error);
      }
    });
    return;
  }

  void deliverMagicLink(delivery);
}
