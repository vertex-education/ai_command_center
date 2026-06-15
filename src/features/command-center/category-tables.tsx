import { useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type Approval,
  type Artifact,
  type Decision,
  type Idea,
  type RailName,
  type Risk,
  type ScopedWorkspaceState,
  type Task,
  type WorkspaceMode,
  getConversationKey,
  promptTemplates,
  workspaceModeLabel,
} from "@/lib/pmo-data";
import { SectionHeader } from "./layout";
import { DataTable, ScoreCell, SeverityBadge, StatusBadge } from "./common";
import { RiskView } from "./workflow";

export type ChatTableRow = {
  id: string;
  title: string;
  scope: string;
  project: string;
  section: "Project" | "Standalone";
  messages: number;
  description: string;
};

export type PromptTableRow = {
  id: string;
  scope: string;
  title: string;
  prompt: string;
};

export function CategoryTablePage({
  activeMode,
  canEdit,
  generatingRiskId,
  rail,
  selectedRiskId,
  workspace,
  onGenerateRiskMitigation,
  onPreviewRisk,
  onSelectRisk,
  onUsePrompt,
}: {
  activeMode: WorkspaceMode;
  canEdit: boolean;
  generatingRiskId?: string | null;
  rail: Exclude<RailName, "Workspaces">;
  selectedRiskId?: string | null;
  workspace: ScopedWorkspaceState;
  onGenerateRiskMitigation: (risk: Risk) => void;
  onPreviewRisk: (risk: Risk) => void;
  onSelectRisk: (risk: Risk) => void;
  onUsePrompt: (prompt: string) => void;
}) {
  const scopeLabel = workspaceModeLabel(activeMode);
  const [riskSearchTerm, setRiskSearchTerm] = useState("");

  if (rail === "Risks") {
    return (
      <section className="scrollbar-thin min-h-0 overflow-auto p-4 lg:p-6">
        <RiskView
          canEdit={canEdit}
          generatingRiskId={generatingRiskId}
          projects={workspace.projects}
          risks={workspace.risks}
          scopeLabel={scopeLabel}
          searchTerm={riskSearchTerm}
          selectedRiskId={selectedRiskId}
          onGenerateMitigation={onGenerateRiskMitigation}
          onPreview={onPreviewRisk}
          onSearchTerm={setRiskSearchTerm}
          onSelect={onSelectRisk}
        />
      </section>
    );
  }

  return (
    <section className="scrollbar-thin min-h-0 overflow-auto p-4 lg:p-6">
      <SectionHeader
        eyebrow={scopeLabel}
        title={rail}
        description={rail === "Chats" ? "Project chats and general chats for this scope." : `${rail} scoped to ${scopeLabel}.`}
      />
      {rail === "Chats" ? <ChatsTable workspace={workspace} scopeLabel={scopeLabel} /> : null}
      {rail === "Ideas" ? <IdeasTable ideas={workspace.ideas} /> : null}
      {rail === "Artifacts" ? <ArtifactsTable artifacts={workspace.artifacts} /> : null}
      {rail === "Decisions" ? <DecisionsTable decisions={workspace.decisions} /> : null}
      {rail === "Approvals" ? <ApprovalsTable approvals={workspace.approvals} /> : null}
      {rail === "Tasks" ? <TasksTable tasks={workspace.tasks} /> : null}
      {rail === "Prompts" ? <PromptsTable canEdit={canEdit} scopeLabel={scopeLabel} onUsePrompt={onUsePrompt} /> : null}
    </section>
  );
}

export function ChatsTable({ scopeLabel, workspace }: { scopeLabel: string; workspace: ScopedWorkspaceState }) {
  const data = useMemo<ChatTableRow[]>(() => {
    const standaloneRows = workspace.workspaceChats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      scope: scopeLabel,
      project: "None",
      section: "Standalone" as const,
      messages: workspace.conversations[getConversationKey(workspace.mode, null, chat.id)]?.length ?? 0,
      description: chat.description,
    }));
    const projectRows = workspace.projects.flatMap((project) =>
      project.projectChats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        scope: scopeLabel,
        project: project.name,
        section: "Project" as const,
        messages: workspace.conversations[getConversationKey(workspace.mode, project.id, chat.id)]?.length ?? 0,
        description: chat.description,
      })),
    );
    return [...projectRows, ...standaloneRows];
  }, [scopeLabel, workspace]);

  const columns = useMemo<ColumnDef<ChatTableRow>[]>(
    () => [
      { accessorKey: "title", header: "Chat" },
      {
        accessorKey: "section",
        header: "Type",
        cell: ({ row }) => <Badge variant={row.original.section === "Project" ? "info" : "secondary"}>{row.original.section}</Badge>,
      },
      { accessorKey: "project", header: "Project" },
      { accessorKey: "messages", header: "Messages" },
      { accessorKey: "description", header: "Description" },
    ],
    [],
  );

  return <DataTable columns={columns} data={data} getRowId={(row) => row.id} />;
}

export function IdeasTable({ ideas }: { ideas: Idea[] }) {
  const columns = useMemo<ColumnDef<Idea>[]>(
    () => [
      { accessorKey: "title", header: "Idea" },
      { accessorKey: "category", header: "Category" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "votes", header: "Votes" },
      { accessorKey: "impact", header: "Impact", cell: ({ row }) => <ScoreCell value={row.original.impact} /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return <DataTable columns={columns} data={ideas} getRowId={(idea) => idea.id} />;
}

export function ArtifactsTable({ artifacts }: { artifacts: Artifact[] }) {
  const columns = useMemo<ColumnDef<Artifact>[]>(
    () => [
      { accessorKey: "title", header: "Artifact" },
      { accessorKey: "type", header: "Type" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "date", header: "Date" },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "r2Key", header: "R2 key" },
    ],
    [],
  );

  return <DataTable columns={columns} data={artifacts} getRowId={(artifact) => artifact.title} />;
}

export function DecisionsTable({ decisions }: { decisions: Decision[] }) {
  const columns = useMemo<ColumnDef<Decision>[]>(
    () => [
      { accessorKey: "title", header: "Decision" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "due", header: "Due" },
      { accessorKey: "status", header: "Status" },
    ],
    [],
  );

  return <DataTable columns={columns} data={decisions} getRowId={(decision) => decision.id} />;
}

export function ApprovalsTable({ approvals }: { approvals: Approval[] }) {
  const columns = useMemo<ColumnDef<Approval>[]>(
    () => [
      { accessorKey: "title", header: "Approval" },
      { accessorKey: "owner", header: "Approver" },
      { accessorKey: "due", header: "Due" },
      { accessorKey: "status", header: "Status" },
    ],
    [],
  );

  return <DataTable columns={columns} data={approvals} getRowId={(approval) => approval.id} />;
}

export function TasksTable({ tasks }: { tasks: Task[] }) {
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      { accessorKey: "title", header: "Task" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "source", header: "Source" },
      {
        accessorKey: "asanaTaskGid",
        header: "Asana Task",
        cell: ({ row }) => (row.original.clientStatus === "pending" ? <Badge variant="warning">Pending</Badge> : row.original.asanaTaskGid),
      },
    ],
    [],
  );

  return <DataTable columns={columns} data={tasks} getRowId={(task) => task.id} />;
}

export function RisksTable({ risks }: { risks: Risk[] }) {
  const columns = useMemo<ColumnDef<Risk>[]>(
    () => [
      { accessorKey: "title", header: "Risk" },
      { accessorKey: "description", header: "Description" },
      { accessorKey: "severity", header: "Severity", cell: ({ row }) => <SeverityBadge severity={row.original.severity} /> },
      { accessorKey: "status", header: "Status" },
      {
        accessorKey: "mitigationStrategy",
        header: "Mitigation",
        cell: ({ row }) => (row.original.mitigationStrategy ? "Drafted" : "Not drafted"),
      },
    ],
    [],
  );

  return <DataTable columns={columns} data={risks} getRowId={(risk) => risk.id} />;
}

export function PromptsTable({
  canEdit,
  onUsePrompt,
  scopeLabel,
}: {
  canEdit: boolean;
  onUsePrompt: (prompt: string) => void;
  scopeLabel: string;
}) {
  const data = useMemo<PromptTableRow[]>(
    () =>
      promptTemplates.map((prompt, index) => ({
        id: `${scopeLabel.toLowerCase()}-prompt-${index + 1}`,
        scope: scopeLabel,
        title: `Prompt ${index + 1}`,
        prompt,
      })),
    [scopeLabel],
  );
  const columns = useMemo<ColumnDef<PromptTableRow>[]>(
    () => [
      { accessorKey: "title", header: "Prompt" },
      { accessorKey: "scope", header: "Scope" },
      { accessorKey: "prompt", header: "Text" },
      {
        id: "action",
        header: "",
        cell: ({ row }) => (
          <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={() => onUsePrompt(row.original.prompt)}>
            Use
          </Button>
        ),
      },
    ],
    [canEdit, onUsePrompt],
  );

  return <DataTable columns={columns} data={data} getRowId={(prompt) => prompt.id} />;
}
