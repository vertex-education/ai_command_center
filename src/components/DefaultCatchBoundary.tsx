import {
  ErrorComponent,
  Link,
  useLocation,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useLocation({
    select: (location) => location.pathname === "/",
  });

  console.error(error);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-5 p-6">
      <ErrorComponent error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => router.invalidate()}>
          Try again
        </Button>
        {isRoot ? (
          <Button asChild variant="outline">
            <Link to="/">Home</Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => window.history.back()}>
            Go back
          </Button>
        )}
      </div>
    </main>
  );
}
