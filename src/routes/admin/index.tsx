import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ChevronDown, Gauge, RefreshCw, Server } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getAdminAppHealth,
  getAdminMetricCard,
  getAdminMetricCards,
  getAdminProviderUsage,
  getAdminRecentUsage,
} from "@/lib/admin-metrics";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [{ title: "Admin Dashboard | Vertex AI Command Center" }],
  }),
  component: AdminDashboardPage,
});

const providerChartConfig = {
  requests: {
    label: "Requests",
    color: "oklch(0.35 0.13 257)",
  },
} satisfies ChartConfig;

const tokenChartConfig = {
  totalTokens: {
    label: "Tokens",
    color: "oklch(0.55 0.12 155)",
  },
} satisfies ChartConfig;

const healthChartConfig = {
  value: {
    label: "Records",
    color: "oklch(0.68 0.15 75)",
  },
} satisfies ChartConfig;

const serviceColors = ["oklch(0.35 0.13 257)", "oklch(0.55 0.12 155)", "oklch(0.68 0.15 75)", "oklch(0.58 0.12 250)", "oklch(0.58 0.2 28)"];

type RecentUsageEventView = {
  id: string;
  provider: string;
  feature: string;
  model: string | null;
  teamId?: string | null;
  projectId?: string | null;
  chatId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  aiGatewayLogId?: string | null;
  gatewayStatus: string;
  gatewayCost?: number | null;
  gatewayCostLabel: string;
  totalTokens?: number | null;
  totalTokensLabel: string;
  durationLabel: string;
  createdAt: number;
  createdLabel: string;
};

type UsageGroup = {
  key: string;
  label: string;
  detail: string;
  events: RecentUsageEventView[];
  latestAt: number;
  totalTokens: number;
  totalCost: number | null;
};

function AdminDashboardPage() {
  const metricCardsQuery = useQuery({
    queryKey: ["admin", "metric-cards"],
    queryFn: () => getAdminMetricCards(),
    refetchInterval: 30_000,
  });
  const metricCardQueries = useQueries({
    queries: (metricCardsQuery.data ?? []).map((card) => ({
      queryKey: ["admin", "metric-card", card.id],
      queryFn: () => getAdminMetricCard({ data: { metricId: card.id } }),
      initialData: card,
      refetchInterval: 30_000,
    })),
  });
  const providerUsageQuery = useQuery({
    queryKey: ["admin", "provider-usage"],
    queryFn: () => getAdminProviderUsage(),
    refetchInterval: 30_000,
  });
  const appHealthQuery = useQuery({
    queryKey: ["admin", "app-health"],
    queryFn: () => getAdminAppHealth(),
    refetchInterval: 30_000,
  });
  const recentUsageQuery = useQuery({
    queryKey: ["admin", "recent-usage"],
    queryFn: () => getAdminRecentUsage(),
    refetchInterval: 30_000,
  });
  const metricCards = metricCardQueries.map((query) => query.data).filter(Boolean);
  const providerUsage = providerUsageQuery.data?.providerUsage ?? [];
  const appHealth = appHealthQuery.data?.appHealth;
  const recentUsage = (recentUsageQuery.data?.recentUsage ?? []) as RecentUsageEventView[];
  const usageGroups = groupRecentUsage(recentUsage);
  const generatedAt = providerUsageQuery.data?.generatedAt ?? appHealthQuery.data?.generatedAt ?? recentUsageQuery.data?.generatedAt;

  if (metricCardsQuery.isLoading && providerUsageQuery.isLoading && appHealthQuery.isLoading && recentUsageQuery.isLoading) {
    return <p className="rounded-md border bg-background p-4 text-sm text-muted-foreground">Loading admin metrics...</p>;
  }

  if (metricCardsQuery.isError || providerUsageQuery.isError || appHealthQuery.isError || recentUsageQuery.isError || !appHealth) {
    return <p className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Could not load admin metrics.</p>;
  }

  const requestRows = providerUsage.map((row) => ({
    provider: providerLabel(row.provider),
    requests: row.requests,
  }));
  const tokenRows = providerUsage
    .filter((row) => row.totalTokens !== null || row.inputTokens !== null || row.outputTokens !== null)
    .map((row) => ({
      provider: providerLabel(row.provider),
      totalTokens: row.totalTokens ?? 0,
    }));
  const healthRows = [
    { label: "Users", value: appHealth.totalUsers },
    { label: "Messages", value: appHealth.totalMessages },
    { label: "AI replies", value: appHealth.assistantMessages },
    { label: "Files", value: appHealth.totalStoredFiles },
    { label: "Chunks", value: appHealth.totalDocumentChunks },
    { label: "Events", value: appHealth.recentEvents },
  ];
  const serviceRows = appHealth.configuredServices.map((service) => ({
    name: service.label,
    value: service.configured ? 1 : 1,
    configured: service.configured,
  }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">Live app health and 30-day provider usage. Sections refresh independently{generatedAt ? `; latest refresh ${new Date(generatedAt).toLocaleTimeString()}` : ""}.</p>
        </div>
        <Badge variant="secondary">Primary admin tab</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card, index) => {
          const query = metricCardQueries[index];
          return (
          <Card key={card.id}>
            <CardHeader className="space-y-0 pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardDescription>{card.label}</CardDescription>
                <div className="flex items-center gap-2">
                  <MetricStatusIcon status={card.status} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Refresh ${card.label}`}
                    title={`Refresh ${card.label}`}
                    disabled={query?.isFetching}
                    onClick={() => void query?.refetch()}
                  >
                    <RefreshCw className={`size-3.5 ${query?.isFetching ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <CardTitle className="truncate text-2xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{card.detail}</p>
            </CardContent>
          </Card>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Provider Requests</CardTitle>
            <CardDescription>Tracked usage events by service over the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <SectionRefreshButton isFetching={providerUsageQuery.isFetching} label="Refresh provider requests" onRefresh={() => void providerUsageQuery.refetch()} />
            <ChartContainer config={providerChartConfig} className="h-72 w-full">
              <BarChart data={requestRows} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="provider" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="requests" fill="var(--color-requests)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cloudflare Token Usage</CardTitle>
            <CardDescription>Gemma and Workers AI token totals where the runtime returns usage diagnostics.</CardDescription>
          </CardHeader>
          <CardContent>
            <SectionRefreshButton isFetching={providerUsageQuery.isFetching} label="Refresh token usage" onRefresh={() => void providerUsageQuery.refetch()} />
            <ChartContainer config={tokenChartConfig} className="h-72 w-full">
              <BarChart data={tokenRows.length ? tokenRows : [{ provider: "No tracked tokens", totalTokens: 0 }]} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="provider" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={48} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="totalTokens" fill="var(--color-totalTokens)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Storage And Activity</CardTitle>
            <CardDescription>Core app records that indicate operational volume and health.</CardDescription>
          </CardHeader>
          <CardContent>
            <SectionRefreshButton isFetching={appHealthQuery.isFetching} label="Refresh storage and activity" onRefresh={() => void appHealthQuery.refetch()} />
            <ChartContainer config={healthChartConfig} className="h-72 w-full">
              <BarChart data={healthRows} layout="vertical" margin={{ left: 12, right: 24, top: 8, bottom: 8 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={72} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Service Configuration</CardTitle>
            <CardDescription>Runtime bindings and provider keys visible to the Worker.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <SectionRefreshButton isFetching={appHealthQuery.isFetching} label="Refresh service configuration" onRefresh={() => void appHealthQuery.refetch()} />
            <ChartContainer config={{ value: { label: "Services", color: serviceColors[0] } }} className="mx-auto h-48 w-full max-w-72">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie data={serviceRows} dataKey="value" nameKey="name" innerRadius={44} outerRadius={74} paddingAngle={3}>
                  {serviceRows.map((row, index) => (
                    <Cell key={row.name} fill={row.configured ? serviceColors[index % serviceColors.length] : "oklch(0.88 0.018 250)"} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="grid gap-2">
              {appHealth.configuredServices.map((service) => (
                <div key={service.label} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2 text-sm">
                  <span>{service.label}</span>
                  <Badge variant={service.configured ? "default" : "secondary"}>{service.configured ? "Configured" : "Missing"}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Usage Detail</CardTitle>
          <CardDescription>Credits are recorded when provider APIs expose them; otherwise request counts and runtime token diagnostics are tracked.</CardDescription>
        </CardHeader>
        <CardContent>
          <SectionRefreshButton isFetching={providerUsageQuery.isFetching} label="Refresh provider usage detail" onRefresh={() => void providerUsageQuery.refetch()} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Input tokens</TableHead>
                <TableHead className="text-right">Output tokens</TableHead>
                <TableHead className="text-right">Total tokens</TableHead>
                <TableHead className="text-right">Cache</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Avg duration</TableHead>
                <TableHead>Latest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providerUsage.map((row) => (
                <TableRow key={row.provider}>
                  <TableCell className="font-medium">{providerLabel(row.provider)}</TableCell>
                  <TableCell className="text-right">{row.requests.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{row.creditsLabel}</TableCell>
                  <TableCell className="text-right">{row.inputTokensLabel}</TableCell>
                  <TableCell className="text-right">{row.outputTokensLabel}</TableCell>
                  <TableCell className="text-right">{row.totalTokensLabel}</TableCell>
                  <TableCell className="text-right">{row.cacheLabel}</TableCell>
                  <TableCell>{row.successLabel}</TableCell>
                  <TableCell className="text-right">{row.averageDurationLabel}</TableCell>
                  <TableCell>{row.latestLabel}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Usage Events</CardTitle>
          <CardDescription>Consolidated by chat or workflow; expand a group to inspect each inference, naming call, retrieval step, and API tool request.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <SectionRefreshButton isFetching={recentUsageQuery.isFetching} label="Refresh recent usage events" onRefresh={() => void recentUsageQuery.refetch()} />
          {usageGroups.length ? (
            usageGroups.map((group) => (
              <details key={group.key} className="group rounded-md border bg-background">
                <summary className="grid cursor-pointer list-none gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                      <strong className="truncate text-sm">{group.label}</strong>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{group.detail}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground md:justify-end">
                    <Badge variant="secondary">{group.events.length} events</Badge>
                    <span>{formatCompactDateTime(group.latestAt)}</span>
                    <span>{group.totalTokens.toLocaleString()} tokens</span>
                    <span>{group.totalCost === null ? "Cost not tracked" : `$${group.totalCost.toFixed(2)}`}</span>
                  </div>
                </summary>
                <div className="border-t p-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Inference / usage</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Gateway log</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.events.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.createdLabel}</TableCell>
                          <TableCell>{providerLabel(row.provider)}</TableCell>
                          <TableCell>
                            <div className="grid gap-1">
                              <span>{usageFeatureLabel(row.feature)}</span>
                              <span className="text-xs text-muted-foreground">{usageScopeDetail(row)}</span>
                            </div>
                          </TableCell>
                          <TableCell>{row.model ?? "N/A"}</TableCell>
                          <TableCell className="font-mono text-xs">{row.aiGatewayLogId ?? "N/A"}</TableCell>
                          <TableCell>{row.gatewayStatus}</TableCell>
                          <TableCell className="text-right">{row.totalTokensLabel}</TableCell>
                          <TableCell className="text-right">{row.gatewayCostLabel}</TableCell>
                          <TableCell className="text-right">{row.durationLabel}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            ))
          ) : (
            <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">
              No usage events have been recorded yet.
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function groupRecentUsage(events: RecentUsageEventView[]): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();

  for (const event of events) {
    const key = usageGroupKey(event);
    const label = usageGroupLabel(event);
    const detail = usageGroupDetail(event);
    const existing = groups.get(key);
    const eventTokens = typeof event.totalTokens === "number" ? event.totalTokens : 0;
    const eventCost = typeof event.gatewayCost === "number" ? event.gatewayCost : null;

    if (!existing) {
      groups.set(key, {
        key,
        label,
        detail,
        events: [event],
        latestAt: event.createdAt,
        totalTokens: eventTokens,
        totalCost: eventCost,
      });
      continue;
    }

    existing.events.push(event);
    existing.latestAt = Math.max(existing.latestAt, event.createdAt);
    existing.totalTokens += eventTokens;
    existing.totalCost = existing.totalCost === null && eventCost === null
      ? null
      : (existing.totalCost ?? 0) + (eventCost ?? 0);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      events: group.events.sort((left, right) => right.createdAt - left.createdAt),
    }))
    .sort((left, right) => right.latestAt - left.latestAt);
}

function metadataString(event: RecentUsageEventView, key: string) {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function usageGroupKey(event: RecentUsageEventView) {
  if (event.chatId) return `chat:${event.chatId}`;
  if (metadataString(event, "chatId")) return `chat:${metadataString(event, "chatId")}`;
  if (event.projectId) return `project:${event.projectId}`;
  if (event.teamId) return `team:${event.teamId}`;
  const source = metadataString(event, "source");
  return source ? `workflow:${source}` : `event:${event.id}`;
}

function usageGroupLabel(event: RecentUsageEventView) {
  const chatTitle = metadataString(event, "chatTitle");
  if (chatTitle) return `Chat: ${chatTitle}`;
  if (event.chatId) return `Chat: ${event.chatId}`;
  const source = metadataString(event, "source");
  if (source === "chat-web-search") return "Chat web search";
  if (source === "scoped-rag-stream") return "Scoped RAG workflow";
  if (event.projectId) return `Project workflow: ${event.projectId}`;
  if (event.teamId) return `Team workflow: ${event.teamId}`;
  return usageFeatureLabel(event.feature);
}

function usageGroupDetail(event: RecentUsageEventView) {
  const parts = [
    event.projectId ? `Project ${event.projectId}` : null,
    event.teamId ? `Team ${event.teamId}` : null,
    event.chatId ? `Chat ${event.chatId}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Ungrouped provider usage";
}

function usageFeatureLabel(feature: string) {
  return feature
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function usageScopeDetail(event: RecentUsageEventView) {
  const source = metadataString(event, "source");
  const mode = metadataString(event, "mode");
  const details = [
    source ? `Source: ${source}` : null,
    mode ? `Mode: ${mode}` : null,
    event.chatId ? `Chat: ${event.chatId}` : null,
    event.projectId ? `Project: ${event.projectId}` : null,
  ].filter(Boolean);
  return details.join(" / ") || "No scope metadata";
}

function formatCompactDateTime(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function providerLabel(provider: string) {
  if (provider === "cloudflare-workers-ai") return "Workers AI";
  if (provider === "ai-gateway") return "AI Gateway";
  if (provider === "tavily") return "Tavily";
  if (provider === "firecrawl") return "Firecrawl";
  if (provider === "vectorize") return "Vectorize";
  return provider;
}

function SectionRefreshButton({
  isFetching,
  label,
  onRefresh,
}: {
  isFetching: boolean;
  label: string;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-3 flex justify-end">
      <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={onRefresh}>
        <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        Refresh
        <span className="sr-only">{label}</span>
      </Button>
    </div>
  );
}

function MetricStatusIcon({ status }: { status?: "ok" | "watch" | "muted" }) {
  if (status === "watch") return <AlertTriangle className="size-4 text-warning" />;
  if (status === "muted") return <Gauge className="size-4 text-muted-foreground" />;
  if (status === "ok") return <CheckCircle2 className="size-4 text-success" />;
  return <Server className="size-4 text-muted-foreground" />;
}
