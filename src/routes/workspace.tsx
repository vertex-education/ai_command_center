import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-workflow";
import { PMOCommandCenter } from "@/features/command-center/command-center";
import { CommandCenterPageSkeleton } from "@/features/command-center/skeletons";

export const Route = createFileRoute("/workspace")({
  loader: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  pendingComponent: CommandCenterPageSkeleton,
  head: () => ({
    meta: [{ title: "VertexAI" }],
  }),
  component: CommandCenterRoute,
});

function CommandCenterRoute() {
  const { session } = Route.useLoaderData();
  return <PMOCommandCenter session={session} />;
}
