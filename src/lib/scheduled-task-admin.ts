import { createServerFn } from "@tanstack/react-start";
import type { CreateScheduledTaskAdminInput, UpdateScheduledTaskAdminInput } from "@/lib/scheduled-task-admin-shared";

export const listScheduledTasks = createServerFn({ method: "GET" }).handler(async () => {
  const { listScheduledTasksForAdmin } = await import("@/lib/scheduled-task-admin.server");
  return listScheduledTasksForAdmin();
});

export const createScheduledTask = createServerFn({ method: "POST" })
  .validator((data: CreateScheduledTaskAdminInput) => data)
  .handler(async ({ data }) => {
    const { createScheduledTaskForAdmin } = await import("@/lib/scheduled-task-admin.server");
    return createScheduledTaskForAdmin(data);
  });

export const updateScheduledTaskSettings = createServerFn({ method: "POST" })
  .validator((data: UpdateScheduledTaskAdminInput) => data)
  .handler(async ({ data }) => {
    const { updateScheduledTaskSettingsForAdmin } = await import("@/lib/scheduled-task-admin.server");
    return updateScheduledTaskSettingsForAdmin(data);
  });

export const setScheduledTaskEnabled = createServerFn({ method: "POST" })
  .validator((data: { taskId: string; enabled: boolean }) => data)
  .handler(async ({ data }) => {
    const { setScheduledTaskEnabledForAdmin } = await import("@/lib/scheduled-task-admin.server");
    return setScheduledTaskEnabledForAdmin(data.taskId, data.enabled);
  });

export const queueScheduledTask = createServerFn({ method: "POST" })
  .validator((data: { taskId: string }) => data)
  .handler(async ({ data }) => {
    const { queueScheduledTaskForAdmin } = await import("@/lib/scheduled-task-admin.server");
    return queueScheduledTaskForAdmin(data.taskId);
  });
