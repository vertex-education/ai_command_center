import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { AppRail } from "@/components/AppRail";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { getSessionSnapshot } from "@/lib/auth-workflow";

export const Route = createFileRoute("/profile/password")({
  loader: async () => {
    const session = await getSessionSnapshot();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Reset password | Vertex AI Command Center" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setShowPasswords(false);
  }, []);

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match.");
      return;
    }

    setIsPending(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });

      if (error) {
        setMessage(error.message || "Password could not be reset.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password reset. Other sessions were signed out.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password could not be reset.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <AppRail />
        <section className="grid min-h-0 place-items-center overflow-auto bg-muted/30 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <img className="mb-3 h-10 w-fit" src="/vertex-horizontal.svg" alt="Vertex Education" />
              <CardTitle>Reset password</CardTitle>
              <CardDescription>Enter your current password and choose a new one.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <form className="space-y-4" onSubmit={handleResetPassword}>
                <PasswordField
                  id="current-password"
                  label="Current password"
                  autoComplete="current-password"
                  showPassword={showPasswords}
                  value={currentPassword}
                  onChange={setCurrentPassword}
                />
                <PasswordField
                  id="new-password"
                  label="New password"
                  autoComplete="new-password"
                  showPassword={showPasswords}
                  value={newPassword}
                  onChange={setNewPassword}
                />
                <PasswordField
                  id="confirm-password"
                  label="Confirm new password"
                  autoComplete="new-password"
                  showPassword={showPasswords}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                />
                <Button type="button" variant="outline" className="w-full" onClick={() => setShowPasswords((value) => !value)}>
                  {showPasswords ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  {showPasswords ? "Hide passwords" : "Show passwords"}
                </Button>
                <Button className="w-full" type="submit" disabled={isPending}>
                  {isPending ? "Resetting..." : "Reset password"}
                </Button>
              </form>

              {message ? <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">{message}</p> : null}

              <Button className="w-full" type="button" variant="ghost" onClick={() => (window.location.href = "/profile")}>
                Return to settings
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function PasswordField({
  autoComplete,
  id,
  label,
  showPassword,
  value,
  onChange,
}: {
  autoComplete: string;
  id: string;
  label: string;
  showPassword: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoComplete={autoComplete}
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
