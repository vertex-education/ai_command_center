import { createServerFn } from "@tanstack/react-start";

export type BriefingRecurrence = "daily" | "weekdays" | "weekly" | "monthly" | "once";

export type BriefingProjectOption = {
  id: string;
  name: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceScope: "personal" | "team" | "org";
  teamName: string | null;
  chatOptions: Array<{ id: string; title: string }>;
};

export type BriefingScheduleView = {
  id: string;
  title: string;
  enabled: boolean;
  recurrence: BriefingRecurrence;
  timeZone: string;
  localTime: string;
  weekdays: number[];
  monthDay: number | null;
  runOnceAt: string | null;
  reportingWindowHours: number;
  promptInstructions: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string | null;
  chatId: string | null;
  chatTitle: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

export type BriefingScheduleInput = {
  id?: string | null;
  title: string;
  enabled: boolean;
  recurrence: BriefingRecurrence;
  timeZone: string;
  localTime: string;
  weekdays: number[];
  monthDay?: number | null;
  runOnceAt?: string | null;
  reportingWindowHours: number;
  promptInstructions: string;
  projectId: string;
  chatId?: string | null;
  newChatTitle?: string | null;
};

export type BriefingSettingsSummary = {
  projects: BriefingProjectOption[];
  schedules: BriefingScheduleView[];
};

export type BriefingPreviewResult = {
  markdown: string;
  contextXml: string;
  windowStart: string;
  windowEnd: string;
  counts: {
    messages: number;
    tasks: number;
    asanaTasks: number;
    riskSignals: number;
    risks: number;
    modifiedArtifacts: number;
  };
  project: {
    id: string;
    name: string;
    workspaceId: string;
    workspaceName: string;
    status: string;
  };
};

export const getBriefingSettingsSummary = createServerFn({ method: "GET" }).handler(async (): Promise<BriefingSettingsSummary> => {
  const { getBriefingSettingsSummaryForCurrentUser } = await import("@/lib/briefing-schedules.server");
  return getBriefingSettingsSummaryForCurrentUser();
});

export const saveBriefingSchedule = createServerFn({ method: "POST" })
  .validator((data: BriefingScheduleInput) => data)
  .handler(async ({ data }): Promise<BriefingScheduleView> => {
    const { saveBriefingScheduleForCurrentUser } = await import("@/lib/briefing-schedules.server");
    return saveBriefingScheduleForCurrentUser(data);
  });

export const deleteBriefingSchedule = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { deleteBriefingScheduleForCurrentUser } = await import("@/lib/briefing-schedules.server");
    return deleteBriefingScheduleForCurrentUser(data.id);
  });

export const testBriefingSchedule = createServerFn({ method: "POST" })
  .validator((data: BriefingScheduleInput) => data)
  .handler(async ({ data }): Promise<BriefingPreviewResult> => {
    const { testBriefingScheduleForCurrentUser } = await import("@/lib/briefing-schedules.server");
    return testBriefingScheduleForCurrentUser(data);
  });
