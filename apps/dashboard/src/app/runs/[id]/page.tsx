import { RunPage } from "@/components/run";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <RunPage key={(await params).id} id={(await params).id} />;
}
