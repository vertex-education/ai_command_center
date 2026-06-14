import { createFileRoute } from "@tanstack/react-router";
import { handleAsanaOAuthCallback } from "@/lib/asana-integration.server";

export const Route = createFileRoute("/api/asana/oauth/callback")({
  server: {
    handlers: {
      GET: ({ request }) => handleAsanaOAuthCallback(request),
    },
  },
});
