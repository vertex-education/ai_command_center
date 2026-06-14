/// <reference path="../worker-configuration.d.ts" />

import serverEntry from "@tanstack/react-start/server-entry";
import { runDailyProjectBriefings } from "./lib/daily-briefings";
import { handleDocumentIngestionQueue, type DocumentIngestionEnv, type DocumentIngestionJob } from "./lib/document-ingestion-queue";
import { processMicrosoftGraphWebhookJob, type MicrosoftGraphWebhookEnv, type MicrosoftGraphWebhookJob } from "./lib/microsoft-graph-webhooks";

export { ChatSyncDurableObject } from "./lib/chat-sync";

type AppQueueJob = DocumentIngestionJob | MicrosoftGraphWebhookJob;
type AppQueueEnv = DocumentIngestionEnv & MicrosoftGraphWebhookEnv;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const requestOptions = {
      context: {
        cloudflare: { env, ctx },
      },
    } as unknown as Parameters<typeof serverEntry.fetch>[1];

    return serverEntry.fetch(request, requestOptions);
  },

  async queue(batch: MessageBatch<AppQueueJob>, env: AppQueueEnv) {
    if (batch.queue === "graph-webhook-notifications") {
      for (const message of batch.messages) {
        try {
          const job = message.body;
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
      return;
    }

    return handleDocumentIngestionQueue(batch as MessageBatch<DocumentIngestionJob>, env);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyProjectBriefings(env, controller.scheduledTime));
  },
};

function isMicrosoftGraphWebhookJob(job: AppQueueJob): job is MicrosoftGraphWebhookJob {
  return "kind" in job && job.kind === "microsoft-graph-change-notification";
}
