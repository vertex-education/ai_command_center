import { useEffect, useState } from "react";
import { AppRail, type AppRailItem } from "@/components/AppRail";
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
  const [showTokenUsage, setShowTokenUsage] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("vertex-show-token-usage") !== "0";
  });

  useEffect(() => {
    window.localStorage.setItem("vertex-show-token-usage", showTokenUsage ? "1" : "0");
  }, [showTokenUsage]);

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  function handleStartTutorial() {
    window.sessionStorage.setItem("vertex-onboarding-tutorial-relaunch", "1");
    window.location.href = "/";
  }

  return (
    <AppRail
      account={{
        canAdmin: session.user.role === "admin",
        showTokenUsage,
        userEmail: session.user.email,
        userName: session.user.name,
        onShowTokenUsageChange: setShowTokenUsage,
        onSignOut: handleSignOut,
        onStartTutorial: handleStartTutorial,
      }}
      activeItem={activeItem}
      persist={persist}
    />
  );
}
