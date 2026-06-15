export const asanaTaskSyncColumnNames = ["asana_task_gid", "asana_synced_at", "asana_sync_queued_at", "asana_sync_error"] as const;

export type PersistedWorkflowActionRowWithOptionalAsanaSync<T extends object> = T & {
  asanaTaskGid: string | null;
  asanaSyncedAt: number | null;
  asanaSyncQueuedAt: number | null;
  asanaSyncError: string | null;
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
}: {
  canEdit: boolean;
  isSyncing: boolean;
  asanaTaskGid?: string | null;
  asanaSyncError?: string | null;
  asanaSyncQueuedAt?: number | null;
}) {
  if (asanaTaskGid) {
    return {
      disabled: true,
      label: "Synced",
      visible: true,
    } as const;
  }

  if (asanaSyncQueuedAt && !asanaSyncError) {
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
    label: isSyncing ? "Queueing..." : asanaSyncError ? "Retry Sync" : "Sync to Asana",
    visible: true,
  } as const;
}
