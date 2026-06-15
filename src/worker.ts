/// <reference path="../worker-configuration.d.ts" />

import serverEntry from "@tanstack/react-start/server-entry";
import { Hono } from "hono";
import { handleAsanaOutboundQueue, isAsanaOutboundJob, type AsanaOutboundEnv, type AsanaOutboundJob } from "./lib/asana-outbound-queue";
import { handleAsanaTaskSyncQueue, isAsanaTaskSyncJob, type AsanaTaskSyncEnv, type AsanaTaskSyncJob } from "./lib/asana-task-sync-queue";
import { handleAsanaWebhookRequest } from "./lib/asana-webhook";
import {
  processMicrosoftGraphWebhookJob,
  type MicrosoftGraphWebhookEnv,
  type MicrosoftGraphWebhookJob,
} from "./lib/microsoft-graph-webhooks";
import { runScheduledTaskEngine } from "./lib/scheduled-tasks";
import { runWithCloudflareExecutionContext } from "./lib/cloudflare-execution-context";
import { runWeeklyAgenticBriefings, shouldRunWeeklyAgenticBriefing, type WeeklyAgenticBriefingEnv } from "./lib/weekly-agentic-briefings";
import { handleWorkspaceIntelligenceQueue, type WorkspaceIntelligenceEnv } from "./lib/workspace-intelligence-queue";
import { isWorkspaceIntelligenceJob, type WorkspaceIntelligenceJob } from "./lib/workspace-intelligence-types";

export { ChatSyncRealtimeDurableObject } from "./lib/chat-sync";

const webhookApp = new Hono<{ Bindings: Env }>();
webhookApp.post("/api/webhooks/asana", (c) => handleAsanaWebhookRequest(c.req.raw, c.env));

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return runWithCloudflareExecutionContext(ctx, () => {
      const url = new URL(request.url);
      if (url.pathname === "/api/webhooks/asana") {
        return webhookApp.fetch(request, env, ctx);
      }

      const requestOptions = {
        context: {
          cloudflare: { env, ctx },
        },
      } as unknown as Parameters<typeof serverEntry.fetch>[1];

      return serverEntry.fetch(request, requestOptions);
    });
  },

  async queue(
    batch: MessageBatch<MicrosoftGraphWebhookJob | AsanaTaskSyncJob | AsanaOutboundJob | WorkspaceIntelligenceJob>,
    env: MicrosoftGraphWebhookEnv & AsanaTaskSyncEnv & AsanaOutboundEnv & WorkspaceIntelligenceEnv,
  ) {
    if (batch.queue === "asana-sync-queue") {
      await handleAsanaTaskSyncQueue(batch as MessageBatch<AsanaTaskSyncJob>, env);
      return;
    }

    if (batch.queue === "asana-outbound-queue") {
      await handleAsanaOutboundQueue(batch as MessageBatch<AsanaOutboundJob>, env);
      return;
    }

    if (batch.queue === "workspace-intelligence-queue") {
      await handleWorkspaceIntelligenceQueue(batch as MessageBatch<WorkspaceIntelligenceJob>, env);
      return;
    }

    for (const message of batch.messages) {
      try {
        const job = message.body;
        if (isAsanaTaskSyncJob(job)) {
          await handleAsanaTaskSyncQueue({ ...batch, messages: [message as Message<AsanaTaskSyncJob>] }, env);
          continue;
        }
        if (isAsanaOutboundJob(job)) {
          await handleAsanaOutboundQueue({ ...batch, messages: [message as Message<AsanaOutboundJob>] }, env);
          continue;
        }
        if (isWorkspaceIntelligenceJob(job)) {
          await handleWorkspaceIntelligenceQueue({ ...batch, messages: [message as Message<WorkspaceIntelligenceJob>] }, env);
          continue;
        }
        if (!isMicrosoftGraphWebhookJob(job)) throw new Error("Unexpected job body in Graph webhook queue.");
        await processMicrosoftGraphWebhookJob(env, job);
        message.ack();
      } catch (error) {
        console.error("Microsoft Graph webhook queue job failed.", {
          error: error instanceof Error ? error.message : "Unknown queue failure",
        });
        message.retry();
      }
    }
  },

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    await runScheduledTaskEngine(env, controller.scheduledTime);
    if (shouldRunWeeklyAgenticBriefing((controller as ScheduledController & { cron?: string }).cron)) {
      await runWeeklyAgenticBriefings(env as WeeklyAgenticBriefingEnv, controller.scheduledTime);
    }
  },
};

function isMicrosoftGraphWebhookJob(job: unknown): job is MicrosoftGraphWebhookJob {
  if (!job || typeof job !== "object" || !("kind" in job)) return false;
  return job.kind === "microsoft-graph-change-notification";
}
