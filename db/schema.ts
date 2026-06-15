import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    role: text("role").notNull().default("contributor"),
    banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    banReason: text("banReason"),
    banExpires: integer("banExpires", { mode: "timestamp_ms" }),
  },
  (table) => ({
    emailIdx: uniqueIndex("user_email_idx").on(table.email),
    roleIdx: index("user_role_idx").on(table.role),
  }),
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonatedBy"),
    activeOrganizationId: text("activeOrganizationId"),
  },
  (table) => ({
    tokenIdx: uniqueIndex("session_token_idx").on(table.token),
    userIdx: index("session_user_idx").on(table.userId),
    activeOrganizationIdx: index("session_active_organization_idx").on(table.activeOrganizationId),
  }),
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userIdx: index("account_user_idx").on(table.userId),
    providerIdx: index("account_provider_idx").on(table.providerId, table.accountId),
  }),
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  },
  (table) => ({
    identifierIdx: index("verification_identifier_idx").on(table.identifier),
  }),
);

export const authOrganization = sqliteTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    metadata: text("metadata"),
  },
  (table) => ({
    slugIdx: uniqueIndex("organization_slug_idx").on(table.slug),
  }),
);

export const authMember = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => authOrganization.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userIdx: index("member_user_id_idx").on(table.userId),
    organizationIdx: index("member_organization_id_idx").on(table.organizationId),
    userOrganizationIdx: uniqueIndex("member_user_organization_idx").on(table.userId, table.organizationId),
  }),
);

export const authInvitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organizationId")
      .notNull()
      .references(() => authOrganization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    inviterId: text("inviterId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    organizationIdx: index("invitation_organization_id_idx").on(table.organizationId),
    emailIdx: index("invitation_email_idx").on(table.email),
  }),
);

export const authInvites = sqliteTable(
  "auth_invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: ["admin", "manager", "contributor", "user", "viewer"] })
      .notNull()
      .default("contributor"),
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    emailIdx: index("auth_invites_email_idx").on(table.email),
    tokenHashIdx: uniqueIndex("auth_invites_token_hash_idx").on(table.tokenHash),
  }),
);

export const authEmailEvents = sqliteTable(
  "auth_email_events",
  {
    id: text("id").primaryKey(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    actionUrl: text("action_url"),
    sent: integer("sent", { mode: "boolean" }).notNull().default(false),
    failureReason: text("failure_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    recipientIdx: index("auth_email_events_recipient_idx").on(table.recipient, table.createdAt),
  }),
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: text("team_id"),
    projectId: text("project_id"),
    chatId: text("chat_id"),
    mode: text("mode", { enum: ["Personal", "Team", "Org"] }).notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    invalidatesJson: text("invalidates_json").notNull().default("[]"),
    sourceUserId: text("source_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceClientId: text("source_client_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    scopeIdx: index("events_scope_idx").on(table.workspaceId, table.mode, table.teamId, table.id),
    sourceUserIdx: index("events_source_user_idx").on(table.workspaceId, table.sourceUserId, table.id),
    entityIdx: index("events_entity_idx").on(table.entity, table.entityId, table.id),
  }),
);

export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    nameIdx: index("teams_name_idx").on(table.name),
  }),
);

export const teamMembers = sqliteTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userIdx: index("team_members_user_idx").on(table.userId),
    teamUserIdx: uniqueIndex("team_members_team_user_idx").on(table.teamId, table.userId),
  }),
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userIdx: index("project_members_user_idx").on(table.userId),
    projectUserIdx: uniqueIndex("project_members_project_user_idx").on(table.projectId, table.userId),
  }),
);

export const scopedInvites = sqliteTable(
  "scoped_invites",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["team", "project"] }).notNull(),
    targetId: text("target_id").notNull(),
    targetTeamId: text("target_team_id").references(() => teams.id, { onDelete: "cascade" }),
    targetName: text("target_name").notNull(),
    email: text("email").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    emailIdx: index("scoped_invites_email_idx").on(table.email, table.createdAt),
    targetIdx: index("scoped_invites_target_idx").on(table.scope, table.targetId),
  }),
);

export const chatMembers = sqliteTable(
  "chat_members",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userIdx: index("chat_members_user_idx").on(table.userId, table.chatId),
    teamIdx: index("chat_members_team_idx").on(table.teamId, table.chatId),
  }),
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["personal", "team", "org"] }).notNull(),
    name: text("name").notNull(),
    accessLevel: text("access_level", { enum: ["Read / Write", "View only"] })
      .notNull()
      .default("Read / Write"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    scopeIdx: uniqueIndex("workspaces_scope_idx").on(table.scope),
  }),
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: ["Active", "Watch", "Planning", "Blocked", "In Progress"] }).notNull(),
    projectInstructions: text("project_instructions").notNull().default(""),
    asanaTaskStatusSource: text("asana_task_status_source", { enum: ["native", "custom_field"] })
      .notNull()
      .default("native"),
    asanaTaskStatusCustomFieldGid: text("asana_task_status_custom_field_gid"),
    asanaTaskStatusCustomFieldName: text("asana_task_status_custom_field_name"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    workspaceIdx: index("projects_workspace_idx").on(table.workspaceId),
  }),
);

export const risks = sqliteTable(
  "risks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull(),
    status: text("status").notNull().default("open"),
    mitigationStrategy: text("mitigation_strategy").notNull().default(""),
  },
  (table) => ({
    scopeIdx: index("risks_scope_idx").on(table.workspaceId, table.projectId),
    severityIdx: index("risks_severity_idx").on(table.workspaceId, table.projectId, table.severity),
    statusIdx: index("risks_status_idx").on(table.workspaceId, table.projectId, table.status),
  }),
);

export const projectRisks = sqliteTable(
  "project_risks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    riskCategory: text("risk_category", { enum: ["security", "technical", "delivery", "operational", "compliance"] }).notNull(),
    severityLevel: text("severity_level", { enum: ["low", "medium", "high", "critical"] }).notNull(),
    mitigationSuggestion: text("mitigation_suggestion").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    projectIdx: index("project_risks_project_idx").on(table.projectId, table.severityLevel, table.createdAt),
    categoryIdx: index("project_risks_category_idx").on(table.projectId, table.riskCategory),
  }),
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    section: text("section", { enum: ["project", "workspace"] }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    scopeProjectIdx: index("chats_workspace_project_idx").on(table.workspaceId, table.projectId),
    sectionIdx: index("chats_section_idx").on(table.workspaceId, table.section),
  }),
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => chatMessages.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    type: text("type", { enum: ["message", "briefing"] })
      .notNull()
      .default("message"),
    avatar: text("avatar"),
    messageTime: text("message_time").notNull(),
    body: text("body").notNull(),
    artifactTitle: text("artifact_title"),
    artifactType: text("artifact_type", { enum: ["doc", "ppt", "sheet"] }),
    artifactMeta: text("artifact_meta"),
    attachmentsJson: text("attachments_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    chatIdx: index("chat_messages_chat_idx").on(table.chatId, table.createdAt),
    parentIdx: index("chat_messages_parent_idx").on(table.parentId),
    workspaceIdx: index("chat_messages_workspace_idx").on(table.workspaceId),
  }),
);

export const extractedTasks = sqliteTable(
  "extracted_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceMessageId: text("source_message_id").references(() => chatMessages.id, { onDelete: "set null" }),
    taskDescription: text("task_description").notNull(),
    confidenceScore: real("confidence_score").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    workspaceIdx: index("extracted_tasks_workspace_idx").on(table.workspaceId, table.createdAt),
    sourceMessageIdx: index("extracted_tasks_source_message_idx").on(table.sourceMessageId),
  }),
);

export const ideas = sqliteTable(
  "ideas",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    originalText: text("original_text").notNull().default(""),
    status: text("status", { enum: ["Not Started", "Reviewing", "Convert to Project", "Dismiss"] }).notNull(),
    category: text("category").notNull(),
    owner: text("owner").notNull(),
    avatar: text("avatar").notNull(),
    createdLabel: text("created_label").notNull(),
    votes: integer("votes").notNull().default(0),
    impact: integer("impact").notNull(),
    effort: integer("effort").notNull(),
    confidence: integer("confidence").notNull(),
    summary: text("summary").notNull(),
    nextStep: text("next_step").notNull(),
    tagsJson: text("tags_json").notNull(),
    metricsJson: text("metrics_json").notNull(),
    threadJson: text("thread_json").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  },
  (table) => ({
    workspaceIdx: index("ideas_workspace_idx").on(table.workspaceId),
    statusIdx: index("ideas_workspace_status_idx").on(table.workspaceId, table.status),
  }),
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fileType: text("file_type").notNull(),
    owner: text("owner").notNull(),
    artifactDate: text("artifact_date").notNull(),
    status: text("status", { enum: ["Final", "Draft", "Pinned"] }).notNull(),
    summary: text("summary").notNull(),
    r2Key: text("r2_key").notNull(),
    href: text("href").notNull(),
    previewJson: text("preview_json").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    parentArtifactId: text("parent_artifact_id").references((): AnySQLiteColumn => artifacts.id, { onDelete: "set null" }),
    commitMessage: text("commit_message").notNull().default("Initial artifact version"),
  },
  (table) => ({
    workspaceIdx: index("artifacts_workspace_idx").on(table.workspaceId),
    r2KeyIdx: uniqueIndex("artifacts_r2_key_idx").on(table.r2Key),
    projectIdx: index("artifacts_workspace_project_idx").on(table.workspaceId, table.projectId),
    parentIdx: index("artifacts_parent_idx").on(table.parentArtifactId),
    versionIdx: index("artifacts_version_idx").on(table.workspaceId, table.title, table.version),
  }),
);

export const vectorTenantMap = sqliteTable(
  "vector_tenant_map",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: text("team_id"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    tenantKey: text("tenant_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    tenantKeyIdx: uniqueIndex("vector_tenant_map_tenant_key_idx").on(table.tenantKey),
    scopeIdx: index("vector_tenant_map_scope_idx").on(table.workspaceId, table.teamId, table.projectId),
  }),
);

export const knowledgeItems = sqliteTable(
  "knowledge_items",
  {
    id: text("id").primaryKey(),
    itemType: text("item_type", {
      enum: [
        "approval",
        "artifact",
        "asana_snapshot",
        "chat_message",
        "decision",
        "idea",
        "project",
        "r2_object",
        "risk",
        "task",
        "workspace_record",
      ],
    }).notNull(),
    sourceType: text("source_type", { enum: ["asana", "chat", "r2", "rag", "upload", "workspace"] }).notNull(),
    title: text("title").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workspaceScope: text("workspace_scope", { enum: ["org", "team", "personal"] }).notNull(),
    teamId: text("team_id"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    r2Key: text("r2_key"),
    sourceUrl: text("source_url"),
    contentHash: text("content_hash"),
    versionLabel: text("version_label"),
    sensitivityLabel: text("sensitivity_label", { enum: ["Standard", "Confidential"] })
      .notNull()
      .default("Standard"),
    restricted: integer("restricted", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["processing", "completed", "failed"] })
      .notNull()
      .default("processing"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    indexedAt: text("indexed_at"),
    errorMessage: text("error_message"),
  },
  (table) => ({
    scopeIdx: index("knowledge_items_scope_idx").on(
      table.workspaceId,
      table.workspaceScope,
      table.teamId,
      table.projectId,
      table.updatedAt,
    ),
    sourceIdx: index("knowledge_items_source_idx").on(table.sourceType, table.itemType, table.updatedAt),
    statusIdx: index("knowledge_items_status_idx").on(table.status, table.updatedAt),
  }),
);

export const knowledgeChunks = sqliteTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    vectorId: text("vector_id").notNull(),
    vectorTenantId: integer("vector_tenant_id").references(() => vectorTenantMap.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workspaceScope: text("workspace_scope", { enum: ["org", "team", "personal"] }).notNull(),
    teamId: text("team_id"),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    r2Key: text("r2_key"),
    sourceType: text("source_type", { enum: ["asana", "chat", "r2", "rag", "upload", "workspace"] }).notNull(),
    itemType: text("item_type", {
      enum: [
        "approval",
        "artifact",
        "asana_snapshot",
        "chat_message",
        "decision",
        "idea",
        "project",
        "r2_object",
        "risk",
        "task",
        "workspace_record",
      ],
    }).notNull(),
    content: text("content").notNull(),
    sensitivityLabel: text("sensitivity_label", { enum: ["Standard", "Confidential"] })
      .notNull()
      .default("Standard"),
    restricted: integer("restricted", { mode: "boolean" }).notNull().default(false),
    tokenCount: integer("token_count"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    vectorIdx: uniqueIndex("knowledge_chunks_vector_idx").on(table.vectorId),
    itemChunkIdx: uniqueIndex("knowledge_chunks_item_chunk_idx").on(table.itemId, table.chunkIndex),
    tenantIdx: index("knowledge_chunks_tenant_idx").on(table.vectorTenantId, table.projectId, table.teamId),
    scopeIdx: index("knowledge_chunks_scope_idx").on(
      table.workspaceId,
      table.workspaceScope,
      table.teamId,
      table.projectId,
      table.createdAt,
    ),
    itemIdx: index("knowledge_chunks_item_idx").on(table.itemId, table.chunkIndex),
    r2KeyIdx: index("knowledge_chunks_r2_key_idx").on(table.r2Key),
  }),
);

export const workspaceActions = sqliteTable(
  "workspace_actions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["decision", "approval", "task"] }).notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    originalText: text("original_text").notNull().default(""),
    owner: text("owner").notNull(),
    due: text("due").notNull(),
    source: text("source"),
    status: text("status").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    asanaTaskGid: text("asana_task_gid"),
    asanaSyncedAt: integer("asana_synced_at", { mode: "timestamp_ms" }),
    asanaSyncQueuedAt: integer("asana_sync_queued_at", { mode: "timestamp_ms" }),
    asanaSyncError: text("asana_sync_error"),
    outboundStatus: text("outbound_status", { enum: ["Pending", "Sent", "Failed"] })
      .notNull()
      .default("Pending"),
    syncStatus: text("sync_status", { enum: ["NotQueued", "Pending", "Sent", "Failed"] })
      .notNull()
      .default("NotQueued"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    workspaceKindIdx: index("workspace_actions_workspace_kind_idx").on(table.workspaceId, table.kind),
    workspaceKindCreatedIdx: index("workspace_actions_kind_created_idx").on(table.workspaceId, table.kind, table.createdAt),
    asanaTaskGidIdx: index("workspace_actions_asana_task_gid_idx").on(table.asanaTaskGid, table.kind),
    syncStatusIdx: index("workspace_actions_sync_status_idx").on(table.workspaceId, table.kind, table.syncStatus),
  }),
);

export const adminUsageEvents = sqliteTable(
  "admin_usage_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    feature: text("feature").notNull(),
    model: text("model"),
    creditsUsed: integer("credits_used"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    durationMs: integer("duration_ms"),
    teamId: text("team_id"),
    projectId: text("project_id"),
    chatId: text("chat_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    providerIdx: index("admin_usage_events_provider_idx").on(table.provider, table.createdAt),
    scopeIdx: index("admin_usage_events_scope_idx").on(table.teamId, table.projectId, table.createdAt),
    chatIdx: index("admin_usage_events_chat_idx").on(table.chatId, table.createdAt),
  }),
);

export const scheduledTasks = sqliteTable(
  "scheduled_tasks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => authOrganization.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["Weekly Briefing", "Background Research", "Artifact Validation"] }).notNull(),
    status: text("status", { enum: ["pending", "running", "completed", "failed", "paused"] })
      .notNull()
      .default("pending"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    priority: integer("priority").notNull().default(0),
    payloadJson: text("payload_json").notNull().default("{}"),
    scheduleJson: text("schedule_json").notNull().default("{}"),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }).notNull(),
    intervalMinutes: integer("interval_minutes"),
    retryDelayMinutes: integer("retry_delay_minutes").notNull().default(15),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    lastCompletedAt: integer("last_completed_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    resultJson: text("result_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    dueIdx: index("scheduled_tasks_due_idx").on(table.enabled, table.status, table.nextRunAt, table.priority),
    orgTypeIdx: index("scheduled_tasks_org_type_idx").on(table.organizationId, table.type, table.status, table.nextRunAt),
    workspaceIdx: index("scheduled_tasks_workspace_idx").on(table.workspaceId, table.status, table.nextRunAt),
  }),
);

export const briefingSchedules = sqliteTable(
  "briefing_schedules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    recurrence: text("recurrence", { enum: ["daily", "weekdays", "weekly", "monthly", "once"] }).notNull(),
    timeZone: text("time_zone").notNull(),
    localTime: text("local_time").notNull(),
    weekdaysJson: text("weekdays_json").notNull().default("[]"),
    monthDay: integer("month_day"),
    runOnceAt: integer("run_once_at", { mode: "timestamp_ms" }),
    reportingWindowHours: integer("reporting_window_hours").notNull().default(24),
    promptInstructions: text("prompt_instructions").notNull().default(""),
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userIdx: index("briefing_schedules_user_idx").on(table.userId, table.updatedAt),
    dueIdx: index("briefing_schedules_due_idx").on(table.enabled, table.nextRunAt),
    scopeIdx: index("briefing_schedules_scope_idx").on(table.workspaceId, table.projectId),
  }),
);

export const briefingRuns = sqliteTable(
  "briefing_runs",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").references(() => briefingSchedules.id, { onDelete: "set null" }),
    chatMessageId: text("chat_message_id").references(() => chatMessages.id, { onDelete: "set null" }),
    trigger: text("trigger", { enum: ["scheduled", "test", "manual-post"] }).notNull(),
    status: text("status", { enum: ["success", "error"] }).notNull(),
    outputMarkdown: text("output_markdown"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    scheduleIdx: index("briefing_runs_schedule_idx").on(table.scheduleId, table.createdAt),
    statusIdx: index("briefing_runs_status_idx").on(table.status, table.createdAt),
  }),
);

export const briefings = sqliteTable(
  "briefings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    markdownContent: text("markdown_content").notNull(),
    sourceDataHash: text("source_data_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    sourceHashIdx: uniqueIndex("briefings_source_data_hash_idx").on(table.sourceDataHash),
    workspaceIdx: index("briefings_workspace_idx").on(table.workspaceId, table.createdAt),
    projectIdx: index("briefings_project_idx").on(table.projectId, table.createdAt),
  }),
);

export const microsoftGraphSubscriptions = sqliteTable(
  "microsoft_graph_subscriptions",
  {
    subscriptionId: text("subscription_id").primaryKey(),
    tenantId: text("tenant_id"),
    resource: text("resource").notNull(),
    resourceKind: text("resource_kind", { enum: ["teams", "outlook", "other"] }).notNull(),
    changeType: text("change_type").notNull(),
    status: text("status", { enum: ["active", "renewing", "expired", "deleted"] })
      .notNull()
      .default("active"),
    expirationAt: text("expiration_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    notificationCount: integer("notification_count").notNull().default(0),
  },
  (table) => ({
    resourceKindStatusIdx: index("microsoft_graph_subscriptions_kind_status_idx").on(table.resourceKind, table.status),
    expirationIdx: index("microsoft_graph_subscriptions_expiration_idx").on(table.expirationAt),
    tenantIdx: index("microsoft_graph_subscriptions_tenant_idx").on(table.tenantId),
  }),
);

export const microsoftGraphWebhookDeliveries = sqliteTable(
  "microsoft_graph_webhook_deliveries",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    notificationCount: integer("notification_count").notNull(),
    validationTokenCount: integer("validation_token_count").notNull(),
    userAgent: text("user_agent"),
    cfRay: text("cf_ray"),
    connectingIp: text("connecting_ip"),
    receivedAt: text("received_at").notNull(),
  },
  (table) => ({
    requestIdx: uniqueIndex("microsoft_graph_webhook_deliveries_request_idx").on(table.requestId),
    receivedAtIdx: index("microsoft_graph_webhook_deliveries_received_at_idx").on(table.receivedAt),
  }),
);

export const asanaOauthStates = sqliteTable(
  "asana_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeVerifier: text("code_verifier").notNull(),
    redirectTo: text("redirect_to"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userIdx: index("asana_oauth_states_user_idx").on(table.userId, table.expiresAt),
  }),
);

export const asanaConnections = sqliteTable(
  "asana_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    asanaUserGid: text("asana_user_gid").notNull(),
    asanaUserName: text("asana_user_name").notNull(),
    asanaUserEmail: text("asana_user_email"),
    scopes: text("scopes").notNull(),
    autoSyncTasksEnabled: integer("auto_sync_tasks_enabled", { mode: "boolean" }).notNull().default(false),
    connectedAt: integer("connected_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    userIdx: uniqueIndex("asana_connections_user_idx").on(table.userId),
    asanaUserIdx: index("asana_connections_asana_user_idx").on(table.asanaUserGid),
  }),
);

export const asanaProjectMappings = sqliteTable(
  "asana_project_mappings",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => asanaConnections.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    asanaWorkspaceGid: text("asana_workspace_gid").notNull(),
    asanaWorkspaceName: text("asana_workspace_name").notNull(),
    asanaProjectGid: text("asana_project_gid").notNull(),
    asanaProjectName: text("asana_project_name").notNull(),
    asanaTeamGid: text("asana_team_gid"),
    vertexWorkspaceId: text("vertex_workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    vertexMode: text("vertex_mode", { enum: ["Personal", "Team", "Org"] }).notNull(),
    vertexTeamId: text("vertex_team_id"),
    vertexProjectId: text("vertex_project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    vertexChatId: text("vertex_chat_id").references(() => chats.id, { onDelete: "set null" }),
    canWriteTasks: integer("can_write_tasks", { mode: "boolean" }).notNull().default(false),
    permissionLevel: text("permission_level").notNull().default("read"),
    permissionSource: text("permission_source").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    asanaProjectIdx: uniqueIndex("asana_project_mappings_project_idx").on(table.asanaProjectGid),
    vertexProjectIdx: index("asana_project_mappings_vertex_project_idx").on(table.vertexProjectId),
    userIdx: index("asana_project_mappings_user_idx").on(table.userId, table.updatedAt),
  }),
);

export const asanaProjectWebhooks = sqliteTable(
  "asana_project_webhooks",
  {
    asanaProjectGid: text("asana_project_gid").primaryKey(),
    asanaWorkspaceGid: text("asana_workspace_gid").notNull(),
    webhookGid: text("webhook_gid"),
    targetUrl: text("target_url").notNull(),
    status: text("status", { enum: ["active", "creating", "failed", "deleted"] })
      .notNull()
      .default("creating"),
    lastError: text("last_error"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    workspaceIdx: index("asana_project_webhooks_workspace_idx").on(table.asanaWorkspaceGid, table.updatedAt),
    statusIdx: index("asana_project_webhooks_status_idx").on(table.status, table.updatedAt),
    webhookIdx: uniqueIndex("asana_project_webhooks_webhook_idx").on(table.webhookGid),
  }),
);

export const asanaProjectSnapshots = sqliteTable(
  "asana_project_snapshots",
  {
    id: text("id").primaryKey(),
    mappingId: text("mapping_id")
      .notNull()
      .references(() => asanaProjectMappings.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    vertexWorkspaceId: text("vertex_workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    vertexTeamId: text("vertex_team_id"),
    vertexMode: text("vertex_mode", { enum: ["Personal", "Team", "Org"] }).notNull(),
    vertexProjectId: text("vertex_project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    asanaProjectGid: text("asana_project_gid").notNull(),
    asanaProjectName: text("asana_project_name").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    taskCount: integer("task_count").notNull(),
    statusUpdateCount: integer("status_update_count").notNull(),
    storyCount: integer("story_count").notNull(),
    diffSummary: text("diff_summary").notNull(),
    r2Key: text("r2_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    mappingCreatedIdx: index("asana_project_snapshots_mapping_created_idx").on(table.mappingId, table.createdAt),
    mappingHashIdx: uniqueIndex("asana_project_snapshots_mapping_hash_idx").on(table.mappingId, table.snapshotHash),
    vertexProjectIdx: index("asana_project_snapshots_vertex_project_idx").on(table.vertexProjectId, table.createdAt),
  }),
);

export const asanaWebhookTaskStates = sqliteTable(
  "asana_webhook_task_states",
  {
    asanaTaskGid: text("asana_task_gid").primaryKey(),
    asanaWorkspaceGid: text("asana_workspace_gid").notNull(),
    vertexWorkspaceId: text("vertex_workspace_id"),
    asanaProjectGid: text("asana_project_gid"),
    taskName: text("task_name"),
    action: text("action").notNull(),
    changeAction: text("change_action"),
    changeField: text("change_field"),
    status: text("status"),
    lastEventAt: integer("last_event_at", { mode: "timestamp_ms" }).notNull(),
    rawEventJson: text("raw_event_json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    workspaceIdx: index("asana_webhook_task_states_workspace_idx").on(table.asanaWorkspaceGid, table.updatedAt),
    vertexWorkspaceIdx: index("asana_webhook_task_states_vertex_workspace_idx").on(table.vertexWorkspaceId, table.updatedAt),
    projectIdx: index("asana_webhook_task_states_project_idx").on(table.asanaProjectGid, table.updatedAt),
  }),
);
