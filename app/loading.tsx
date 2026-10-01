export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f3f6f2] px-4 py-16 text-[#10231c]">
      <div className="mx-auto max-w-6xl animate-pulse space-y-5" aria-label="Loading">
        <div className="h-10 w-44 rounded-lg bg-[#d9e2dc]" />
        <div className="h-40 rounded-2xl bg-white" />
        <div className="grid gap-5 md:grid-cols-2">
          <div className="h-64 rounded-2xl bg-white" />
          <div className="h-64 rounded-2xl bg-white" />
        </div>
      </div>
    </div>
  );
}
