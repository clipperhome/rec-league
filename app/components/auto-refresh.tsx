"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export function AutoRefresh({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const previousUpdate = useRef(updatedAt);
  const [announcement, setAnnouncement] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (previousUpdate.current !== updatedAt) {
      previousUpdate.current = updatedAt;
      const timer = window.setTimeout(
        () => setAnnouncement(`League information updated at ${updatedAt}.`),
        0,
      );
      return () => window.clearTimeout(timer);
    }
  }, [updatedAt]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 500);
  }, [router]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  return (
    <>
      <button
        className="min-h-11 rounded-lg border border-[#bdcbc2] bg-white px-3 py-2 text-sm font-semibold text-[#0f5138] hover:border-[#0f5138] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4b942] disabled:opacity-60"
        disabled={refreshing}
        onClick={refresh}
        type="button"
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}
