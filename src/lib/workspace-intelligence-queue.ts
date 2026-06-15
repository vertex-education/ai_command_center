/// <reference path="../../worker-configuration.d.ts" />

import { runTrackedAiGateway } from "@/lib/ai-gateway";
import {
  isWorkspaceIntelligenceJob,
  type WorkspaceIdeaEvaluationJob,
  type WorkspaceIntelligenceJob,
  type WorkspaceTaskExtractionJob,
} from "@/lib/workspace-intelligence-types";

const taskExtractionModelId = "@cf/google/gemma-4-26b-a4b-it";
const maxTaskExtractionRows = 10;
const maxConsumerAttempts = 3;

export type WorkspaceIntelligenceEnv = Env & {
  AI: Ai;
  DB: D1Database;
  WORKSPACE_INTELLIGENCE_QUEUE?: Queue<WorkspaceIntelligenceJob>;
};

export type ExtractedTaskCandidate = {
  taskDescription: string;
  confidenceScore: number;
};

export async function publishWorkspaceIntelligenceJob(env: WorkspaceIntelligenceEnv, job: WorkspaceIntelligenceJob) {
  if (!isWorkspaceIntelligenceJob(job)) throw new Error("Invalid workspace intelligence payload.");
  if (!env.WORKSPACE_INTELLIGENCE_QUEUE) {
    console.warn("[WorkspaceIntelligence] WORKSPACE_INTELLIGENCE_QUEUE is not configured; skipping background job.", {
      kind: job.kind,
      requestId: job.requestId,
    });
    return false;
  }

  await env.WORKSPACE_INTELLIGENCE_QUEUE.send(job, { contentType: "json" });
  return true;
}

export async function handleWorkspaceIntelligenceQueue(batch: MessageBatch<WorkspaceIntelligenceJob>, env: WorkspaceIntelligenceEnv) {
  for (const message of batch.messages) {
    const job = message.body;
    if (!isWorkspaceIntelligenceJob(job)) {
      console.warn("Discarding invalid workspace intelligence payload.", { messageId: message.id });
      message.ack();
      continue;
    }

    try {
      await processWorkspaceIntelligenceJob(env, job);
      message.ack();
    } catch (error) {
      console.error("Workspace intelligence queue job failed.", {
        attempt: message.attempts,
        error: error instanceof Error ? error.message : "Unknown workspace intelligence failure",
        kind: job.kind,
        requestId: job.requestId,
      });
      if (message.attempts >= maxConsumerAttempts) {
        message.ack();
      } else {
        message.retry({ delaySeconds: Math.min(60, message.attempts * message.attempts * 10) });
      }
    }
  }
}

export async function processWorkspaceIntelligenceJob(env: WorkspaceIntelligenceEnv, job: WorkspaceIntelligenceJob) {
  if (job.kind === "workspace-task-extraction") {
    await processTaskExtractionJob(env, job);
    return;
  }

  await processIdeaEvaluationJob(env, job);
}

export function parseStrictJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const parsed = JSON.parse(fenced ?? trimmed) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Expected a strict JSON array.");
  return parsed;
}

export function normalizeExtractedTasks(text: string): ExtractedTaskCandidate[] {
  return parseStrictJsonArray(text)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const taskDescription =
        typeof record.task_description === "string"
          ? record.task_description
          : typeof record.taskDescription === "string"
            ? record.taskDescription
            : "";
      const confidenceValue = record.confidence_score ?? record.confidenceScore;
      const confidenceScore = typeof confidenceValue === "number" ? confidenceValue : Number(confidenceValue);
      const normalizedDescription = taskDescription.replace(/\s+/g, " ").trim();
      if (!normalizedDescription || !Number.isFinite(confidenceScore)) return null;
      return {
        taskDescription: normalizedDescription.slice(0, 1_000),
        confidenceScore: Math.max(0, Math.min(1, confidenceScore)),
      };
    })
    .filter((item): item is ExtractedTaskCandidate => Boolean(item))
    .slice(0, maxTaskExtractionRows);
}

async function processTaskExtractionJob(env: WorkspaceIntelligenceEnv, job: WorkspaceTaskExtractionJob) {
  const result = await runTrackedAiGateway(
    env.AI,
    taskExtractionModelId,
    {
      messages: [
        {
          role: "system",
          content: [
            "Extract concrete follow-up tasks from the user message.",
            "Return only a strict JSON array. No markdown, prose, or comments.",
            'Each item must be {"task_description":"...", "confidence_score":0.0}.',
            "Use confidence_score from 0 to 1. Return [] when no task is explicit.",
          ].join(" "),
        },
        { role: "user", content: job.prompt.slice(0, 6_000) },
      ],
      max_completion_tokens: 600,
      temperature: 0,
    },
    {
      feature: "workspace-task-extraction-queue",
      usageDb: env.DB,
      teamId: job.teamId,
      projectId: job.projectId,
      identity: {
        userId: job.userId ?? "system",
        workspaceId: job.workspaceId,
        teamId: job.teamId,
        projectId: job.projectId,
        scopeType: "workspace-intelligence",
      },
      metadata: {
        feature: "workspace-task-extraction",
        model: taskExtractionModelId,
        requestId: job.requestId,
        workspaceId: job.workspaceId,
      },
    },
  );

  const tasks = normalizeExtractedTasks(extractGeneratedText(result));
  if (tasks.length === 0) return;

  const sourceMessageId = await existingChatMessageId(env.DB, job.sourceMessageId);
  await env.DB.batch(
    tasks.map((task) =>
      env.DB.prepare(
        `INSERT INTO extracted_tasks (
          id,
          workspace_id,
          source_message_id,
          task_description,
          confidence_score,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        `extracted-task-${crypto.randomUUID()}`,
        job.workspaceId,
        sourceMessageId,
        task.taskDescription,
        task.confidenceScore,
        Date.now(),
      ),
    ),
  );
}

async function processIdeaEvaluationJob(env: WorkspaceIntelligenceEnv, job: WorkspaceIdeaEvaluationJob) {
  const { evaluateIdeaMultiAgent } = await import("@/lib/rag");
  const risk = await evaluateIdeaMultiAgent(
    {
      ideaId: job.ideaId,
      ideaText: job.ideaText,
      projectId: job.projectId,
      workspaceId: job.workspaceId,
      userId: job.userId,
    },
    env,
  );

  if (!risk) return;

  await env.DB.prepare(
    `INSERT INTO project_risks (
      id,
      project_id,
      risk_category,
      severity_level,
      mitigation_suggestion,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `project-risk-${crypto.randomUUID()}`,
      job.projectId,
      risk.riskCategory,
      risk.severityLevel,
      risk.mitigationSuggestion,
      Date.now(),
    )
    .run();
}

async function existingChatMessageId(db: D1Database, sourceMessageId: string | null) {
  if (!sourceMessageId) return null;
  const row = await db.prepare("SELECT id FROM chat_messages WHERE id = ? LIMIT 1").bind(sourceMessageId).first<{ id: string }>();
  return row?.id ?? null;
}

function extractGeneratedText(result: unknown) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  for (const key of ["response", "text", "output_text"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  const choices = record.choices;
  if (!Array.isArray(choices)) return "";
  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") return "";
      const message = (choice as Record<string, unknown>).message;
      if (!message || typeof message !== "object") return "";
      const content = (message as Record<string, unknown>).content;
      return typeof content === "string" ? content : "";
    })
    .join("\n")
    .trim();
}
