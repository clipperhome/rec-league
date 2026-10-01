type NoticeProps = {
  message?: string;
  tone?: "error" | "success";
};

export function Notice({ message, tone = "success" }: NoticeProps) {
  if (!message) {
    return null;
  }

  const classes =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm font-medium ${classes}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {message}
    </div>
  );
}
