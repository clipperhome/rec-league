import { NextRequest, NextResponse } from "next/server";

import {
  createSession,
  setSessionCookie,
  verifyMagicLinkToken,
} from "@/lib/auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing token parameter." },
      { status: 400 },
    );
  }

  const result = await verifyMagicLinkToken(token);

  if (!result) {
    return NextResponse.json(
      { error: "Invalid or expired magic link. Please request a new one." },
      { status: 401 },
    );
  }

  const sessionToken = await createSession(result.email);
  await setSessionCookie(sessionToken);

  return NextResponse.redirect(
    new URL(`/dashboard/${result.slug}`, request.url),
  );
}
