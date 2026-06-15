import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { VertexAIBrand } from "@/components/VertexAIBrand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { getSession, startMicrosoftSignIn } from "@/lib/auth-workflow";

export const Route = createFileRoute("/sign-in")({
  loader: async () => {
    const session = await getSession();
    if (session) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [{ title: "Sign in | VertexAI" }],
  }),
  component: SignInPage,
});

function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("verified") === "1"
      ? "Email verified. Sign in to continue."
      : typeof window !== "undefined" && new URLSearchParams(window.location.search).get("oauthError") === "1"
        ? "Microsoft sign-in failed. Try again or use your invited account."
        : "",
  );
  const [isPending, setIsPending] = useState(false);
  const [isMicrosoftPending, setIsMicrosoftPending] = useState(false);

  useEffect(() => {
    setShowPassword(false);
  }, []);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setMessage("Signing in...");

    const slowSignInTimer = window.setTimeout(() => {
      setMessage("Still signing in. Cloudflare services can take a few seconds to respond.");
    }, 5000);

    try {
      const { error } = await authClient.signIn.email({
        email,
        password,
        rememberMe: true,
      });

      if (error) {
        setMessage(error.message || "Sign in failed. Verify your email and try again.");
        return;
      }

      setMessage("Signed in. Opening VertexAI...");
      window.setTimeout(() => {
        if (window.location.pathname === "/sign-in") window.location.replace("/");
      }, 750);

      try {
        await router.invalidate();
        await router.navigate({ to: "/", replace: true });
      } catch {
        window.location.replace("/");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed. Try again.");
    } finally {
      window.clearTimeout(slowSignInTimer);
      setIsPending(false);
    }
  }

  async function handleMicrosoftSignIn() {
    setIsMicrosoftPending(true);
    setMessage("Opening Microsoft sign-in...");

    try {
      const { url } = await startMicrosoftSignIn();
      window.location.href = url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Microsoft sign-in failed. Try again.");
      setIsMicrosoftPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <VertexAIBrand className="mb-3" logoClassName="h-10 w-fit" aiClassName="text-[1.75rem]" />
          <CardTitle>VertexAI</CardTitle>
          <CardDescription>Sign in with your invited account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button
            className="w-full"
            type="button"
            variant="outline"
            disabled={isMicrosoftPending || isPending}
            onClick={handleMicrosoftSignIn}
          >
            <LogIn className="mr-2 size-4" />
            {isMicrosoftPending ? "Opening Microsoft..." : "Continue with Microsoft"}
          </Button>

          <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>Email</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-4" onSubmit={handleSignIn}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="flex gap-2">
                <Input
                  id="password"
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
            <Button className="w-full" type="submit" disabled={isPending}>
              {isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          {message ? <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
