import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AppRail } from "@/components/AppRail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { isAdminRole, roleDisplayName } from "@/lib/auth-access-control";
import { docArticles, docCategories } from "./content";
import { DocsArticlePage } from "./docs-article";
import { DocsMobileNav, DocsSidebarNav } from "./docs-navigation";
import { filterDocCategories } from "./search";

type DocsPageSession = {
  user: {
    email: string;
    name: string;
    role?: string | null;
  };
};

export function DocsPage({ session }: { session: DocsPageSession }) {
  const [activeArticleId, setActiveArticleId] = useState(docArticles[0].id);
  const [searchTerm, setSearchTerm] = useState("");
  const activeArticle = docArticles.find((article) => article.id === activeArticleId) ?? docArticles[0];
  const filteredCategories = useMemo(() => filterDocCategories(docCategories, searchTerm), [searchTerm]);

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full grid-cols-[72px_minmax(0,1fr)] overflow-hidden border bg-card lg:rounded-xl">
        <AppRail
          account={{
            canAdmin: isAdminRole(session.user.role),
            userEmail: session.user.email,
            userName: session.user.name,
            onSignOut: handleSignOut,
          }}
          activeItem="Docs"
          persist
        />
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <DocsHeader role={session.user.role} />

          <div className="grid min-h-0 flex-1 lg:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="hidden min-h-0 border-r bg-card lg:flex lg:flex-col">
              <div className="border-b p-4">
                <DocsSearchField searchTerm={searchTerm} onSearchTermChange={setSearchTerm} />
              </div>
              <nav className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
                <DocsSidebarNav activeArticleId={activeArticle.id} categories={filteredCategories} onSelectArticle={setActiveArticleId} />
              </nav>
            </aside>

            <article className="scrollbar-thin min-h-0 overflow-auto">
              <div className="mx-auto max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
                <div className="mb-5 grid gap-3 lg:hidden">
                  <DocsSearchField searchTerm={searchTerm} onSearchTermChange={setSearchTerm} mobile />
                  <DocsMobileNav activeArticleId={activeArticle.id} categories={filteredCategories} onSelectArticle={setActiveArticleId} />
                </div>

                <DocsArticlePage article={activeArticle} />
              </div>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}

function DocsHeader({ role }: { role?: string | null }) {
  return (
    <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-4 lg:min-h-19.5 lg:px-6">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-primary">Documentation Library</p>
        <h1 className="truncate text-lg font-semibold lg:text-2xl">VertexAI Docs</h1>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{roleDisplayName(role)}</Badge>
        <Button type="button" variant="outline" onClick={() => (window.location.href = "/workspace")}>
          Workspace
        </Button>
      </div>
    </header>
  );
}

function DocsSearchField({
  mobile,
  onSearchTermChange,
  searchTerm,
}: {
  mobile?: boolean;
  onSearchTermChange: (value: string) => void;
  searchTerm: string;
}) {
  return (
    <label className={`flex h-10 items-center gap-2 rounded-md border px-3 text-muted-foreground ${mobile ? "bg-card" : "bg-background"}`}>
      <Search className="size-4" />
      <Input
        className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
        placeholder="Search docs"
        value={searchTerm}
        onChange={(event) => onSearchTermChange(event.target.value)}
      />
    </label>
  );
}
