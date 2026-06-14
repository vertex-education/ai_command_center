import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { CalendarClock, Gauge, Inbox, KeyRound, PlayCircle, Plug, ShieldCheck, UserRound } from "lucide-react";
import { AuthenticatedAppRail } from "@/components/AuthenticatedAppRail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionSnapshot } from "@/lib/auth-workflow";

export const Route = createFileRoute("/profile/")({
  loader: async () => {
    const session = await getSessionSnapshot();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "User profile | Vertex AI Command Center" }],
  }),
  component: UserProfilePage,
});

function UserProfilePage() {
  const { session } = Route.useLoaderData();
  const displayName = session.user.name || session.user.email;
  const [showTokenUsage, setShowTokenUsage] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("vertex-show-token-usage") !== "0";
  });

  useEffect(() => {
    window.localStorage.setItem("vertex-show-token-usage", showTokenUsage ? "1" : "0");
  }, [showTokenUsage]);

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <AuthenticatedAppRail session={session} />
        <section className="scrollbar-thin min-h-0 overflow-auto bg-muted/30 p-4 lg:p-6">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => (window.location.href = "/")}>
                Back
              </Button>
              <img className="h-9 w-fit" src="/vertex-horizontal.svg" alt="Vertex Education" />
            </div>

            <Card>
              <CardHeader>
                <div className="mb-2 grid size-12 place-items-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
                  {getInitials(displayName)}
                </div>
                <CardTitle>User settings</CardTitle>
                <CardDescription>Manage your account details, password, invites, integrations, and personal display preferences.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="space-y-3 rounded-md border bg-background p-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Name</p>
                      <p className="font-medium">{displayName}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Email</p>
                      <p className="font-medium">{session.user.email}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Role</p>
                      <Badge variant="secondary">{session.user.role}</Badge>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Email verification</p>
                      <Badge variant={session.user.emailVerified ? "default" : "secondary"}>
                        {session.user.emailVerified ? "Verified" : "Not verified"}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Button className="w-full justify-start" type="button" variant="outline" onClick={() => relaunchTutorial()}>
                      <PlayCircle className="size-4" />
                      Relaunch tutorial
                    </Button>
                    <Button className="w-full justify-start" type="button" variant="outline" onClick={() => (window.location.href = "/profile/password")}>
                      <KeyRound className="size-4" />
                      Reset password
                    </Button>
                    <Button className="w-full justify-start" type="button" variant="outline" onClick={() => (window.location.href = "/profile/invites")}>
                      <Inbox className="size-4" />
                      Invites
                    </Button>
                    <Button className="w-full justify-start" type="button" variant="outline" onClick={() => (window.location.href = "/profile/asana")}>
                      <Plug className="size-4" />
                      Asana integration
                    </Button>
                    <Button className="w-full justify-start" type="button" variant="outline" onClick={() => (window.location.href = "/profile/briefings")}>
                      <CalendarClock className="size-4" />
                      Automated briefings
                    </Button>
                    {session.user.role === "admin" ? (
                      <Button className="w-full justify-start" type="button" variant="outline" onClick={() => (window.location.href = "/admin")}>
                        <ShieldCheck className="size-4" />
                        Admin
                      </Button>
                    ) : null}
                    <Button className="w-full justify-start" type="button" variant="outline" disabled>
                      <UserRound className="size-4" />
                      More settings coming soon
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <Gauge className="mt-0.5 size-5 text-primary" />
                      <div className="min-w-0">
                        <p className="font-semibold">Show token usage</p>
                        <p className="text-sm text-muted-foreground">Display token estimates, response token badges, and chat budget details.</p>
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <span>{showTokenUsage ? "On" : "Off"}</span>
                      <input
                        className="sr-only"
                        type="checkbox"
                        checked={showTokenUsage}
                        onChange={(event) => setShowTokenUsage(event.target.checked)}
                      />
                      <span className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${showTokenUsage ? "border-primary bg-primary" : "border-input bg-muted"}`}>
                        <span className={`block size-4 rounded-full bg-background shadow-sm transition-transform ${showTokenUsage ? "translate-x-5" : "translate-x-1"}`} />
                      </span>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

function relaunchTutorial() {
  window.sessionStorage.setItem("vertex-onboarding-tutorial-relaunch", "1");
  window.location.href = "/";
}

function getInitials(value: string) {
  return value
    .split(/\s+|@/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
