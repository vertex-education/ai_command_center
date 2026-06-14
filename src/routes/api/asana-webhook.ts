import { createFileRoute } from "@tanstack/react-router";
import { handleAsanaWebhookRequest } from "@/lib/asana-webhook";

export const Route = createFileRoute("/api/asana-webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleAsanaWebhookRequest(request),
    },
  },
});
