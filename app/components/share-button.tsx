"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function ShareButton({
  className,
  label = "Share league",
  text,
  title,
  url,
}: {
  className?: string;
  label?: string;
  text?: string;
  title?: string;
  url?: string;
}) {
  const [status, setStatus] = useState<"copied" | "error" | "idle">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const showStatus = useCallback((next: "copied" | "error") => {
    setStatus(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2500);
  }, []);

  const copy = useCallback(
    async (shareUrl: string) => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        showStatus("copied");
        return;
      } catch {
        try {
          const input = document.createElement("input");
          input.value = shareUrl;
          input.style.position = "fixed";
          input.style.opacity = "0";
          document.body.appendChild(input);
          input.select();
          const copied = document.execCommand("copy");
          input.remove();
          if (!copied) throw new Error("Copy was rejected.");
          showStatus("copied");
          return;
        } catch {
          showStatus("error");
        }
      }
    },
    [showStatus],
  );

  const handleShare = useCallback(async () => {
    const shareUrl = url ? new URL(url, window.location.origin).toString() : window.location.href;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, title, url: shareUrl });
        return;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "AbortError"
        ) {
          return;
        }
      }
    }

    await copy(shareUrl);
  }, [copy, text, title, url]);

  return (
    <div className="inline-flex flex-col items-stretch gap-1">
      <button
        className={
          className ??
          "inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0f5138] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#0a3828] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942]"
        }
        onClick={handleShare}
        type="button"
      >
        {status === "copied" ? "Link copied ✓" : label}
      </button>
      <span className="sr-only" role="status">
        {status === "copied"
          ? "Link copied to clipboard."
          : status === "error"
            ? "The link could not be shared or copied."
            : ""}
      </span>
      {status === "error" ? (
        <span className="max-w-48 text-xs font-semibold text-red-800">
          Couldn’t share or copy this link.
        </span>
      ) : null}
    </div>
  );
}
