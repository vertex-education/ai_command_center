import { AppRail, type AppRailItem } from "@/components/AppRail";
import { isAdminRole } from "@/lib/auth-access-control";
import { authClient } from "@/lib/auth-client";

type RailSession = {
  user: {
    email: string;
    name: string;
    role: string;
  };
};

export function AuthenticatedAppRail({
  activeItem,
  persist,
  session,
}: {
  activeItem?: AppRailItem;
  persist?: boolean;
  session: RailSession;
}) {
  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <AppRail
      account={{
        canAdmin: isAdminRole(session.user.role),
        userEmail: session.user.email,
        userName: session.user.name,
        onSignOut: handleSignOut,
      }}
      activeItem={activeItem}
      persist={persist}
    />
  );
}
