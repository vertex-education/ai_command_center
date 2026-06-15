export const workspaceIntelligenceQueueName = "workspace-intelligence-queue";

export type WorkspaceTaskExtractionJob = {
  kind: "workspace-task-extraction";
  requestId: string;
  requestedAt: number;
  workspaceId: string;
  sourceMessageId: string | null;
  prompt: string;
  userId: string | null;
  teamId: string | null;
  projectId: string | null;
};

export type WorkspaceIdeaEvaluationJob = {
  kind: "workspace-idea-evaluation";
  requestId: string;
  requestedAt: number;
  workspaceId: string;
  projectId: string;
  ideaId: string | null;
  ideaText: string;
  userId: string | null;
};

export type WorkspaceIntelligenceJob = WorkspaceTaskExtractionJob | WorkspaceIdeaEvaluationJob;

export function isWorkspaceTaskExtractionJob(value: unknown): value is WorkspaceTaskExtractionJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Partial<WorkspaceTaskExtractionJob>;
  return (
    job.kind === "workspace-task-extraction" &&
    typeof job.requestId === "string" &&
    typeof job.requestedAt === "number" &&
    typeof job.workspaceId === "string" &&
    (typeof job.sourceMessageId === "string" || job.sourceMessageId === null) &&
    typeof job.prompt === "string" &&
    (typeof job.userId === "string" || job.userId === null) &&
    (typeof job.teamId === "string" || job.teamId === null) &&
    (typeof job.projectId === "string" || job.projectId === null)
  );
}

export function isWorkspaceIdeaEvaluationJob(value: unknown): value is WorkspaceIdeaEvaluationJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Partial<WorkspaceIdeaEvaluationJob>;
  return (
    job.kind === "workspace-idea-evaluation" &&
    typeof job.requestId === "string" &&
    typeof job.requestedAt === "number" &&
    typeof job.workspaceId === "string" &&
    typeof job.projectId === "string" &&
    (typeof job.ideaId === "string" || job.ideaId === null) &&
    typeof job.ideaText === "string" &&
    (typeof job.userId === "string" || job.userId === null)
  );
}

export function isWorkspaceIntelligenceJob(value: unknown): value is WorkspaceIntelligenceJob {
  return isWorkspaceTaskExtractionJob(value) || isWorkspaceIdeaEvaluationJob(value);
}
