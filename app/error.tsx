"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-[#f3f6f2] px-4 text-[#10231c]">
      <main className="w-full max-w-lg rounded-2xl border border-[#cad7cf] bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-red-700">Something went wrong</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">That play didn’t land.</h1>
        <p className="mt-3 text-base leading-7 text-[#627068]">
          Your changes may not have been saved. Try the page again before entering anything new.
        </p>
        <button className="mt-6 min-h-12 rounded-xl bg-[#0f5138] px-6 py-3 font-bold text-white hover:bg-[#0a3828]" onClick={reset} type="button">
          Try again
        </button>
      </main>
    </div>
  );
}
