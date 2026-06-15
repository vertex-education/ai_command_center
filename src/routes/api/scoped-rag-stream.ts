import { createFileRoute } from "@tanstack/react-router";
import { createScopedRagStreamResponse, type ChatWithScopedRagInput } from "@/lib/rag";

async function handleScopedRagStream({ request }: { request: Request }) {
  const input = parseScopedRagStreamInput(request);

  try {
    return await createScopedRagStreamResponse(input);
  } catch (error) {
    return createScopedRagErrorResponse(error instanceof Error ? error.message : "Scoped RAG stream failed.");
  }
}

export function parseScopedRagStreamInput(request: Request): ChatWithScopedRagInput {
  const url = new URL(request.url);
  return {
    prompt: url.searchParams.get("prompt") ?? "",
    teamId: url.searchParams.get("teamId") ?? "",
    workspaceId: url.searchParams.get("workspaceId") ?? "",
    projectId: url.searchParams.get("projectId")?.trim() || null,
    chatId: url.searchParams.get("chatId") ?? "",
    assistantMessageId: url.searchParams.get("assistantMessageId")?.trim() || null,
    asanaSearchEnabled: url.searchParams.get("asanaSearchEnabled") === "1",
    reasoningLevel: normalizeReasoningLevel(url.searchParams.get("reasoningLevel")),
    webSearchEnabled: url.searchParams.get("webSearchEnabled") === "1",
  };
}

export function normalizeReasoningLevel(value: string | null) {
  return value === "medium" || value === "high" ? value : "low";
}

export function createScopedRagErrorResponse(message: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: stream-error\ndata: ${JSON.stringify({ message })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

export const Route = createFileRoute("/api/scoped-rag-stream")({
  server: {
    handlers: {
      GET: handleScopedRagStream,
    },
  },
});
