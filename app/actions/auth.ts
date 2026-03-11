"use server";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import { generateMagicLinkToken } from "@/lib/auth";

export type SendMagicLinkState = {
  email: string;
  error: string | null;
  magicLinkUrl: string | null;
  success: boolean;
};

export async function sendMagicLinkAction(
  _prevState: SendMagicLinkState,
  formData: FormData,
): Promise<SendMagicLinkState> {
  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";

  if (!email) {
    return {
      email,
      error: "Email is required.",
      magicLinkUrl: null,
      success: false,
    };
  }

  if (!slug) {
    return {
      email,
      error: "League not found.",
      magicLinkUrl: null,
      success: false,
    };
  }

  const league = await db.league.findUnique({
    where: { slug },
    select: { id: true, commissionerEmail: true },
  });

  if (!league || !league.commissionerEmail) {
    return {
      email,
      error: "No league found with that URL.",
      magicLinkUrl: null,
      success: false,
    };
  }

  if (league.commissionerEmail.toLowerCase().trim() !== email.toLowerCase()) {
    // Don't reveal whether the email is correct — show the same success message
    return {
      email,
      error: null,
      magicLinkUrl: null,
      success: true,
    };
  }

  const token = await generateMagicLinkToken(email.toLowerCase(), league.id);

  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const magicLinkUrl = `${protocol}://${host}/api/auth/verify?token=${token}`;

  // In development, log the magic link for easy testing
  if (process.env.NODE_ENV !== "production") {
    console.log(`\n🔗 Magic link for ${email}:\n${magicLinkUrl}\n`);
  }

  // TODO: Send email with magic link in production (e.g., Resend, SendGrid)

  return {
    email,
    error: null,
    magicLinkUrl:
      process.env.NODE_ENV !== "production" ? magicLinkUrl : null,
    success: true,
  };
}
