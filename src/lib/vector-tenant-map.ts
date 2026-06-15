/// <reference path="../../worker-configuration.d.ts" />

export function vectorTenantKey({
  projectId,
  teamId,
  workspaceId,
}: {
  workspaceId: string;
  teamId?: string | null;
  projectId?: string | null;
}) {
  return ["workspace", workspaceId, "team", teamId ?? "", "project", projectId ?? ""].join(":");
}

export async function ensureVectorTenantId(
  db: D1Database,
  {
    projectId,
    teamId,
    workspaceId,
  }: {
    workspaceId: string;
    teamId?: string | null;
    projectId?: string | null;
  },
) {
  const tenantKey = vectorTenantKey({ projectId, teamId, workspaceId });
  const existing = await db
    .prepare("SELECT id FROM vector_tenant_map WHERE tenant_key = ? LIMIT 1")
    .bind(tenantKey)
    .first<{ id: number }>();
  if (existing) return existing.id;

  await db
    .prepare("INSERT OR IGNORE INTO vector_tenant_map (workspace_id, team_id, project_id, tenant_key, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(workspaceId, teamId ?? null, projectId ?? null, tenantKey, Date.now())
    .run();

  const created = await db.prepare("SELECT id FROM vector_tenant_map WHERE tenant_key = ? LIMIT 1").bind(tenantKey).first<{ id: number }>();
  if (!created) throw new Error("Could not resolve Vectorize tenant mapping.");
  return created.id;
}
