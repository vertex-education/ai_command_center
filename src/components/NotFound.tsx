import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function NotFound({ children }: { children?: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          {children ?? "The PMO workspace route you requested does not exist."}
        </p>
      </div>
      <Button asChild>
        <Link to="/">Return to workspace</Link>
      </Button>
    </main>
  );
}
