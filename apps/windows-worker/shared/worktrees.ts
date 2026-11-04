export type OwnedWorkspace = {
  id: string;
  projectId: string;
  repository: string;
  source: string;
  path: string;
  head: string;
  createdAt: string;
  state: "creating" | "ready" | "retained" | "missing";
  issue?: string;
};
export type WorkspaceRemoval = { token: string; id: string; path: string };
