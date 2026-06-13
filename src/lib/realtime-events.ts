import type { WorkspaceMode } from "@/lib/pmo-data";

export type RealtimeInvalidationTarget = "workspace" | "teams" | "projects" | "chats";

export type RealtimeMutationEvent = {
  id: number;
  type: "mutation";
  mode: WorkspaceMode;
  workspaceId: string;
  teamId: string | null;
  projectId: string | null;
  chatId: string | null;
  entity: string;
  entityId: string;
  operation: string;
  invalidates: RealtimeInvalidationTarget[];
  sourceUserId: string;
  sourceClientId: string | null;
  createdAt: number;
};

export type RealtimeMutationEventInput = Omit<RealtimeMutationEvent, "id" | "type" | "createdAt">;

export async function recordRealtimeMutationEvent(db: D1Database, input: RealtimeMutationEventInput) {
  await db
    .prepare(
      `INSERT INTO events (
        workspace_id,
        team_id,
        project_id,
        chat_id,
        mode,
        entity,
        entity_id,
        operation,
        invalidates_json,
        source_user_id,
        source_client_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.workspaceId,
      input.teamId,
      input.projectId,
      input.chatId,
      input.mode,
      input.entity,
      input.entityId,
      input.operation,
      JSON.stringify(input.invalidates),
      input.sourceUserId,
      input.sourceClientId,
      Date.now(),
    )
    .run();
}

export function parseRealtimeEventRow(row: {
  id: number;
  workspaceId: string;
  teamId: string | null;
  projectId: string | null;
  chatId: string | null;
  mode: WorkspaceMode;
  entity: string;
  entityId: string;
  operation: string;
  invalidatesJson: string;
  sourceUserId: string;
  sourceClientId: string | null;
  createdAt: number;
}): RealtimeMutationEvent {
  return {
    id: row.id,
    type: "mutation",
    mode: row.mode,
    workspaceId: row.workspaceId,
    teamId: row.teamId,
    projectId: row.projectId,
    chatId: row.chatId,
    entity: row.entity,
    entityId: row.entityId,
    operation: row.operation,
    invalidates: parseInvalidates(row.invalidatesJson),
    sourceUserId: row.sourceUserId,
    sourceClientId: row.sourceClientId,
    createdAt: row.createdAt,
  };
}

function parseInvalidates(value: string): RealtimeInvalidationTarget[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return ["workspace"];
    return parsed.filter((item): item is RealtimeInvalidationTarget =>
      item === "workspace" || item === "teams" || item === "projects" || item === "chats",
    );
  } catch {
    return ["workspace"];
  }
}
