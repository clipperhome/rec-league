import "server-only";

import { createHash } from "node:crypto";

import { headers } from "next/headers";

import { db } from "./db";

type RateLimitRule = {
  identifier: string;
  limit: number;
  windowMs: number;
};

/**
 * Consume one request from each durable limit. Limits are enforced only in
 * production so local setup and automated checks stay frictionless.
 */
export async function consumeRateLimit(
  action:
    | "create-league"
    | "magic-link"
    | "manager-invite"
    | "organizer-email-change"
    | "portable-import"
    | "portable-reconcile",
  rules: RateLimitRule[],
): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  if (!rules.length) return true;

  const now = new Date();
  const retentionMs = Math.max(...rules.map((rule) => rule.windowMs)) * 2;
  const normalizedRules = rules.map((rule) => ({
    ...rule,
    keyHash: hashIdentifier(`${action}:${rule.identifier}`),
  }));

  try {
    return await db.$transaction(
      async (tx) => {
        await tx.rateLimitEvent.deleteMany({
          where: {
            action,
            createdAt: { lt: new Date(now.getTime() - retentionMs) },
          },
        });

        for (const rule of normalizedRules) {
          const count = await tx.rateLimitEvent.count({
            where: {
              action,
              createdAt: { gte: new Date(now.getTime() - rule.windowMs) },
              keyHash: rule.keyHash,
            },
          });

          if (count >= rule.limit) return false;
        }

        await tx.rateLimitEvent.createMany({
          data: normalizedRules.map((rule) => ({
            action,
            createdAt: now,
            keyHash: rule.keyHash,
          })),
        });

        return true;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    console.error(`Could not enforce ${action} rate limit.`, error);
    return false;
  }
}

export async function getRequestFingerprint(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0];
  const address =
    requestHeaders.get("cf-connecting-ip") ??
    requestHeaders.get("x-real-ip") ??
    forwardedFor ??
    "unknown-client";

  return address.trim().slice(0, 128) || "unknown-client";
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
