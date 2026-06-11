import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

export type IdeaStatus = "New" | "Review" | "Pilot" | "Approved" | "Implemented" | "Blocked";
export type TabName = "Chat" | "Ideas" | "Artifacts" | "Decisions" | "Approvals" | "Tasks" | "Prompt Templates";
export type RailName = "Workspaces" | "Chats" | "Ideas" | "Artifacts" | "Decisions" | "Approvals" | "Tasks" | "Prompts";
export type WorkspaceMode = "Personal" | "Team" | "Project" | "Team Project";

export type Idea = {
  id: string;
  title: string;
  status: IdeaStatus;
  category: string;
  owner: string;
  avatar: string;
  created: string;
  votes: number;
  impact: number;
  effort: number;
  confidence: number;
  summary: string;
  nextStep: string;
  tags: string[];
  metrics: string[];
  thread: string[];
};

export type ChatMessage = {
  id: string;
  author: string;
  role: "user" | "assistant" | "system";
  avatar?: string;
  time: string;
  text: string;
  artifact?: {
    title: string;
    meta: string;
    type: "doc" | "ppt" | "sheet";
  };
};

export type Artifact = {
  title: string;
  type: string;
  owner: string;
  date: string;
  status: "Final" | "Draft" | "Pinned";
  summary: string;
  href: string;
  preview: string[];
  pinnedTo: WorkspaceMode[];
};

export type Decision = {
  id: string;
  title: string;
  status: "Open" | "Blocked" | "Done";
  owner: string;
  due: string;
};

export type Approval = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: "Needed" | "Requested" | "Approved";
};

export type Task = {
  id: string;
  title: string;
  owner: string;
  source: string;
  status: "Open" | "In progress" | "Done";
};

export type ActivityItem = {
  id: string;
  label: string;
  detail: string;
  time: string;
};

export type PmoWorkspaceState = {
  ideas: Idea[];
  conversations: Record<string, ChatMessage[]>;
  artifacts: Artifact[];
  decisions: Decision[];
  approvals: Approval[];
  tasks: Task[];
  pinnedIdeaIds: string[];
  accessLevel: "Read / Write" | "View only";
  activity: ActivityItem[];
  updatedAt: string;
};

export type AddIdeaInput = {
  title: string;
  category: string;
  status: IdeaStatus;
  impact: "High" | "Medium" | "Low";
  summary: string;
};

export const avatarAlex =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80";
export const avatarJordan =
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80";
export const avatarTaylor =
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=120&q=80";
export const avatarMaya =
  "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=120&q=80";
export const avatarPriya =
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=120&q=80";

export const statusMeta: Record<IdeaStatus, { label: string; tone: "info" | "warning" | "success" | "destructive" | "secondary"; description: string }> = {
  New: {
    label: "New",
    tone: "info",
    description: "Captured and ready for PMO triage.",
  },
  Review: {
    label: "Under review",
    tone: "warning",
    description: "Sizing impact, owner, and governance fit.",
  },
  Pilot: {
    label: "In pilot",
    tone: "info",
    description: "Being tested with a live project team.",
  },
  Approved: {
    label: "Approved",
    tone: "success",
    description: "Ready to add to the rollout backlog.",
  },
  Implemented: {
    label: "Implemented",
    tone: "success",
    description: "Released into the PMO operating model.",
  },
  Blocked: {
    label: "Blocked",
    tone: "destructive",
    description: "Needs a decision, data source, or owner.",
  },
};

export const tabs: TabName[] = ["Chat", "Ideas", "Artifacts", "Decisions", "Approvals", "Tasks", "Prompt Templates"];
export const workspaceModes: WorkspaceMode[] = ["Personal", "Team", "Project", "Team Project"];
export const statusFilters: Array<IdeaStatus | "All"> = ["All", "New", "Review", "Pilot", "Approved", "Implemented", "Blocked"];
export const modelOptions = ["GPT 5.5", "Claude Opus 4.6", "Gemini Flash 3.5"];
export const promptTemplates = [
  "Summarize improvement ideas by impact, effort, and status for Steering Committee.",
  "Draft a concise nudge for owners of decisions older than seven days.",
  "Create a RAID summary from the last five project updates.",
];

export const projectChats: Record<string, string[]> = {
  "Vertex Hub": ["Shared Chat", "Roadmap Planning", "Stakeholder Updates", "Risk & Issues", "Decision Log"],
  "LMS Next Gen": ["LMS Shared Chat", "Vendor Planning", "UAT Issues", "Release Decisions"],
  "Data Migration": ["Migration Command Center", "Field Mapping", "Validation Issues", "Cutover Decisions"],
  "AI Innovation Lab": ["AI Lab Shared Chat", "Pilot Intake", "Governance Review", "Adoption Metrics"],
};

export const workspaceChatSets: Record<WorkspaceMode, { heading: string; chats: string[]; savedHeading: string; saved: string[] }> = {
  Personal: {
    heading: "Chats",
    chats: ["My PMO Assistant", "Meeting Notes", "Follow-up Drafts", "Private Idea Scratchpad"],
    savedHeading: "Saved Chats",
    saved: ["My Weekly Summary", "Personal Action Review"],
  },
  Team: {
    heading: "Team Chats",
    chats: ["PMO Team Chat", "Intake Council", "Steering Prep", "Risk & Escalations"],
    savedHeading: "Team Saved Chats",
    saved: ["Q2 Planning Summary", "Resourcing Discussion"],
  },
  Project: {
    heading: "Project Chats",
    chats: ["My Project Notes", "Roadmap Review", "Stakeholder Follow-ups", "Personal Risks"],
    savedHeading: "Project Saved Chats",
    saved: ["My Vertex Hub Brief", "Private Launch Notes"],
  },
  "Team Project": {
    heading: "Project Chats",
    chats: ["Shared Chat", "Roadmap Planning", "Stakeholder Updates", "Risk & Issues", "Decision Log"],
    savedHeading: "Project Saved Chats",
    saved: ["Q2 Planning Summary", "Resourcing Discussion"],
  },
};

const initialIdeas: Idea[] = [
  {
    id: "idea-raid-copilot",
    title: "Portfolio RAID Copilot",
    status: "Pilot",
    category: "Risk and issue management",
    owner: "Alex Morgan",
    avatar: avatarAlex,
    created: "Today",
    votes: 18,
    impact: 92,
    effort: 44,
    confidence: 83,
    summary:
      "Summarize new risks, issues, assumptions, and dependencies across weekly status notes, then draft an escalation-ready briefing for the PMO lead.",
    nextStep: "Pilot against Vertex Hub and Data Migration weekly reports by Friday.",
    tags: ["RAID", "Escalation", "Weekly status"],
    metrics: ["2.5 hours saved per project weekly", "34 unresolved items found", "7 day faster escalation"],
    thread: [
      "Can we pull RAID items out of project notes without asking PMs to reformat every update?",
      "Assistant mapped risks to owners and suggested escalation language.",
      "Taylor pinned this for the next Steering Committee review.",
    ],
  },
  {
    id: "idea-decision-aging",
    title: "Decision aging nudges",
    status: "Approved",
    category: "Governance",
    owner: "Jordan Lee",
    avatar: avatarJordan,
    created: "Yesterday",
    votes: 14,
    impact: 78,
    effort: 32,
    confidence: 88,
    summary:
      "Detect decisions older than seven days, surface the blocker, and draft a targeted nudge to the accountable approver.",
    nextStep: "Add to the shared Decision Log workflow and test with the LMS Next Gen team.",
    tags: ["Decision log", "Approvals", "Cycle time"],
    metrics: ["41 open decisions scanned", "9 stale decisions flagged", "18 percent shorter approval cycle"],
    thread: [
      "The PMO needs a softer way to follow up without creating extra meeting load.",
      "Assistant grouped delayed decisions by approver and business impact.",
      "Approved for rollout after governance template updates.",
    ],
  },
  {
    id: "idea-intake-triage",
    title: "Project intake triage assistant",
    status: "Review",
    category: "Intake",
    owner: "Maya Chen",
    avatar: avatarMaya,
    created: "Jun 8",
    votes: 11,
    impact: 85,
    effort: 58,
    confidence: 74,
    summary:
      "Review new project requests for missing sponsor, budget, benefits, timeline, and dependency information before they reach intake council.",
    nextStep: "Confirm the minimum intake data set with Finance and Operations owners.",
    tags: ["Intake", "Prioritization", "Quality gate"],
    metrics: ["22 intake fields reviewed", "6 common omissions", "30 minute council prep reduction"],
    thread: [
      "New requests often hit council with missing data.",
      "Assistant generated clarification questions and a completeness score.",
      "Needs Finance validation before moving to pilot.",
    ],
  },
  {
    id: "idea-dependency-map",
    title: "Dependency heatmap from chat",
    status: "New",
    category: "Planning",
    owner: "Taylor Kim",
    avatar: avatarTaylor,
    created: "Jun 7",
    votes: 9,
    impact: 81,
    effort: 66,
    confidence: 68,
    summary:
      "Turn recurring dependency mentions from chat and meeting notes into a lightweight heatmap by project, owner, and target date.",
    nextStep: "Define dependency keywords and the first three project sources to monitor.",
    tags: ["Dependencies", "Planning", "Cross-project"],
    metrics: ["5 projects in scope", "13 possible dependency clusters", "3 high-risk handoffs"],
    thread: [
      "Several project updates reference the same data migration dependency.",
      "Assistant proposed a cross-project view by date and owner.",
      "Needs a test data set before review.",
    ],
  },
  {
    id: "idea-freshness",
    title: "Artifact freshness monitor",
    status: "Implemented",
    category: "Artifacts",
    owner: "Priya Shah",
    avatar: avatarPriya,
    created: "Jun 3",
    votes: 16,
    impact: 70,
    effort: 28,
    confidence: 91,
    summary:
      "Flag executive summaries, risk registers, and launch checklists that are referenced in chat but older than the current reporting period.",
    nextStep: "Measure adoption after the first month of Steering Committee packets.",
    tags: ["Artifacts", "Steering Committee", "Quality"],
    metrics: ["12 final artifacts monitored", "4 stale references replaced", "100 percent packet readiness"],
    thread: [
      "Old versions were still being linked in stakeholder updates.",
      "Assistant now suggests the latest pinned artifact before sharing.",
      "Released to Team Project spaces this week.",
    ],
  },
  {
    id: "idea-change-impact",
    title: "Change-impact briefing builder",
    status: "Blocked",
    category: "Change management",
    owner: "Jordan Lee",
    avatar: avatarJordan,
    created: "Jun 2",
    votes: 7,
    impact: 88,
    effort: 76,
    confidence: 55,
    summary:
      "Generate a change-impact brief from roadmap updates, affected stakeholder groups, training needs, and launch risk notes.",
    nextStep: "Needs stakeholder taxonomy approval before the assistant can classify impacted audiences.",
    tags: ["Change", "Training", "Launch readiness"],
    metrics: ["8 stakeholder groups proposed", "4 training assets referenced", "2 taxonomy gaps"],
    thread: [
      "Teams want a faster way to explain roadmap changes.",
      "Assistant drafted the first brief but found inconsistent stakeholder labels.",
      "Blocked until the taxonomy is approved.",
    ],
  },
];

const initialMessages: ChatMessage[] = [
  {
    id: "msg-1",
    author: "Alex Morgan",
    role: "user",
    avatar: avatarAlex,
    time: "9:15 AM",
    text: "Can you draft an executive summary for the Vertex Hub roadmap and include the improvement ideas with pilot status?",
  },
  {
    id: "msg-2",
    author: "PMO Assistant",
    role: "assistant",
    time: "9:16 AM",
    text: "Sure. I drafted the roadmap summary, grouped the highest-confidence PMO ideas, and highlighted pilots ready for Steering Committee discussion.",
    artifact: {
      title: "Vertex Hub Roadmap Executive Summary",
      meta: "PPTX - 8 slides - Generated by GPT 5.5",
      type: "ppt",
    },
  },
  {
    id: "msg-3",
    author: "Jordan Lee",
    role: "user",
    avatar: avatarJordan,
    time: "9:18 AM",
    text: "Looks good. Please add key risks, expected effort, and the owner for each idea.",
  },
  {
    id: "msg-4",
    author: "PMO Assistant",
    role: "assistant",
    time: "9:19 AM",
    text: "Added owner, impact, effort, confidence, and next-step recommendations. I also flagged the change-impact briefing as blocked by stakeholder taxonomy.",
    artifact: {
      title: "PMO Improvement Idea Register",
      meta: "XLSX - 6 rows - Generated by GPT 5.5",
      type: "sheet",
    },
  },
  {
    id: "msg-5",
    author: "Taylor Kim",
    role: "user",
    avatar: avatarTaylor,
    time: "9:21 AM",
    text: "Pinned as final artifacts. Ready for the Steering Committee update.",
  },
];

const initialConversations: Record<string, ChatMessage[]> = {
  "Vertex Hub::Shared Chat": initialMessages,
  "Vertex Hub::Roadmap Planning": [
    {
      id: "vh-roadmap-1",
      author: "Maya Chen",
      role: "user",
      avatar: avatarMaya,
      time: "8:42 AM",
      text: "Can you compare the Q3 roadmap milestones against the current launch readiness checklist?",
    },
    {
      id: "vh-roadmap-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "8:43 AM",
      text: "Three milestones need attention: data migration cutover, training sign-off, and parent communication review. I recommend adding dependency owners before the next checkpoint.",
      artifact: { title: "Roadmap Gap Summary", meta: "DOCX - 3 pages - Generated by GPT 5.5", type: "doc" },
    },
    {
      id: "vh-roadmap-3",
      author: "Alex Morgan",
      role: "user",
      avatar: avatarAlex,
      time: "8:51 AM",
      text: "Create an improvement idea for dependency owner nudges and attach it to the next Steering Committee packet.",
    },
  ],
  "Vertex Hub::Stakeholder Updates": [
    {
      id: "vh-stake-1",
      author: "Taylor Kim",
      role: "user",
      avatar: avatarTaylor,
      time: "10:04 AM",
      text: "Which stakeholder groups need a clearer update before the Vertex Hub launch review?",
    },
    {
      id: "vh-stake-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "10:05 AM",
      text: "School leaders need launch dates, Operations needs support ownership, and Finance needs budget variance context. I drafted a stakeholder-specific update set.",
      artifact: { title: "Stakeholder Update Drafts", meta: "DOCX - 5 sections - Generated by GPT 5.5", type: "doc" },
    },
  ],
  "Vertex Hub::Risk & Issues": [
    {
      id: "vh-risk-1",
      author: "Jordan Lee",
      role: "user",
      avatar: avatarJordan,
      time: "11:12 AM",
      text: "Review the open risks and tell me which ones should be escalated this week.",
    },
    {
      id: "vh-risk-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "11:13 AM",
      text: "Two risks meet escalation criteria: unresolved SIS dependency and training attendance below threshold. I recommend moving Portfolio RAID Copilot to pilot for this workflow.",
      artifact: { title: "Escalation Risk Register", meta: "XLSX - 12 rows - Generated by GPT 5.5", type: "sheet" },
    },
  ],
  "LMS Next Gen::LMS Shared Chat": [
    {
      id: "lms-shared-1",
      author: "Maya Chen",
      role: "user",
      avatar: avatarMaya,
      time: "9:00 AM",
      text: "Summarize LMS Next Gen risks, open vendor asks, and the strongest PMO improvement idea for this project.",
    },
    {
      id: "lms-shared-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "9:01 AM",
      text: "The largest risks are UAT scope creep and reporting integration. The strongest improvement idea is a release-plan delta detector from vendor notes.",
      artifact: { title: "LMS PMO Snapshot", meta: "DOCX - 4 pages - Generated by GPT 5.5", type: "doc" },
    },
  ],
  "LMS Next Gen::Vendor Planning": [
    {
      id: "lms-vendor-1",
      author: "Jordan Lee",
      role: "user",
      avatar: avatarJordan,
      time: "10:18 AM",
      text: "Convert the vendor meeting notes into owners, due dates, and decision asks.",
    },
    {
      id: "lms-vendor-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "10:19 AM",
      text: "I found seven vendor actions, two overdue owner confirmations, and one decision ask around reporting integration scope.",
      artifact: { title: "Vendor Action Extract", meta: "XLSX - 7 rows - Generated by GPT 5.5", type: "sheet" },
    },
  ],
  "Data Migration::Migration Command Center": [
    {
      id: "dm-plan-1",
      author: "Jordan Lee",
      role: "user",
      avatar: avatarJordan,
      time: "1:22 PM",
      text: "Build a status brief from the latest migration notes and call out decisions needed from the PMO.",
    },
    {
      id: "dm-plan-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "1:23 PM",
      text: "The migration is green on extraction, yellow on validation, and blocked on three field-mapping decisions. I added those to the decision log.",
      artifact: { title: "Data Migration PMO Brief", meta: "DOCX - 4 pages - Generated by GPT 5.5", type: "doc" },
    },
  ],
  "Data Migration::Field Mapping": [
    {
      id: "dm-map-1",
      author: "Taylor Kim",
      role: "user",
      avatar: avatarTaylor,
      time: "12:30 PM",
      text: "Show the unresolved field mappings and who owns each decision.",
    },
    {
      id: "dm-map-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "12:31 PM",
      text: "There are three unresolved mappings: enrollment status, guardian contact preference, and program code. I added them to Cutover Decisions.",
      artifact: { title: "Field Mapping Decision List", meta: "XLSX - 3 rows - Generated by GPT 5.5", type: "sheet" },
    },
  ],
  "AI Innovation Lab::AI Lab Shared Chat": [
    {
      id: "ai-plan-1",
      author: "Priya Shah",
      role: "user",
      avatar: avatarPriya,
      time: "3:15 PM",
      text: "Which AI pilots are ready for PMO review, and what governance gaps remain?",
    },
    {
      id: "ai-plan-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "3:16 PM",
      text: "Two pilots are review-ready: meeting action extraction and artifact freshness monitoring. Remaining gaps are data retention, owner approval, and training materials.",
      artifact: { title: "AI Pilot Governance Snapshot", meta: "PPTX - 5 slides - Generated by GPT 5.5", type: "ppt" },
    },
  ],
  "AI Innovation Lab::Pilot Intake": [
    {
      id: "ai-intake-1",
      author: "Priya Shah",
      role: "user",
      avatar: avatarPriya,
      time: "11:35 AM",
      text: "Triage the new AI pilot ideas by readiness, risk, and PMO value.",
    },
    {
      id: "ai-intake-2",
      author: "PMO Assistant",
      role: "assistant",
      time: "11:36 AM",
      text: "Meeting action extraction is ready for pilot, artifact freshness monitoring needs owner approval, and stakeholder sentiment analysis needs privacy review.",
      artifact: { title: "AI Pilot Intake Triage", meta: "XLSX - 5 ideas - Generated by GPT 5.5", type: "sheet" },
    },
  ],
};

const initialArtifacts: Artifact[] = [
  {
    title: "Vertex Hub Roadmap Brief",
    type: "PPTX",
    owner: "Taylor Kim",
    date: "May 10, 2026",
    status: "Final",
    summary: "Executive-ready roadmap narrative with milestones, risks, and PMO improvement pilots.",
    href: "/artifacts/vertex-hub-roadmap-brief.pptx",
    preview: [
      "Roadmap is on track for the June Steering Committee readout.",
      "Highest-value PMO pilots: RAID Copilot, decision capture, and stakeholder summaries.",
      "Key risk: fragmented evidence across project chats and artifact folders.",
    ],
    pinnedTo: ["Team Project"],
  },
  {
    title: "PMO Improvement Idea Register",
    type: "XLSX",
    owner: "PMO Assistant",
    date: "Jun 10, 2026",
    status: "Pinned",
    summary: "Prioritized improvement queue with impact, effort, owner, evidence, and recommended next step.",
    href: "/artifacts/pmo-improvement-idea-register.xlsx",
    preview: [
      "Six active ideas scored by impact, effort, confidence, and operating cadence fit.",
      "Pilot recommendations prioritize RAID automation and decision log hygiene.",
      "Blocked items need data ownership and intake governance decisions.",
    ],
    pinnedTo: ["Team", "Team Project"],
  },
  {
    title: "Steering Committee Update",
    type: "PPTX",
    owner: "Taylor Kim",
    date: "May 9, 2026",
    status: "Final",
    summary: "Committee packet with status summary, decision asks, and risks requiring leadership attention.",
    href: "/artifacts/steering-committee-update.pptx",
    preview: [
      "Status: roadmap delivery remains green with watch items in readiness and adoption.",
      "Decision ask: approve RAID Copilot pilot scope and stakeholder taxonomy refresh.",
      "Next milestone: package final artifacts for committee review.",
    ],
    pinnedTo: ["Team Project"],
  },
  {
    title: "Launch Readiness Checklist",
    type: "DOCX",
    owner: "Alex Morgan",
    date: "May 7, 2026",
    status: "Draft",
    summary: "Readiness checklist for owners, dependencies, training, communications, and launch gates.",
    href: "/artifacts/launch-readiness-checklist.docx",
    preview: [
      "Confirms owners, launch gates, training plan, communication draft, and support path.",
      "Open item: define escalation timing for unresolved UAT risks.",
      "Recommended next step: assign owners for final go-live criteria.",
    ],
    pinnedTo: ["Project"],
  },
];

const initialWorkspaceState: PmoWorkspaceState = {
  ideas: initialIdeas,
  conversations: initialConversations,
  artifacts: initialArtifacts,
  decisions: [
    { id: "decision-raid", title: "Approve RAID Copilot pilot", status: "Open", owner: "Alex Morgan", due: "Due Jun 14" },
    { id: "decision-taxonomy", title: "Confirm stakeholder taxonomy", status: "Blocked", owner: "Jordan Lee", due: "Due Jun 12" },
    { id: "decision-register", title: "Add idea register to packet", status: "Done", owner: "Taylor Kim", due: "Done" },
  ],
  approvals: [
    { id: "approval-raid", title: "RAID Copilot pilot scope", owner: "Alex Morgan", due: "Due Jun 14", status: "Needed" },
    { id: "approval-taxonomy", title: "Stakeholder taxonomy refresh", owner: "Jordan Lee", due: "Requested", status: "Requested" },
    { id: "approval-register", title: "Publish PMO idea register", owner: "Taylor Kim", due: "Approved Jun 9", status: "Approved" },
  ],
  tasks: [
    { id: "task-readiness", title: "Assign owners for launch readiness gaps", owner: "Maya Chen", source: "Launch Readiness Checklist", status: "Open" },
    { id: "task-decision", title: "Send nudges for decisions older than seven days", owner: "Jordan Lee", source: "Decision Log", status: "In progress" },
    { id: "task-raid", title: "Package RAID Copilot evidence for Steering Committee", owner: "Alex Morgan", source: "Risk & Issues chat", status: "Open" },
    { id: "task-register", title: "Confirm idea-register scoring with PMO team", owner: "Taylor Kim", source: "Shared Chat", status: "Done" },
  ],
  pinnedIdeaIds: ["idea-raid-copilot", "idea-decision-aging"],
  accessLevel: "Read / Write",
  activity: [
    { id: "activity-register", label: "Idea register pinned", detail: "PMO Improvement Idea Register is visible in Team Project.", time: "9:21 AM" },
    { id: "activity-raid", label: "Pilot evidence ready", detail: "Portfolio RAID Copilot has 34 unresolved items mapped.", time: "9:19 AM" },
    { id: "activity-taxonomy", label: "Decision blocked", detail: "Stakeholder taxonomy still needs governance approval.", time: "Yesterday" },
  ],
  updatedAt: "Jun 10, 2026 9:21 PM",
};

let workspaceState: PmoWorkspaceState | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getMutableWorkspace() {
  workspaceState ??= clone(initialWorkspaceState);
  return workspaceState;
}

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function recordActivity(workspace: PmoWorkspaceState, label: string, detail: string) {
  workspace.updatedAt = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  workspace.activity = [
    {
      id: `activity-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      label,
      detail,
      time: nowLabel(),
    },
    ...workspace.activity,
  ].slice(0, 8);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function cycleDecisionStatus(status: Decision["status"]): Decision["status"] {
  if (status === "Open") return "Done";
  if (status === "Blocked") return "Open";
  return "Open";
}

function cycleApprovalStatus(status: Approval["status"]): Approval["status"] {
  if (status === "Needed") return "Requested";
  if (status === "Requested") return "Approved";
  return "Needed";
}

function cycleTaskStatus(status: Task["status"]): Task["status"] {
  if (status === "Open") return "In progress";
  if (status === "In progress") return "Done";
  return "Open";
}

function impactScore(value: AddIdeaInput["impact"]) {
  if (value === "High") return 86;
  if (value === "Medium") return 68;
  return 46;
}

export function getConversationKey(project: string, chat: string) {
  return `${project}::${chat}`;
}

export function workspaceModeLabel(mode: WorkspaceMode) {
  return mode === "Project" ? "Personal Project" : mode;
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export const fetchPmoWorkspace = createServerFn({ method: "GET" }).handler(async () => {
  return clone(getMutableWorkspace());
});

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator((data: { project: string; chat: string; text: string; model: string }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    const conversationKey = getConversationKey(data.project, data.chat);
    const text = data.text.trim();
    if (!text) return clone(workspace);

    const userMessage: ChatMessage = {
      id: createId("msg-user"),
      author: "Alex Morgan",
      role: "user",
      avatar: avatarAlex,
      time: nowLabel(),
      text,
    };
    const response: ChatMessage = {
      id: createId("msg-assistant"),
      author: "PMO Assistant",
      role: "assistant",
      time: nowLabel(),
      text:
        `I reviewed ${data.project} / ${data.chat} with ${data.model}. ` +
        "The strongest next action is to connect open decisions, artifact evidence, and owner follow-ups before the next PMO checkpoint.",
      artifact: {
        title: `${data.project} PMO Action Snapshot`,
        meta: `DOCX - Generated by ${data.model}`,
        type: "doc",
      },
    };

    workspace.conversations[conversationKey] = [
      ...(workspace.conversations[conversationKey] ?? []),
      userMessage,
      response,
    ];
    recordActivity(workspace, "Chat response generated", `${data.chat} updated for ${data.project}.`);
    return clone(workspace);
  });

export const addIdea = createServerFn({ method: "POST" })
  .validator((data: AddIdeaInput) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    const title = data.title.trim();
    if (!title) return clone(workspace);

    const nextIdea: Idea = {
      id: createId("idea"),
      title,
      status: data.status,
      category: data.category,
      owner: "Alex Morgan",
      avatar: avatarAlex,
      created: "Just now",
      votes: 1,
      impact: impactScore(data.impact),
      effort: data.impact === "High" ? 52 : data.impact === "Medium" ? 42 : 30,
      confidence: data.impact === "High" ? 78 : 66,
      summary: data.summary.trim() || "New PMO improvement idea captured from the workspace.",
      nextStep: "Confirm owner, evidence source, and governance fit.",
      tags: [data.category, data.impact, "New intake"],
      metrics: ["Owner confirmation needed", "Evidence source pending", "Governance review pending"],
      thread: [
        "Idea captured through the PMO workspace.",
        "Assistant prepared initial impact and follow-up fields.",
      ],
    };

    workspace.ideas = [nextIdea, ...workspace.ideas];
    workspace.pinnedIdeaIds = [nextIdea.id, ...workspace.pinnedIdeaIds];
    recordActivity(workspace, "Idea added", `${nextIdea.title} entered the improvement queue.`);
    return clone(workspace);
  });

export const updateIdeaStatus = createServerFn({ method: "POST" })
  .validator((data: { id: string; status: IdeaStatus }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    workspace.ideas = workspace.ideas.map((idea) =>
      idea.id === data.id ? { ...idea, status: data.status } : idea,
    );
    const idea = workspace.ideas.find((item) => item.id === data.id);
    recordActivity(workspace, "Idea status changed", `${idea?.title ?? "Idea"} moved to ${data.status}.`);
    return clone(workspace);
  });

export const voteIdea = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    workspace.ideas = workspace.ideas.map((idea) =>
      idea.id === data.id ? { ...idea, votes: idea.votes + 1 } : idea,
    );
    const idea = workspace.ideas.find((item) => item.id === data.id);
    recordActivity(workspace, "Idea vote added", `${idea?.title ?? "Idea"} gained a PMO vote.`);
    return clone(workspace);
  });

export const toggleIdeaPin = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    const isPinned = workspace.pinnedIdeaIds.includes(data.id);
    workspace.pinnedIdeaIds = isPinned
      ? workspace.pinnedIdeaIds.filter((id) => id !== data.id)
      : [data.id, ...workspace.pinnedIdeaIds];
    const idea = workspace.ideas.find((item) => item.id === data.id);
    recordActivity(workspace, isPinned ? "Idea unpinned" : "Idea pinned", `${idea?.title ?? "Idea"} workspace pin changed.`);
    return clone(workspace);
  });

export const toggleArtifactPin = createServerFn({ method: "POST" })
  .validator((data: { title: string; mode: WorkspaceMode }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    workspace.artifacts = workspace.artifacts.map((artifact) => {
      if (artifact.title !== data.title) return artifact;
      const isPinned = artifact.pinnedTo.includes(data.mode);
      return {
        ...artifact,
        pinnedTo: isPinned
          ? artifact.pinnedTo.filter((mode) => mode !== data.mode)
          : [...artifact.pinnedTo, data.mode],
      };
    });
    recordActivity(workspace, "Artifact pin changed", `${data.title} updated for ${workspaceModeLabel(data.mode)}.`);
    return clone(workspace);
  });

export const toggleDecisionStatus = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    workspace.decisions = workspace.decisions.map((decision) =>
      decision.id === data.id ? { ...decision, status: cycleDecisionStatus(decision.status) } : decision,
    );
    const decision = workspace.decisions.find((item) => item.id === data.id);
    recordActivity(workspace, "Decision updated", `${decision?.title ?? "Decision"} is now ${decision?.status ?? "updated"}.`);
    return clone(workspace);
  });

export const toggleApprovalStatus = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    workspace.approvals = workspace.approvals.map((approval) =>
      approval.id === data.id ? { ...approval, status: cycleApprovalStatus(approval.status) } : approval,
    );
    const approval = workspace.approvals.find((item) => item.id === data.id);
    recordActivity(workspace, "Approval updated", `${approval?.title ?? "Approval"} is now ${approval?.status ?? "updated"}.`);
    return clone(workspace);
  });

export const toggleTaskStatus = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    workspace.tasks = workspace.tasks.map((task) =>
      task.id === data.id ? { ...task, status: cycleTaskStatus(task.status) } : task,
    );
    const task = workspace.tasks.find((item) => item.id === data.id);
    recordActivity(workspace, "Task updated", `${task?.title ?? "Task"} is now ${task?.status ?? "updated"}.`);
    return clone(workspace);
  });

export const updateAccessLevel = createServerFn({ method: "POST" })
  .validator((data: { accessLevel: PmoWorkspaceState["accessLevel"] }) => data)
  .handler(async ({ data }) => {
    const workspace = getMutableWorkspace();
    workspace.accessLevel = data.accessLevel;
    recordActivity(workspace, "Workspace access updated", `Team access set to ${data.accessLevel}.`);
    return clone(workspace);
  });

export const pmoWorkspaceQueryKey = ["pmo-workspace"] as const;

export const pmoWorkspaceQueryOptions = () =>
  queryOptions({
    queryKey: pmoWorkspaceQueryKey,
    queryFn: () => fetchPmoWorkspace(),
  });
