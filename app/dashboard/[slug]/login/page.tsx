import { redirect } from "next/navigation";

type DashboardLoginPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DashboardLoginPage({ params }: DashboardLoginPageProps) {
  const { slug } = await params;

  redirect(`/manage?slug=${encodeURIComponent(slug)}`);
}
