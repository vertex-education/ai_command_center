import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  CalendarCheck2,
  CheckCircle2,
  FileText,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VertexAIBrand } from "@/components/VertexAIBrand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VertexAI | Coming Soon" },
      {
        name: "description",
        content: "VertexAI is a coming workspace for Vertex teams to use AI across projects, documents, decisions, and execution.",
      },
    ],
  }),
  component: VertexAIHomePage,
});

const capabilityCards: Array<{
  title: string;
  body: string;
  icon: LucideIcon;
}> = [
  {
    title: "Project intelligence",
    body: "Bring project notes, files, tasks, and decisions into one working view so teams can see what needs attention.",
    icon: BrainCircuit,
  },
  {
    title: "Guided AI workflows",
    body: "Draft briefs, surface risks, summarize context, and turn team activity into practical next steps.",
    icon: Bot,
  },
  {
    title: "Final artifacts",
    body: "Keep the important documents, decks, spreadsheets, and outputs close to the work that created them.",
    icon: FileText,
  },
];

const previewTiles = [
  { label: "Context checked", value: "Docs, tasks, and chats", icon: SearchCheck },
  { label: "Artifacts ready", value: "Briefs, trackers, decks", icon: Layers3 },
  { label: "Access guarded", value: "Team-aware permissions", icon: ShieldCheck },
];

function VertexAIHomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f8fafb] text-[#24302f]">
      <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <a className="inline-flex rounded-md bg-white px-3 py-2 shadow-sm ring-1 ring-[#C0C3C2]/60" href="/" aria-label="VertexAI home">
          <VertexAIBrand logoClassName="h-8 w-fit" aiClassName="text-[1.35rem] text-[#003865]" />
        </a>
        <nav className="flex items-center gap-2 text-sm font-semibold text-[#404342]" aria-label="Public navigation">
          <a className="hidden rounded-md px-3 py-2 hover:bg-white hover:text-[#003865] sm:inline-flex" href="#mockups">
            Mockups
          </a>
          <a className="hidden rounded-md px-3 py-2 hover:bg-white hover:text-[#003865] sm:inline-flex" href="#soon">
            Coming Soon
          </a>
          <Button asChild className="bg-[#003865] text-white hover:bg-[#003865]/90">
            <a href="/sign-in">
              Sign in
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </nav>
      </header>

      <section className="landing-grid-background relative border-y border-[#C0C3C2]/50">
        <div className="mx-auto grid min-h-[calc(100svh-96px)] max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.1fr)] lg:px-8 lg:py-14">
          <div className="relative z-10 max-w-3xl space-y-7">
            <Badge className="border-[#CBA052]/35 bg-[#CBA052]/15 text-[#003865]" variant="outline">
              Coming Soon
            </Badge>
            <div className="space-y-5">
              <h1 className="font-heading text-5xl font-extrabold leading-none text-[#003865] sm:text-6xl lg:text-7xl">VertexAI</h1>
              <p className="max-w-2xl text-lg leading-8 text-[#404342]">
                VertexAI is a lightweight AI workspace for Vertex teams. It is being built to help teams turn project context, documents,
                meetings, tasks, and decisions into clearer execution.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="bg-[#003865] text-white shadow-lg shadow-[#003865]/20 hover:bg-[#003865]/90">
                <a href="/sign-in">
                  Invited user sign in
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <span className="inline-flex min-h-10 items-center rounded-md border border-[#C0C3C2] bg-white px-4 text-sm font-semibold text-[#707372]">
                Wider access is coming soon.
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {previewTiles.map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-md border border-[#C0C3C2]/70 bg-white/90 p-4 shadow-sm">
                  <Icon className="mb-3 size-5 text-[#003865]" />
                  <p className="text-sm font-bold text-[#003865]">{label}</p>
                  <p className="mt-1 text-sm text-[#707372]">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <HeroMockup />
        </div>
      </section>

      <section id="mockups" className="border-b border-[#C0C3C2]/50 bg-white px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl space-y-3">
            <Badge className="bg-[#003865] text-white">Preview</Badge>
            <h2 className="font-heading text-3xl font-bold text-[#003865] sm:text-4xl">Early workspace mockups</h2>
            <p className="text-base leading-7 text-[#404342]">
              The first release is focused on practical work surfaces: project awareness, AI-assisted follow-through, and durable outputs
              that teams can come back to.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {capabilityCards.map((card, index) => (
              <CapabilityCard key={card.title} {...card} index={index} />
            ))}
          </div>
        </div>
      </section>

      <section id="soon" className="bg-[#003865] px-4 py-14 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(360px,0.55fr)] lg:items-center">
          <div className="space-y-4">
            <Badge className="border-white/25 bg-white/10 text-white" variant="outline">
              Built For Vertex Teams
            </Badge>
            <h2 className="font-heading text-3xl font-bold sm:text-4xl">Coming soon to help teams move from context to action.</h2>
            <p className="max-w-3xl text-base leading-7 text-white/78">
              VertexAI is currently taking shape around real project workflows: collecting the right context, creating useful artifacts, and
              keeping decisions, risks, and next steps visible.
            </p>
          </div>

          <div className="rounded-md border border-white/20 bg-white/8 p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center gap-3 border-b border-white/15 pb-4">
              <span className="grid size-10 place-items-center rounded-md bg-[#CBA052] text-[#003865]">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="font-bold">Launch posture</p>
                <p className="text-sm text-white/68">Private preview now, broader rollout later.</p>
              </div>
            </div>
            <ul className="mt-4 grid gap-3 text-sm text-white/82">
              <SoonItem>Useful before it is broad: focused pilot access for invited users.</SoonItem>
              <SoonItem>Brand-consistent workspace surfaces instead of generic AI chat shells.</SoonItem>
              <SoonItem>Project outputs designed to become reusable team artifacts.</SoonItem>
            </ul>
          </div>
        </div>
      </section>

      <footer className="bg-white px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-sm text-[#707372]">
          <VertexAIBrand logoClassName="h-7 w-fit" aiClassName="text-xl text-[#003865]" />
          <p>VertexAI is coming soon.</p>
        </div>
      </footer>
    </main>
  );
}

function HeroMockup() {
  return (
    <div className="landing-float-slow relative z-10 mx-auto w-full max-w-2xl">
      <div className="landing-flow-line left-4 top-8 hidden lg:block" />
      <div className="landing-flow-line landing-flow-line-delay bottom-18 right-8 hidden lg:block" />
      <div className="overflow-hidden rounded-md border border-[#003865]/15 bg-white shadow-2xl shadow-[#003865]/18">
        <div className="flex items-center justify-between border-b border-[#C0C3C2]/50 bg-[#f8fafb] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[#CBA052]" />
            <span className="size-2.5 rounded-full bg-[#C0C3C2]" />
            <span className="size-2.5 rounded-full bg-[#2DA44A]" />
          </div>
          <span className="text-xs font-bold text-[#707372]">Project Studio</span>
        </div>
        <div className="grid min-h-[430px] bg-white sm:grid-cols-[170px_minmax(0,1fr)]">
          <aside className="hidden border-r border-[#C0C3C2]/45 bg-[#f8fafb] p-4 sm:block">
            <div className="mb-4 h-2 w-24 rounded-full bg-[#003865]/20" />
            {["Workspaces", "Chats", "Ideas", "Artifacts"].map((item, index) => (
              <div
                key={item}
                className={`mb-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${
                  index === 0 ? "bg-[#003865] text-white" : "text-[#707372]"
                }`}
              >
                <span className={`size-2 rounded-full ${index === 0 ? "bg-[#CBA052]" : "bg-[#C0C3C2]"}`} />
                {item}
              </div>
            ))}
          </aside>

          <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            <div className="border-b border-[#C0C3C2]/45 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#707372]">Team workspace</p>
                  <p className="font-heading text-xl font-bold text-[#003865]">Launch readiness</p>
                </div>
                <Badge className="border-[#2DA44A]/30 bg-[#2DA44A]/10 text-[#2DA44A]" variant="outline">
                  Live context
                </Badge>
              </div>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_190px]">
              <div className="min-w-0 space-y-3">
                <MockMessage
                  icon={MessageSquareText}
                  title="What changed this week?"
                  body="3 decisions, 2 risks, and 4 artifact updates need review."
                />
                <MockMessage
                  icon={Sparkles}
                  title="Suggested next step"
                  body="Prepare a short steering update with blockers and owner asks."
                  active
                />
                <div className="rounded-md border border-[#C0C3C2]/55 bg-[#f8fafb] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[#003865]">Generated artifact</p>
                    <CheckCircle2 className="size-4 text-[#2DA44A]" />
                  </div>
                  <div className="landing-pulse-bar mb-2 h-2 rounded-full bg-[#003865]/18" />
                  <div className="landing-pulse-bar landing-pulse-delay h-2 w-3/4 rounded-full bg-[#CBA052]/35" />
                </div>
              </div>

              <div className="grid gap-3">
                <MiniMetric label="Pinned outputs" value="6" icon={FileText} />
                <MiniMetric label="Risks watched" value="4" icon={ShieldCheck} />
                <MiniMetric label="Team actions" value="12" icon={CalendarCheck2} />
              </div>
            </div>

            <div className="border-t border-[#C0C3C2]/45 bg-[#f8fafb] p-4">
              <div className="flex items-center gap-3 rounded-md border border-[#C0C3C2]/55 bg-white px-3 py-2 text-sm text-[#707372]">
                <LockKeyhole className="size-4 text-[#003865]" />
                Private preview workspace
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockMessage({ active, body, icon: Icon, title }: { active?: boolean; body: string; icon: LucideIcon; title: string }) {
  return (
    <div className={`rounded-md border p-3 ${active ? "border-[#CBA052]/55 bg-[#CBA052]/10" : "border-[#C0C3C2]/55 bg-white"}`}>
      <div className="flex gap-3">
        <span
          className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${active ? "bg-[#CBA052] text-[#003865]" : "bg-[#003865] text-white"}`}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#003865]">{title}</p>
          <p className="mt-1 text-sm leading-6 text-[#404342]">{body}</p>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#C0C3C2]/55 bg-white p-3">
      <Icon className="mb-3 size-4 text-[#003865]" />
      <p className="font-heading text-2xl font-bold text-[#003865]">{value}</p>
      <p className="text-xs font-semibold text-[#707372]">{label}</p>
    </div>
  );
}

function CapabilityCard({ body, icon: Icon, index, title }: { body: string; icon: LucideIcon; index: number; title: string }) {
  return (
    <article
      className="landing-rise rounded-md border border-[#C0C3C2]/60 bg-[#f8fafb] p-5 shadow-sm"
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="mb-5 flex items-center justify-between">
        <span className="grid size-11 place-items-center rounded-md bg-[#003865] text-white">
          <Icon className="size-5" />
        </span>
        <span className="text-sm font-bold text-[#CBA052]">0{index + 1}</span>
      </div>
      <h3 className="font-heading text-xl font-bold text-[#003865]">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-[#404342]">{body}</p>
      <div className="mt-5 grid gap-2">
        <span className="h-2 rounded-full bg-[#003865]/12" />
        <span className="h-2 w-4/5 rounded-full bg-[#707372]/18" />
        <span className="h-2 w-3/5 rounded-full bg-[#CBA052]/35" />
      </div>
    </article>
  );
}

function SoonItem({ children }: { children: string }) {
  return (
    <li className="flex gap-3">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#CBA052]" />
      <span>{children}</span>
    </li>
  );
}
