import { Outlet, createFileRoute, redirect, useRouterState } from "@tanstack/react-router";
import { Activity, ArrowLeft, BarChart3, UsersRound } from "lucide-react";
import { AuthenticatedAppRail } from "@/components/AuthenticatedAppRail";
import { Button } from "@/components/ui/button";
import { getSessionSnapshot } from "@/lib/auth-workflow";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  loader: async () => {
    const session = await getSessionSnapshot();
    if (!session) throw redirect({ to: "/sign-in" });
    if (session.user.role !== "admin") throw redirect({ to: "/" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Admin | Vertex AI Command Center" }],
  }),
  component: AdminLayout,
});

const adminTabs = [
  { href: "/admin", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: UsersRound },
] as const;

function AdminLayout() {
  const { session } = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <AuthenticatedAppRail session={session} />
        <section className="scrollbar-thin min-h-0 overflow-auto bg-muted/30">
          <div className="sticky top-0 z-20 border-b bg-card/95 px-4 py-3 backdrop-blur lg:px-8">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
                  <Activity className="size-5" />
                </span>
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold">Admin</h1>
                  <p className="text-sm text-muted-foreground">Operational metrics, usage tracking, users, and access controls.</p>
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => (window.location.href = "/")}>
                <ArrowLeft className="size-4" />
                Workspace
              </Button>
            </div>
            <nav className="mx-auto mt-3 flex max-w-7xl gap-2" aria-label="Admin tabs">
              {adminTabs.map(({ href, label, icon: Icon }) => {
                const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
                return (
                  <button
                    key={href}
                    type="button"
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                      active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                    )}
                    onClick={() => (window.location.href = href)}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="mx-auto grid max-w-7xl gap-5 p-4 lg:p-8">
            <Outlet />
          </div>
        </section>
      </div>
    </main>
  );
}
