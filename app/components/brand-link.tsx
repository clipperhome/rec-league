import Link from "next/link";

type BrandLinkProps = {
  inverse?: boolean;
};

export function BrandLink({ inverse = false }: BrandLinkProps) {
  return (
    <Link
      className={`flex min-h-11 w-fit items-center gap-3 font-semibold tracking-tight ${
        inverse ? "text-white" : "text-[#10231c]"
      }`}
      href="/"
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-lg text-sm font-black ${
          inverse
            ? "bg-[#f4b942] text-[#10231c]"
            : "bg-[#0f5138] text-white"
        }`}
      >
        RL
      </span>
      Rec League
    </Link>
  );
}
