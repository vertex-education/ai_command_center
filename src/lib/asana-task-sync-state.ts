export const asanaTaskSyncColumnNames = [
  "asana_task_gid",
  "asana_synced_at",
  "asana_sync_queued_at",
  "asana_sync_error",
  "outbound_status",
  "sync_status",
] as const;

export type AsanaOutboundStatus = "Pending" | "Sent" | "Failed";
export type AsanaTaskSyncStatus = "NotQueued" | "Pending" | "Sent" | "Failed";

export type PersistedWorkflowActionRowWithOptionalAsanaSync<T extends object> = T & {
  asanaTaskGid: string | null;
  asanaSyncedAt: number | null;
  asanaSyncQueuedAt: number | null;
  asanaSyncError: string | null;
  outboundStatus: AsanaOutboundStatus;
  syncStatus: AsanaTaskSyncStatus;
};

export function isMissingAsanaSyncColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return asanaTaskSyncColumnNames.some((column) => normalized.includes(column));
}

export function withDefaultAsanaSyncState<T extends object>(row: T): PersistedWorkflowActionRowWithOptionalAsanaSync<T> {
  return {
    ...row,
    asanaTaskGid: null,
    asanaSyncedAt: null,
    asanaSyncQueuedAt: null,
    asanaSyncError: null,
    outboundStatus: "Pending",
    syncStatus: "NotQueued",
  };
}

export function normalizePersistedTaskStatus() {
  return "Open" as const;
}

export function getTaskAsanaSyncControlState({
  canEdit,
  isSyncing,
  asanaTaskGid,
  asanaSyncError,
  asanaSyncQueuedAt,
  syncStatus,
}: {
  canEdit: boolean;
  isSyncing: boolean;
  asanaTaskGid?: string | null;
  asanaSyncError?: string | null;
  asanaSyncQueuedAt?: number | null;
  syncStatus?: AsanaTaskSyncStatus | null;
}) {
  if (asanaTaskGid || syncStatus === "Sent") {
    return {
      disabled: true,
      label: "Synced",
      visible: true,
    } as const;
  }

  if ((asanaSyncQueuedAt && !asanaSyncError) || syncStatus === "Pending") {
    return {
      disabled: true,
      label: "Queued",
      visible: true,
    } as const;
  }

  if (!canEdit) {
    return {
      disabled: true,
      label: "",
      visible: false,
    } as const;
  }

  return {
    disabled: isSyncing,
    label: isSyncing ? "Queueing..." : asanaSyncError || syncStatus === "Failed" ? "Retry Sync" : "Sync to Asana",
    visible: true,
  } as const;
}

export function deriveAsanaTaskSyncStatus({
  asanaSyncError,
  asanaSyncQueuedAt,
  asanaSyncedAt,
  asanaTaskGid,
}: {
  asanaTaskGid: string | null;
  asanaSyncedAt: number | null;
  asanaSyncQueuedAt: number | null;
  asanaSyncError: string | null;
}): AsanaTaskSyncStatus {
  if (asanaSyncError) return "Failed";
  if (asanaTaskGid || asanaSyncedAt) return "Sent";
  if (asanaSyncQueuedAt) return "Pending";
  return "NotQueued";
}
