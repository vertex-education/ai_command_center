import { createFileRoute } from "@tanstack/react-router";
import { createScopedRagStreamResponse, type ChatWithScopedRagInput } from "@/lib/rag";

async function handleScopedRagStream({ request }: { request: Request }) {
  const url = new URL(request.url);
  const input: ChatWithScopedRagInput = {
    prompt: url.searchParams.get("prompt") ?? "",
    teamId: url.searchParams.get("teamId") ?? "",
    workspaceId: url.searchParams.get("workspaceId") ?? "",
    projectId: url.searchParams.get("projectId") ?? "",
    chatId: url.searchParams.get("chatId") ?? "",
    asanaSearchEnabled: url.searchParams.get("asanaSearchEnabled") === "1",
    reasoningLevel: normalizeReasoningLevel(url.searchParams.get("reasoningLevel")),
    webSearchEnabled: url.searchParams.get("webSearchEnabled") === "1",
  };

  try {
    return await createScopedRagStreamResponse(input);
  } catch (error) {
    return createScopedRagErrorResponse(error instanceof Error ? error.message : "Scoped RAG stream failed.");
  }
}

function normalizeReasoningLevel(value: string | null) {
  return value === "medium" || value === "high" ? value : "low";
}

function createScopedRagErrorResponse(message: string) {
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
      "Connection": "keep-alive",
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
