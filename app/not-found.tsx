import Link from "next/link";

import { BrandLink } from "@/app/components/brand-link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#f3f6f2] text-[#10231c]">
      <header className="border-b border-[#d9e2dc] bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6"><BrandLink /></div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#0f6a48]">Page not found</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">This league isn’t on the board.</h1>
        <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-[#627068]">
          Check the link with your league organizer, or head home to start a new league.
        </p>
        <Link className="mt-7 inline-flex min-h-12 items-center rounded-xl bg-[#0f5138] px-6 py-3 font-bold text-white hover:bg-[#0a3828]" href="/">
          Back to Rec League
        </Link>
      </main>
    </div>
  );
}
