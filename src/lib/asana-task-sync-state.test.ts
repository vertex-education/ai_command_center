import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  asanaTaskSyncColumnNames,
  deriveAsanaTaskSyncStatus,
  getTaskAsanaSyncControlState,
  isMissingAsanaSyncColumnError,
  normalizePersistedTaskStatus,
  withDefaultAsanaSyncState,
} from "@/lib/asana-task-sync-state";

describe("Asana task sync state", () => {
  it("detects old workspace_actions schemas that are missing Asana sync columns", () => {
    for (const column of asanaTaskSyncColumnNames) {
      expect(isMissingAsanaSyncColumnError(new Error(`D1_ERROR: no such column: ${column}`))).toBe(true);
    }

    expect(isMissingAsanaSyncColumnError(new Error("D1_ERROR: no such table: workspace_actions"))).toBe(false);
    expect(isMissingAsanaSyncColumnError("SQLITE_BUSY: database is locked")).toBe(false);
  });

  it("fills sync metadata with nulls when falling back to the old action row shape", () => {
    const row = withDefaultAsanaSyncState({
      id: "task-1",
      kind: "task",
      title: "Follow up with school ops",
    });

    expect(row).toEqual({
      id: "task-1",
      kind: "task",
      title: "Follow up with school ops",
      asanaTaskGid: null,
      asanaSyncedAt: null,
      asanaSyncQueuedAt: null,
      asanaSyncError: null,
      outboundStatus: "Pending",
      syncStatus: "NotQueued",
    });
  });

  it("derives durable sync status from persisted task sync fields", () => {
    expect(deriveAsanaTaskSyncStatus({ asanaTaskGid: null, asanaSyncedAt: null, asanaSyncQueuedAt: null, asanaSyncError: null })).toBe(
      "NotQueued",
    );
    expect(deriveAsanaTaskSyncStatus({ asanaTaskGid: null, asanaSyncedAt: null, asanaSyncQueuedAt: 123, asanaSyncError: null })).toBe(
      "Pending",
    );
    expect(deriveAsanaTaskSyncStatus({ asanaTaskGid: "120", asanaSyncedAt: 456, asanaSyncQueuedAt: null, asanaSyncError: null })).toBe(
      "Sent",
    );
    expect(deriveAsanaTaskSyncStatus({ asanaTaskGid: null, asanaSyncedAt: null, asanaSyncQueuedAt: 123, asanaSyncError: "Nope" })).toBe(
      "Failed",
    );
  });

  it("normalizes persisted task completion away from the app model", () => {
    expect(normalizePersistedTaskStatus()).toBe("Open");
  });

  it("shows a manual sync button for editable unsynced tasks", () => {
    expect(
      getTaskAsanaSyncControlState({
        asanaTaskGid: null,
        canEdit: true,
        isSyncing: false,
      }),
    ).toEqual({
      disabled: false,
      label: "Sync to Asana",
      visible: true,
    });
  });

  it("disables the manual sync button while the task is syncing", () => {
    expect(
      getTaskAsanaSyncControlState({
        canEdit: true,
        isSyncing: true,
      }),
    ).toEqual({
      disabled: true,
      label: "Queueing...",
      visible: true,
    });
  });

  it("shows queued tasks as waiting for the queue worker", () => {
    expect(
      getTaskAsanaSyncControlState({
        asanaSyncQueuedAt: 123,
        canEdit: true,
        isSyncing: false,
      }),
    ).toEqual({
      disabled: true,
      label: "Queued",
      visible: true,
    });
  });

  it("allows failed queued syncs to be retried", () => {
    expect(
      getTaskAsanaSyncControlState({
        asanaSyncError: "Reconnect Asana before submitting tasks.",
        asanaSyncQueuedAt: null,
        canEdit: true,
        isSyncing: false,
      }),
    ).toEqual({
      disabled: false,
      label: "Retry Sync",
      visible: true,
    });
  });

  it("persists synced tasks as a disabled synced control", () => {
    expect(
      getTaskAsanaSyncControlState({
        asanaTaskGid: "1202515054453280",
        canEdit: true,
        isSyncing: false,
      }),
    ).toEqual({
      disabled: true,
      label: "Synced",
      visible: true,
    });
  });

  it("does not show manual Asana sync controls to read-only users before sync", () => {
    expect(
      getTaskAsanaSyncControlState({
        asanaTaskGid: null,
        canEdit: false,
        isSyncing: false,
      }),
    ).toEqual({
      disabled: true,
      label: "",
      visible: false,
    });
  });

  it("keeps the database migration aligned with the sync-state model", () => {
    const migrationPath = fileURLToPath(new URL("../../drizzle/0021_manual_asana_task_sync.sql", import.meta.url));
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("ALTER TABLE workspace_actions ADD COLUMN asana_task_gid TEXT");
    expect(migration).toContain("ALTER TABLE workspace_actions ADD COLUMN asana_synced_at INTEGER");
    expect(migration).toContain("ALTER TABLE workspace_actions ADD COLUMN asana_sync_error TEXT");
    expect(migration).toContain("ALTER TABLE asana_connections ADD COLUMN auto_sync_tasks_enabled INTEGER DEFAULT 0 NOT NULL");
    const queueMigrationPath = fileURLToPath(new URL("../../drizzle/0025_asana_sync_queue.sql", import.meta.url));
    const queueMigration = readFileSync(queueMigrationPath, "utf8");
    expect(queueMigration).toContain("ALTER TABLE workspace_actions ADD COLUMN asana_sync_queued_at INTEGER");
    const phase3MigrationPath = fileURLToPath(new URL("../../drizzle/0029_phase3_agentic_backlog.sql", import.meta.url));
    const phase3Migration = readFileSync(phase3MigrationPath, "utf8");
    expect(phase3Migration).toContain("ALTER TABLE workspace_actions ADD COLUMN outbound_status TEXT NOT NULL DEFAULT 'Pending'");
    expect(phase3Migration).toContain("ALTER TABLE workspace_actions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'NotQueued'");
  });
});
