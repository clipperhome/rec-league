import { ShareButton } from "@/app/components/share-button";

export function CopyPublicLinkButton({ slug }: { slug: string }) {
  return (
    <ShareButton
      label="Share public page"
      url={`/l/${encodeURIComponent(slug)}`}
    />
  );
}
