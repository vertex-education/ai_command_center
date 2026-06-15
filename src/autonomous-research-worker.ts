/// <reference path="../worker-configuration.d.ts" />

import { handleAutonomousResearchQueue, type AutonomousResearchEnv, type AutonomousResearchJob } from "./lib/autonomous-research-queue";

export default {
  queue(batch: MessageBatch<AutonomousResearchJob>, env: AutonomousResearchEnv) {
    return handleAutonomousResearchQueue(batch, env);
  },
} satisfies ExportedHandler<AutonomousResearchEnv, AutonomousResearchJob>;
