import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Check, UsersRound } from "lucide-react";
import { AuthenticatedAppRail } from "@/components/AuthenticatedAppRail";
import { VertexAIBrand } from "@/components/VertexAIBrand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptScopedInvite, listMyScopedInvites } from "@/lib/team-workflow";
import { getSession } from "@/lib/auth-workflow";

export const Route = createFileRoute("/profile/invites")({
  loader: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Invites | VertexAI" }],
  }),
  component: InvitesPage,
});

const invitesQueryKey = ["profile", "scoped-invites"] as const;

function InvitesPage() {
  const { session } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const invitesQuery = useQuery({
    queryKey: invitesQueryKey,
    queryFn: () => listMyScopedInvites(),
    refetchInterval: 10_000,
  });
  const acceptMutation = useMutation({
    mutationFn: (inviteId: string) => acceptScopedInvite({ data: { inviteId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
    },
  });

  const invites = invitesQuery.data ?? [];
  const teamInvites = invites.filter((invite) => invite.scope === "team");
  const projectInvites = invites.filter((invite) => invite.scope === "project");

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <AuthenticatedAppRail session={session} />
        <section className="scrollbar-thin min-h-0 overflow-auto bg-muted/30 p-4 lg:p-6">
          <div className="mx-auto grid max-w-4xl gap-4">
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => (window.location.href = "/profile")}>
                Back to Settings
              </Button>
              <VertexAIBrand />
            </div>

            <InviteSection
              title="Team Invites"
              description="Teams you have been invited to join."
              invites={teamInvites}
              pendingId={acceptMutation.variables}
              onAccept={(id) => acceptMutation.mutate(id)}
            />
            <InviteSection
              title="Project Invites"
              description="Projects assigned directly to you."
              invites={projectInvites}
              pendingId={acceptMutation.variables}
              onAccept={(id) => acceptMutation.mutate(id)}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function InviteSection({
  description,
  invites,
  pendingId,
  title,
  onAccept,
}: {
  description: string;
  invites: Awaited<ReturnType<typeof listMyScopedInvites>>;
  pendingId?: string;
  title: string;
  onAccept: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
            <UsersRound className="size-5" />
          </span>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {invites.length === 0 ? <p className="text-sm text-muted-foreground">No invites.</p> : null}
        {invites.map((invite) => (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3" key={invite.id}>
            <div>
              <p className="font-medium">{invite.targetName}</p>
              <p className="text-xs text-muted-foreground">
                {invite.status} / {invite.createdLabel}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={invite.status !== "Pending" || pendingId === invite.id}
              onClick={() => onAccept(invite.id)}
            >
              <Check className="size-4" />
              Accept
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
