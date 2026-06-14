import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
    role: text("role").notNull().default("user"),
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
    userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonatedBy"),
  },
  (table) => ({
    tokenIdx: uniqueIndex("session_token_idx").on(table.token),
    userIdx: index("session_user_idx").on(table.userId),
  }),
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
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

export const authInvites = sqliteTable(
  "auth_invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: ["admin", "user", "viewer"] }).notNull().default("user"),
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
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: text("team_id"),
    projectId: text("project_id"),
    chatId: text("chat_id"),
    mode: text("mode", { enum: ["Personal", "Team", "Org"] }).notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    invalidatesJson: text("invalidates_json").notNull().default("[]"),
    sourceUserId: text("source_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
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
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
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
    accessLevel: text("access_level", { enum: ["Read / Write", "View only"] }).notNull().default("Read / Write"),
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
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: ["Active", "Watch", "Planning", "Blocked", "In Progress"] }).notNull(),
    projectInstructions: text("project_instructions").notNull().default(""),
    asanaTaskStatusSource: text("asana_task_status_source", { enum: ["native", "custom_field"] }).notNull().default("native"),
    asanaTaskStatusCustomFieldGid: text("asana_task_status_custom_field_gid"),
    asanaTaskStatusCustomFieldName: text("asana_task_status_custom_field_name"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => ({
    workspaceIdx: index("projects_workspace_idx").on(table.workspaceId),
  }),
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
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
    chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => chatMessages.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
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

export const ideas = sqliteTable(
  "ideas",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
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
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fileType: text("file_type").notNull(),
    owner: text("owner").notNull(),
    artifactDate: text("artifact_date").notNull(),
    status: text("status", { enum: ["Final", "Draft", "Pinned"] }).notNull(),
    summary: text("summary").notNull(),
    r2Key: text("r2_key").notNull(),
    href: text("href").notNull(),
    previewJson: text("preview_json").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull().default(1),
    parentArtifactId: text("parent_artifact_id").references((): AnySQLiteColumn => artifacts.id, { onDelete: "set null" }),
    commitMessage: text("commit_message").notNull().default("Initial artifact version"),
  },
  (table) => ({
    workspaceIdx: index("artifacts_workspace_idx").on(table.workspaceId),
    r2KeyIdx: uniqueIndex("artifacts_r2_key_idx").on(table.r2Key),
    parentIdx: index("artifacts_parent_idx").on(table.parentArtifactId),
    versionIdx: index("artifacts_version_idx").on(table.workspaceId, table.title, table.version),
  }),
);

export const documentChunks = sqliteTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    projectId: text("project_id").notNull(),
    documentName: text("document_name").notNull(),
    r2Key: text("r2_key").notNull(),
    content: text("content").notNull(),
    sensitivityLabel: text("sensitivity_label", { enum: ["Standard", "Confidential"] }).notNull().default("Standard"),
    restricted: integer("restricted", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    scopeIdx: index("document_chunks_scope_idx").on(table.teamId, table.projectId, table.createdAt),
    r2KeyIdx: index("document_chunks_r2_key_idx").on(table.r2Key),
  }),
);

export const workspaceActions = sqliteTable(
  "workspace_actions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["decision", "approval", "task"] }).notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    originalText: text("original_text").notNull().default(""),
    owner: text("owner").notNull(),
    due: text("due").notNull(),
    source: text("source"),
    status: text("status").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  },
  (table) => ({
    workspaceKindIdx: index("workspace_actions_workspace_kind_idx").on(table.workspaceId, table.kind),
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

export const microsoftGraphSubscriptions = sqliteTable(
  "microsoft_graph_subscriptions",
  {
    subscriptionId: text("subscription_id").primaryKey(),
    tenantId: text("tenant_id"),
    resource: text("resource").notNull(),
    resourceKind: text("resource_kind", { enum: ["teams", "outlook", "other"] }).notNull(),
    changeType: text("change_type").notNull(),
    status: text("status", { enum: ["active", "renewing", "expired", "deleted"] }).notNull().default("active"),
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
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    asanaUserGid: text("asana_user_gid").notNull(),
    asanaUserName: text("asana_user_name").notNull(),
    asanaUserEmail: text("asana_user_email"),
    scopes: text("scopes").notNull(),
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
    connectionId: text("connection_id").notNull().references(() => asanaConnections.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    asanaWorkspaceGid: text("asana_workspace_gid").notNull(),
    asanaWorkspaceName: text("asana_workspace_name").notNull(),
    asanaProjectGid: text("asana_project_gid").notNull(),
    asanaProjectName: text("asana_project_name").notNull(),
    asanaTeamGid: text("asana_team_gid"),
    vertexWorkspaceId: text("vertex_workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    vertexMode: text("vertex_mode", { enum: ["Personal", "Team", "Org"] }).notNull(),
    vertexTeamId: text("vertex_team_id"),
    vertexProjectId: text("vertex_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
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
