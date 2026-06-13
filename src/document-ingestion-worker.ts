/// <reference path="../worker-configuration.d.ts" />

import { handleDocumentIngestionQueue, type DocumentIngestionEnv, type DocumentIngestionJob } from "./lib/document-ingestion-queue";

export default {
  queue(batch: MessageBatch<DocumentIngestionJob>, env: DocumentIngestionEnv) {
    return handleDocumentIngestionQueue(batch, env);
  },
};
