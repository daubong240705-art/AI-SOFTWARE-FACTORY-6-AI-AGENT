import { ProjectPage } from "@/components/projects";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ProjectPage key={(await params).id} id={(await params).id} />;
}
