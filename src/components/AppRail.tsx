import { useState, type ComponentType, type ReactNode } from "react";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  FolderOpen,
  KeyRound,
  Lightbulb,
  LogOut,
  MessageCircle,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AppRailItem = "Workspaces" | "Chats" | "Ideas" | "Artifacts" | "Docs";

export type AppRailAccount = {
  canAdmin: boolean;
  showTokenUsage: boolean;
  userEmail: string;
  userName: string;
  onShowTokenUsageChange: (value: boolean) => void;
  onSignOut: () => void;
  onStartTutorial?: () => void;
};

const appRailItems: Array<{ label: AppRailItem; icon: ComponentType<{ className?: string }> }> = [
  { label: "Workspaces", icon: FolderOpen },
  { label: "Chats", icon: MessageCircle },
  { label: "Ideas", icon: Lightbulb },
  { label: "Artifacts", icon: Archive },
  { label: "Docs", icon: BookOpen },
];

function openRailItem(label: AppRailItem) {
  if (label === "Docs") {
    window.location.href = "/docs";
    return;
  }
  window.sessionStorage.setItem("vertex-target-rail", label);
  window.location.href = "/";
}

export function AppRail({
  account,
  activeItem,
  children,
  onRailClick,
  persist,
}: {
  account?: AppRailAccount;
  activeItem?: AppRailItem;
  children?: ReactNode;
  onRailClick?: (label: Extract<AppRailItem, "Workspaces" | "Chats" | "Ideas" | "Artifacts">) => void;
  persist?: boolean;
}) {
  return (
    <aside className={cn(
      "min-h-0 flex-col items-center gap-2 bg-sidebar px-2 py-5 text-sidebar-foreground",
      persist ? "flex" : "hidden lg:flex",
    )}>
      <div className="mb-4 grid size-10 place-items-center rounded-md bg-white">
        <img alt="Vertex" className="size-7" src="/vertex-mountain-blue.svg" />
      </div>
      {appRailItems.map(({ label, icon: Icon }) => {
        const isWorkspaceItem = label === "Workspaces" || label === "Chats" || label === "Ideas" || label === "Artifacts";
        return (
          <button
            key={label}
            aria-label={label}
            className={cn(
              "group relative grid size-12 place-items-center rounded-md text-white/75 transition-colors hover:bg-white/15 hover:text-white",
              activeItem === label && "bg-white/15 text-white",
            )}
            type="button"
            onClick={() => {
              if (isWorkspaceItem && onRailClick) {
                onRailClick(label);
                return;
              }
              openRailItem(label);
            }}
          >
            <Icon className="size-5" />
            <span className="pointer-events-none absolute left-[calc(100%+10px)] z-50 rounded-md border border-white/15 bg-sidebar px-2 py-1 text-xs font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {label}
            </span>
          </button>
        );
      })}
      <div className="flex-1" />
      {account ? <AppRailAccountMenu account={account} /> : null}
      {children}
    </aside>
  );
}

function AppRailAccountMenu({ account }: { account: AppRailAccount }) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = account.userName || account.userEmail;
  const userInitials = initials(displayName || account.userEmail);

  function runMenuAction(action: () => void) {
    setIsOpen(false);
    action();
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="grid size-10 place-items-center rounded-full border border-white/30 bg-white/10 text-sm font-semibold text-white transition-colors hover:bg-white/20"
        aria-haspopup="menu"
        aria-label="Open user menu"
        title={account.userEmail}
        onClick={() => setIsOpen((value) => !value)}
      >
        {userInitials}
      </button>

      {isOpen ? (
        <div
          className="absolute bottom-0 left-[calc(100%+12px)] z-50 w-72 rounded-md border bg-popover p-2 text-popover-foreground shadow-lg"
          role="menu"
        >
          <div className="mb-2 flex items-center gap-3 rounded-md bg-muted/60 p-3">
            <div className="grid size-10 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {userInitials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{account.userEmail}</p>
            </div>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => runMenuAction(() => (window.location.href = "/profile"))}
          >
            <UserRound className="size-4" />
            User settings
          </button>
          {account.onStartTutorial ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              role="menuitem"
              onClick={() => runMenuAction(account.onStartTutorial ?? (() => undefined))}
            >
              <CheckCircle2 className="size-4" />
              Relaunch tutorial
            </button>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => runMenuAction(() => (window.location.href = "/profile/password"))}
          >
            <KeyRound className="size-4" />
            Reset password
          </button>
          {account.canAdmin ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              role="menuitem"
              onClick={() => runMenuAction(() => (window.location.href = "/admin/users"))}
            >
              <ShieldCheck className="size-4" />
              Admin
            </button>
          ) : null}
          <div className="my-2 border-t" />
          <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent">
            <span className="flex items-center gap-2">
              <Zap className="size-4" />
              Show token usage
            </span>
            <input
              checked={account.showTokenUsage}
              className="sr-only"
              type="checkbox"
              onChange={(event) => account.onShowTokenUsageChange(event.target.checked)}
            />
            <span
              className={cn(
                "flex h-5 w-9 items-center rounded-full border p-0.5 transition-colors",
                account.showTokenUsage ? "border-primary bg-primary" : "border-input bg-muted",
              )}
            >
              <span
                className={cn(
                  "size-3.5 rounded-full bg-background shadow-sm transition-transform",
                  account.showTokenUsage && "translate-x-4",
                )}
              />
            </span>
          </label>
          <div className="my-2 border-t" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
            role="menuitem"
            onClick={() => runMenuAction(account.onSignOut)}
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function initials(value: string) {
  return value
    .split(/\s+|@/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
