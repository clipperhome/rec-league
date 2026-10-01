const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

type MagicLinkEmail = {
  intent?: "manager-invite" | "organizer-transfer" | "sign-in";
  leagueName: string;
  magicLinkUrl: string;
  roleLabel?: string;
  to: string;
};

type EmailConfiguration = {
  apiKey: string;
  appUrl: URL;
  from: string;
};

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

/**
 * Read and validate all settings required for production magic-link email.
 * Calling this before account lookup keeps configuration errors independent of
 * whether the submitted address owns a league.
 */
export function getEmailConfiguration(): EmailConfiguration {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    throw new EmailConfigurationError(
      "RESEND_API_KEY and AUTH_FROM_EMAIL must be configured.",
    );
  }

  return {
    apiKey,
    appUrl: getConfiguredAppUrl(),
    from,
  };
}

/** Return the trusted, deployment-configured application origin. */
export function getConfiguredAppUrl(): URL {
  const value = process.env.APP_URL?.trim();

  if (!value) {
    throw new EmailConfigurationError("APP_URL must be configured.");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new EmailConfigurationError("APP_URL must be a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EmailConfigurationError("APP_URL must use HTTP or HTTPS.");
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new EmailConfigurationError("APP_URL must use HTTPS in production.");
  }

  if (url.username || url.password) {
    throw new EmailConfigurationError("APP_URL must not contain credentials.");
  }

  return new URL(url.origin);
}

export async function sendMagicLinkEmail({
  intent = "sign-in",
  leagueName,
  magicLinkUrl,
  roleLabel = "league staff",
  to,
}: MagicLinkEmail): Promise<void> {
  const { apiKey, from } = getEmailConfiguration();
  const safeLeagueName = leagueName.trim() || "your league";
  const subjectLeagueName = safeLeagueName.replace(/[\r\n]+/g, " ");
  const subject =
    intent === "organizer-transfer"
      ? `Accept organizer ownership of ${subjectLeagueName}`
      : intent === "manager-invite"
        ? `Accept your team-manager invitation for ${subjectLeagueName}`
        : `Sign in to manage ${subjectLeagueName}`;
  const textIntro =
    intent === "organizer-transfer"
      ? `You were invited to become the organizer of ${safeLeagueName}. Continuing will transfer league ownership to this email address:`
      : intent === "manager-invite"
        ? `You were invited to report team updates for ${safeLeagueName}. The organizer will approve changes before they become official:`
        : `Use this secure link to manage ${safeLeagueName}:`;

  let response: Response;

  try {
    response = await fetch(RESEND_EMAIL_ENDPOINT, {
      signal: AbortSignal.timeout(10_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "rec-league/1.0",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: [
          textIntro,
          "",
          magicLinkUrl,
          "",
          "This link expires in 15 minutes and can only be used once.",
          "If you did not request it, you can ignore this email.",
        ].join("\n"),
        html: buildEmailHtml(
          safeLeagueName,
          magicLinkUrl,
          roleLabel,
          intent,
        ),
      }),
    });
  } catch {
    throw new EmailDeliveryError("The email provider could not be reached.");
  }

  if (!response.ok) {
    throw new EmailDeliveryError(
      `The email provider rejected the request with status ${response.status}.`,
    );
  }
}

function buildEmailHtml(
  leagueName: string,
  magicLinkUrl: string,
  roleLabel: string,
  intent: "manager-invite" | "organizer-transfer" | "sign-in",
): string {
  const safeName = escapeHtml(leagueName);
  const safeUrl = escapeHtml(magicLinkUrl);

  const heading =
    intent === "organizer-transfer"
      ? `Accept ownership of ${safeName}`
      : intent === "manager-invite"
        ? `Join ${safeName} as a team manager`
        : `Manage ${safeName}`;
  const copy =
    intent === "organizer-transfer"
      ? "Continuing transfers organizer ownership to your email address and replaces the current organizer."
      : intent === "manager-invite"
        ? `Use this secure link to accept your ${escapeHtml(roleLabel)} invitation. Your reports need organizer approval before they become official.`
        : `Use this secure link to open your ${escapeHtml(roleLabel)} workspace.`;
  const linkLabel =
    intent === "organizer-transfer"
      ? "Review and accept organizer ownership"
      : intent === "manager-invite"
        ? "Accept team-manager invitation"
        : "Sign in to manage your league";

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#18181b">
      <h1 style="font-size:22px">${heading}</h1>
      <p>${copy}</p>
      <p><a href="${safeUrl}">${linkLabel}</a></p>
      <p style="color:#52525b">This link expires in 15 minutes and can only be used once.</p>
      <p style="color:#52525b">If you did not request it, you can ignore this email.</p>
    </div>
  `.trim();
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
