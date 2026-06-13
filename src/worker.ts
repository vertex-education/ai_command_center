/// <reference path="../worker-configuration.d.ts" />

import serverEntry from "@tanstack/react-start/server-entry";
import { handleDocumentIngestionQueue, type DocumentIngestionEnv, type DocumentIngestionJob } from "./lib/document-ingestion-queue";

export { ChatSyncDurableObject } from "./lib/chat-sync";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const requestOptions = {
      context: {
        cloudflare: { env, ctx },
      },
    } as unknown as Parameters<typeof serverEntry.fetch>[1];

    return serverEntry.fetch(request, requestOptions);
  },

  queue(batch: MessageBatch<DocumentIngestionJob>, env: DocumentIngestionEnv) {
    return handleDocumentIngestionQueue(batch, env);
  },
};
