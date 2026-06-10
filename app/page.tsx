"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  Globe2,
  Lightbulb,
  Link2,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Rocket,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Users,
  X,
  Zap,
} from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

type IdeaStatus = "New" | "Review" | "Pilot" | "Approved" | "Implemented" | "Blocked";
type TabName = "Chat" | "Ideas" | "Artifacts" | "Decisions" | "Prompts";
type RailName = "Chat" | "Projects" | "Teams" | "Artifacts" | "Prompts" | "Settings";
type TopbarMenu = "notifications" | "people" | "model" | "workspace" | "attachment" | null;

type Idea = {
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

type ChatMessage = {
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

type Artifact = {
  title: string;
  type: string;
  owner: string;
  date: string;
  status: "Final" | "Draft" | "Pinned";
  summary: string;
};

type Decision = {
  id: string;
  title: string;
  status: "Open" | "Blocked" | "Done";
  owner: string;
  due: string;
};

const avatarAlex =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80";
const avatarJordan =
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80";
const avatarTaylor =
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=120&q=80";
const avatarMaya =
  "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=120&q=80";
const avatarPriya =
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=120&q=80";

const statusMeta: Record<IdeaStatus, { label: string; tone: string; description: string }> = {
  New: {
    label: "New",
    tone: "new",
    description: "Captured and ready for PMO triage.",
  },
  Review: {
    label: "Under review",
    tone: "review",
    description: "Sizing impact, owner, and governance fit.",
  },
  Pilot: {
    label: "In pilot",
    tone: "pilot",
    description: "Being tested with a live project team.",
  },
  Approved: {
    label: "Approved",
    tone: "approved",
    description: "Ready to add to the rollout backlog.",
  },
  Implemented: {
    label: "Implemented",
    tone: "implemented",
    description: "Released into the PMO operating model.",
  },
  Blocked: {
    label: "Blocked",
    tone: "blocked",
    description: "Needs a decision, data source, or owner.",
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

const initialArtifacts: Artifact[] = [
  {
    title: "Vertex Hub Roadmap Brief",
    type: "PPTX",
    owner: "Taylor Kim",
    date: "May 10, 2026",
    status: "Final",
    summary: "Executive-ready roadmap narrative with milestones, risks, and PMO improvement pilots.",
  },
  {
    title: "PMO Improvement Idea Register",
    type: "XLSX",
    owner: "PMO Assistant",
    date: "Jun 10, 2026",
    status: "Pinned",
    summary: "Prioritized improvement queue with impact, effort, owner, evidence, and recommended next step.",
  },
  {
    title: "Steering Committee Update",
    type: "PPTX",
    owner: "Taylor Kim",
    date: "May 9, 2026",
    status: "Final",
    summary: "Committee packet with status summary, decision asks, and risks requiring leadership attention.",
  },
  {
    title: "Launch Readiness Checklist",
    type: "DOCX",
    owner: "Alex Morgan",
    date: "May 7, 2026",
    status: "Draft",
    summary: "Readiness checklist for owners, dependencies, training, communications, and launch gates.",
  },
];

const initialDecisions: Decision[] = [
  { id: "decision-raid", title: "Approve RAID Copilot pilot", status: "Open", owner: "Alex Morgan", due: "Due Jun 14" },
  { id: "decision-taxonomy", title: "Confirm stakeholder taxonomy", status: "Blocked", owner: "Jordan Lee", due: "Due Jun 12" },
  { id: "decision-register", title: "Add idea register to packet", status: "Done", owner: "Taylor Kim", due: "Done" },
];

const tabs: TabName[] = ["Chat", "Ideas", "Artifacts", "Decisions", "Prompts"];
const statusFilters: Array<IdeaStatus | "All"> = [
  "All",
  "New",
  "Review",
  "Pilot",
  "Approved",
  "Implemented",
  "Blocked",
];

const emptyForm = {
  title: "",
  category: "Governance",
  status: "New" as IdeaStatus,
  impact: "High",
  summary: "",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function iconForArtifact(type: "doc" | "ppt" | "sheet" | string) {
  if (type === "sheet" || type === "XLSX") return <ClipboardList size={18} />;
  if (type === "ppt" || type === "PPTX") return <BarChart3 size={18} />;
  return <FileText size={18} />;
}

export default function Home() {
  const [ideas, setIdeas] = useState<Idea[]>(initialIdeas);
  const [selectedIdeaId, setSelectedIdeaId] = useState(initialIdeas[0].id);
  const [activeTab, setActiveTab] = useState<TabName>("Chat");
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | "All">("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [chatInput, setChatInput] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState("Prototype ready");
  const [rightOpen, setRightOpen] = useState(true);
  const [activeRail, setActiveRail] = useState<RailName>("Chat");
  const [activeProject, setActiveProject] = useState("Vertex Hub");
  const [activeChat, setActiveChat] = useState("Shared Chat");
  const [activeMode, setActiveMode] = useState("Team Project");
  const [topbarMenu, setTopbarMenu] = useState<TopbarMenu>(null);
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [accessLevel, setAccessLevel] = useState<"Read / Write" | "View only">("Read / Write");
  const [model, setModel] = useState("GPT 5.5");
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [selectedArtifactTitle, setSelectedArtifactTitle] = useState(initialArtifacts[1].title);
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions);

  const selectedIdea = ideas.find((idea) => idea.id === selectedIdeaId) ?? ideas[0];
  const selectedArtifact = artifacts.find((artifact) => artifact.title === selectedArtifactTitle) ?? artifacts[0];

  const filteredIdeas = useMemo(() => {
    return ideas.filter((idea) => {
      const matchesStatus = statusFilter === "All" || idea.status === statusFilter;
      const searchable = `${idea.title} ${idea.category} ${idea.summary} ${idea.tags.join(" ")}`.toLowerCase();
      return matchesStatus && searchable.includes(searchTerm.toLowerCase());
    });
  }, [ideas, searchTerm, statusFilter]);

  const score = Math.round(
    ideas.reduce((total, idea) => total + idea.impact * (idea.confidence / 100), 0) / ideas.length,
  );

  function updateToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast("Prototype ready"), 2600);
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const newUserMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      author: "You",
      role: "user",
      avatar: avatarPriya,
      time,
      text: trimmed,
    };
    const response: ChatMessage = {
      id: `msg-${Date.now()}-assistant`,
      author: "PMO Assistant",
      role: "assistant",
      time,
      text:
        "I added that to the working thread. The strongest current recommendation is to pilot RAID Copilot first because it has the highest impact-to-effort score.",
    };

    setMessages((current) => [...current, newUserMessage, response]);
    setChatInput("");
    updateToast("Chat updated with assistant recommendation");
  }

  function handleAddIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim() || !form.summary.trim()) {
      updateToast("Add a title and summary to capture the idea");
      return;
    }

    const nextIdea: Idea = {
      id: `idea-${Date.now()}`,
      title: form.title.trim(),
      status: form.status,
      category: form.category,
      owner: "You",
      avatar: avatarPriya,
      created: "Just now",
      votes: 1,
      impact: form.impact === "High" ? 82 : form.impact === "Medium" ? 62 : 38,
      effort: form.impact === "High" ? 54 : 40,
      confidence: 64,
      summary: form.summary.trim(),
      nextStep: "Review with the PMO team and assign a pilot owner.",
      tags: [form.category, "New idea", form.impact],
      metrics: ["Needs sizing", "Owner pending", "Review this week"],
      thread: [
        "Captured from the add-idea flow.",
        "Assistant recommends reviewing expected impact and effort before pilot selection.",
      ],
    };

    setIdeas((current) => [nextIdea, ...current]);
    setSelectedIdeaId(nextIdea.id);
    setActiveTab("Ideas");
    setRightOpen(true);
    setIsAddOpen(false);
    setForm(emptyForm);
    updateToast("Improvement idea added to the queue");
  }

  function changeSelectedStatus(status: IdeaStatus) {
    setIdeas((current) =>
      current.map((idea) => (idea.id === selectedIdea.id ? { ...idea, status } : idea)),
    );
    updateToast(`Status updated to ${statusMeta[status].label}`);
  }

  function voteSelectedIdea() {
    setIdeas((current) =>
      current.map((idea) =>
        idea.id === selectedIdea.id ? { ...idea, votes: idea.votes + 1 } : idea,
      ),
    );
    updateToast("Vote added");
  }

  function handleRailClick(label: RailName) {
    setActiveRail(label);
    if (label === "Chat" || label === "Projects") setActiveTab("Chat");
    if (label === "Artifacts") setActiveTab("Artifacts");
    if (label === "Prompts") setActiveTab("Prompts");
    if (label === "Teams") setTopbarMenu("people");
    if (label === "Settings") setIsAccessOpen(true);
    updateToast(`${label} opened`);
  }

  function handleProjectSelect(project: string) {
    setActiveProject(project);
    setActiveChat(project === "Vertex Hub" ? "Shared Chat" : "Roadmap Planning");
    setActiveTab("Chat");
    setRightOpen(true);
    updateToast(`${project} selected`);
  }

  function handleChatSelect(chat: string) {
    setActiveChat(chat);
    setActiveTab(chat === "Decision Log" ? "Decisions" : "Chat");
    updateToast(`${chat} opened`);
  }

  function handleCreateArtifact() {
    const generated: Artifact = {
      title: `Idea Summary ${artifacts.length + 1}`,
      type: "DOCX",
      owner: "PMO Assistant",
      date: "Just now",
      status: "Draft",
      summary: `Draft summary generated from ${selectedIdea.title}, including owner, evidence, impact, effort, and next step.`,
    };
    setArtifacts((current) => [generated, ...current]);
    setSelectedArtifactTitle(generated.title);
    setActiveTab("Artifacts");
    updateToast("Artifact created from current idea");
  }

  function toggleDecisionStatus(id: string) {
    setDecisions((current) =>
      current.map((decision) => {
        if (decision.id !== id) return decision;
        const nextStatus = decision.status === "Done" ? "Open" : "Done";
        return { ...decision, status: nextStatus, due: nextStatus === "Done" ? "Done" : decision.due };
      }),
    );
    updateToast("Decision status updated");
  }

  return (
    <main className="prototype-shell">
      <div className="app-frame" aria-label="PMO Team Chat prototype">
        <aside className="primary-rail" aria-label="Global navigation">
          <div className="rail-logo">V</div>
          <RailItem icon={<MessageCircle size={20} />} label="Chat" active={activeRail === "Chat"} onClick={() => handleRailClick("Chat")} />
          <RailItem icon={<FolderOpen size={20} />} label="Projects" active={activeRail === "Projects"} onClick={() => handleRailClick("Projects")} />
          <RailItem icon={<Users size={20} />} label="Teams" active={activeRail === "Teams"} onClick={() => handleRailClick("Teams")} />
          <RailItem icon={<Archive size={20} />} label="Artifacts" active={activeRail === "Artifacts"} onClick={() => handleRailClick("Artifacts")} />
          <RailItem icon={<Sparkles size={20} />} label="Prompts" active={activeRail === "Prompts"} onClick={() => handleRailClick("Prompts")} />
          <div className="rail-spacer" />
          <RailItem icon={<Settings size={20} />} label="Settings" active={activeRail === "Settings"} onClick={() => handleRailClick("Settings")} />
          <img className="rail-avatar" src={avatarPriya} alt="Priya Shah" />
        </aside>

        <section className="workspace-shell">
          <header className="topbar">
            <div className="topbar-title">
              <button className="icon-button mobile-only" type="button" aria-label="Open menu" onClick={() => handleRailClick("Projects")}>
                <Menu size={20} />
              </button>
              <h1>PMO Team Chatbot</h1>
            </div>
            <label className="global-search">
              <Search size={16} />
              <input
                aria-label="Search chats, projects, and artifacts"
                placeholder="Search across chats, projects, artifacts..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <div className="topbar-actions">
              <button className="icon-button" type="button" aria-label="Notifications" onClick={() => setTopbarMenu(topbarMenu === "notifications" ? null : "notifications")}>
                <Bell size={18} />
              </button>
              <button className="people-pill" type="button" onClick={() => setTopbarMenu(topbarMenu === "people" ? null : "people")}>
                <Users size={17} />
                <span>8</span>
                <ChevronDown size={15} />
              </button>
            </div>
            {topbarMenu ? (
              <TopbarPopover
                menu={topbarMenu}
                model={model}
                onModel={setModel}
                onClose={() => setTopbarMenu(null)}
                onToast={updateToast}
              />
            ) : null}
          </header>

          <section className="contextbar">
            <div className="crumbs" aria-label="Breadcrumb">
              <span>PMO Team</span>
              <ChevronRight size={14} />
              <span>{activeProject}</span>
              <ChevronRight size={14} />
              <strong>{activeChat}</strong>
              <Star size={16} fill="#9aa4b2" strokeWidth={0} />
            </div>
            <div className="mode-tabs" aria-label="Chat mode">
              {["Personal", "Team Chat", "Project", "Team Project"].map((item) => (
                <button className={item === activeMode ? "active" : ""} type="button" key={item} onClick={() => {
                  setActiveMode(item);
                  updateToast(`${item} mode selected`);
                }}>
                  {item}
                </button>
              ))}
            </div>
            <div className="access-block">
              <ShieldCheck size={18} />
              <div>
                <strong>Team access</strong>
                <span>{accessLevel}</span>
              </div>
              <div className="avatar-stack" aria-label="Team members">
                {[avatarAlex, avatarJordan, avatarTaylor, avatarMaya].map((avatar) => (
                  <img src={avatar} alt="" key={avatar} />
                ))}
                <span>+3</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setIsAccessOpen(true)}>
                Manage access
              </button>
            </div>
          </section>

          <div className="content-grid">
            <ProjectNav
              activeProject={activeProject}
              activeChat={activeChat}
              onProjectSelect={handleProjectSelect}
              onChatSelect={handleChatSelect}
              onAdd={() => {
                setIsAddOpen(true);
                updateToast("Capture form opened");
              }}
            />

            <section className="main-panel" aria-label="Shared chat workspace">
              <div className="section-tabs" role="tablist" aria-label="Workspace tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={activeTab === tab ? "active" : ""}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === "Ideas" ? <Lightbulb size={16} /> : null}
                    {tab === "Artifacts" ? <CheckCircle2 size={16} /> : null}
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === "Chat" ? (
                <ChatView
                  messages={messages}
                  ideas={filteredIdeas}
                  selectedIdeaId={selectedIdea.id}
                  onSelectIdea={(id) => {
                    setSelectedIdeaId(id);
                    setRightOpen(true);
                  }}
                  onOpenIdeas={() => setActiveTab("Ideas")}
                  onAddIdea={() => setIsAddOpen(true)}
                />
              ) : null}

              {activeTab === "Ideas" ? (
                <IdeasView
                  ideas={filteredIdeas}
                  selectedIdeaId={selectedIdea.id}
                  searchTerm={searchTerm}
                  statusFilter={statusFilter}
                  onSearch={setSearchTerm}
                  onFilter={setStatusFilter}
                  onSelectIdea={(id) => {
                    setSelectedIdeaId(id);
                    setRightOpen(true);
                  }}
                  onAddIdea={() => setIsAddOpen(true)}
                />
              ) : null}

              {activeTab === "Artifacts" ? (
                <ArtifactView
                  artifacts={artifacts}
                  selectedArtifact={selectedArtifact}
                  onSelect={(artifact) => {
                    setSelectedArtifactTitle(artifact.title);
                    setRightOpen(true);
                    updateToast(`${artifact.title} selected`);
                  }}
                  onShare={() => setShareOpen((current) => !current)}
                  onCreateArtifact={handleCreateArtifact}
                />
              ) : null}

              {activeTab === "Decisions" ? <DecisionView decisions={decisions} onToggle={toggleDecisionStatus} /> : null}
              {activeTab === "Prompts" ? <PromptView onUsePrompt={setChatInput} /> : null}

              <form className="composer" onSubmit={handleSend}>
                <input
                  data-testid="composer-input"
                  aria-label="Message PMO Assistant"
                  placeholder="Message PMO Assistant..."
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                />
                <button className="icon-button" type="button" aria-label="Attach file" onClick={() => setTopbarMenu(topbarMenu === "attachment" ? null : "attachment")}>
                  <Paperclip size={19} />
                </button>
                <button className="icon-button" type="button" aria-label="Browse workspace" onClick={() => setTopbarMenu(topbarMenu === "workspace" ? null : "workspace")}>
                  <Globe2 size={19} />
                </button>
                <button className="model-button" type="button" onClick={() => setTopbarMenu(topbarMenu === "model" ? null : "model")}>
                  <Bot size={17} />
                  {model}
                  <ChevronDown size={14} />
                </button>
                <button className="send-button" type="submit" data-testid="send-message" aria-label="Send message">
                  <Send size={18} />
                </button>
              </form>
            </section>

            {rightOpen ? (
              <aside className="detail-panel" aria-label="Project workspace and idea detail">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">Project workspace</span>
                    <h2>PMO Improvement Queue</h2>
                  </div>
                  <button className="icon-button" type="button" onClick={() => setRightOpen(false)} aria-label="Collapse details">
                    <ChevronDown size={18} />
                  </button>
                </div>

                <div className="score-row">
                  <MetricCard icon={<Target size={18} />} label="Priority score" value={`${score}`} />
                  <MetricCard icon={<Rocket size={18} />} label="In flight" value={`${ideas.filter((idea) => idea.status === "Pilot").length}`} />
                  <MetricCard icon={<Check size={18} />} label="Done" value={`${ideas.filter((idea) => idea.status === "Implemented").length}`} />
                </div>

                <IdeaDetail
                  idea={selectedIdea}
                  onVote={voteSelectedIdea}
                  onStatusChange={changeSelectedStatus}
                  onShare={() => {
                    setShareOpen((current) => !current);
                    updateToast("Share menu opened");
                  }}
                />

                <section className="workspace-card">
                  <div className="card-title-row">
                    <h3>Final Artifacts</h3>
                    <button type="button" onClick={() => setActiveTab("Artifacts")}>
                      View all
                    </button>
                  </div>
                  <div className="artifact-list compact">
                    {artifacts.slice(0, 3).map((artifact) => (
                      <ArtifactRow artifact={artifact} selected={artifact.title === selectedArtifact.title} onSelect={() => {
                        setSelectedArtifactTitle(artifact.title);
                        setActiveTab("Artifacts");
                      }} key={artifact.title} />
                    ))}
                  </div>
                </section>

                <section className="workspace-card artifact-detail-card">
                  <div className="card-title-row">
                    <h3>Selected Artifact</h3>
                    <button type="button" onClick={handleCreateArtifact}>Generate new</button>
                  </div>
                  <p>{selectedArtifact.summary}</p>
                  <span className="artifact-detail-meta">{selectedArtifact.type} - {selectedArtifact.status} - {selectedArtifact.owner}</span>
                </section>

                {shareOpen ? <SharePopover onToast={updateToast} /> : null}
              </aside>
            ) : (
              <button className="open-detail-button" type="button" onClick={() => setRightOpen(true)}>
                <Lightbulb size={18} />
                Open idea detail
              </button>
            )}
          </div>
        </section>

        <div className="toast" role="status">
          <span />
          {toast}
        </div>
      </div>

      {isAddOpen ? (
        <AddIdeaModal
          form={form}
          onFormChange={setForm}
          onClose={() => setIsAddOpen(false)}
          onSubmit={handleAddIdea}
        />
      ) : null}
      {isAccessOpen ? (
        <AccessModal
          accessLevel={accessLevel}
          onAccessLevel={setAccessLevel}
          onClose={() => setIsAccessOpen(false)}
          onSave={() => {
            setIsAccessOpen(false);
            updateToast(`Access updated to ${accessLevel}`);
          }}
        />
      ) : null}
    </main>
  );
}

function RailItem({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`rail-item ${active ? "active" : ""}`} type="button" aria-label={label} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ProjectNav({
  activeProject,
  activeChat,
  onProjectSelect,
  onChatSelect,
  onAdd,
}: {
  activeProject: string;
  activeChat: string;
  onProjectSelect: (project: string) => void;
  onChatSelect: (chat: string) => void;
  onAdd: () => void;
}) {
  const teamProjects = ["Vertex Hub", "LMS Next Gen", "Data Migration", "AI Innovation Lab"];
  const chats = ["Shared Chat", "Roadmap Planning", "Stakeholder Updates", "Risk & Issues", "Decision Log"];

  return (
    <aside className="project-nav" aria-label="Project navigation">
      <div className="nav-section-heading">
        <span>Projects</span>
        <button className="nav-add-button" type="button" aria-label="Add project idea" onClick={onAdd}>
          <Plus size={17} />
        </button>
      </div>

      <div className="nav-group">
        <div className="nav-group-label">
          <ChevronDown size={15} />
          Team Projects
        </div>
        {teamProjects.map((project) => (
          <button className={`nav-link ${project === activeProject ? "active" : ""}`} type="button" key={project} onClick={() => onProjectSelect(project)}>
            <Folder size={15} />
            <span>{project}</span>
            {project === activeProject ? <span className="nav-dot" /> : null}
          </button>
        ))}
      </div>

      <div className="nav-group">
        <div className="nav-group-label">
          <ChevronDown size={15} />
          Chats
        </div>
        {chats.map((chat) => (
          <button className={`nav-link ${chat === activeChat ? "active" : ""}`} type="button" key={chat} onClick={() => onChatSelect(chat)}>
            <MessageCircle size={15} />
            <span>{chat}</span>
          </button>
        ))}
      </div>

      <div className="nav-group">
        <div className="nav-group-label">
          <ChevronDown size={15} />
          Saved Chats
        </div>
        {["Q2 Planning Summary", "Resourcing Discussion"].map((chat) => (
          <button className={`nav-link ${chat === activeChat ? "active" : ""}`} type="button" key={chat} onClick={() => onChatSelect(chat)}>
            <Archive size={15} />
            <span>{chat}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ChatView({
  messages,
  ideas,
  selectedIdeaId,
  onSelectIdea,
  onOpenIdeas,
  onAddIdea,
}: {
  messages: ChatMessage[];
  ideas: Idea[];
  selectedIdeaId: string;
  onSelectIdea: (id: string) => void;
  onOpenIdeas: () => void;
  onAddIdea: () => void;
}) {
  return (
    <div className="chat-view">
      <div className="messages">
        {messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            {message.role === "assistant" ? (
              <div className="assistant-avatar">V</div>
            ) : (
              <img className="message-avatar" src={message.avatar} alt={message.author} />
            )}
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.author}</strong>
                {message.role === "assistant" ? <span className="model-chip">GPT 5.5</span> : null}
                <span>{message.time}</span>
              </div>
              <p>{message.text}</p>
              {message.artifact ? (
                <button className={`artifact-card ${message.artifact.type}`} type="button">
                  <span className="artifact-icon">{iconForArtifact(message.artifact.type)}</span>
                  <span>
                    <strong>{message.artifact.title}</strong>
                    <em>{message.artifact.meta}</em>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ) : null}
            </div>
          </article>
        ))}

        <div className="pin-note">
          <Sparkles size={17} />
          <span>Assistant extracted 6 improvement ideas from this chat and linked them to final artifacts.</span>
        </div>
      </div>

      <section className="idea-strip" aria-label="Improvement ideas from chat">
        <div className="strip-header">
          <div>
            <span className="eyebrow">Improvement ideas</span>
            <h2>Ready for PMO triage</h2>
          </div>
          <div className="strip-actions">
            <button className="secondary-button" type="button" onClick={onOpenIdeas}>
              <Filter size={16} />
              Open filters
            </button>
            <button className="primary-button" type="button" data-testid="open-add-idea" onClick={onAddIdea}>
              <Plus size={16} />
              Add idea
            </button>
          </div>
        </div>
        <div className="idea-strip-grid">
          {ideas.slice(0, 3).map((idea) => (
            <IdeaCard
              idea={idea}
              selected={idea.id === selectedIdeaId}
              onSelect={() => onSelectIdea(idea.id)}
              key={idea.id}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function IdeasView({
  ideas,
  selectedIdeaId,
  searchTerm,
  statusFilter,
  onSearch,
  onFilter,
  onSelectIdea,
  onAddIdea,
}: {
  ideas: Idea[];
  selectedIdeaId: string;
  searchTerm: string;
  statusFilter: IdeaStatus | "All";
  onSearch: (value: string) => void;
  onFilter: (value: IdeaStatus | "All") => void;
  onSelectIdea: (id: string) => void;
  onAddIdea: () => void;
}) {
  return (
    <div className="ideas-view">
      <div className="ideas-toolbar">
        <div>
          <span className="eyebrow">Shared improvement backlog</span>
          <h2>{ideas.length} ideas visible</h2>
        </div>
        <button className="primary-button" type="button" data-testid="open-add-idea" onClick={onAddIdea}>
          <Plus size={16} />
          Add idea
        </button>
      </div>

      <div className="filter-row">
        <label className="idea-search">
          <Search size={16} />
          <input
            placeholder="Search ideas, categories, tags..."
            value={searchTerm}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
        <div className="status-filters" aria-label="Status filters">
          {statusFilters.map((status) => (
            <button
              key={status}
              type="button"
              className={statusFilter === status ? "active" : ""}
              onClick={() => onFilter(status)}
            >
              {status === "All" ? "All" : statusMeta[status].label}
            </button>
          ))}
        </div>
      </div>

      <div className="idea-list">
        {ideas.length ? (
          ideas.map((idea) => (
            <IdeaCard
              idea={idea}
              selected={idea.id === selectedIdeaId}
              onSelect={() => onSelectIdea(idea.id)}
              key={idea.id}
              wide
            />
          ))
        ) : (
          <div className="empty-state">
            <Lightbulb size={28} />
            <h3>No ideas match this filter</h3>
            <p>Try another status or clear the search to see the shared queue.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function IdeaCard({
  idea,
  selected,
  onSelect,
  wide = false,
}: {
  idea: Idea;
  selected: boolean;
  onSelect: () => void;
  wide?: boolean;
}) {
  return (
    <button className={`idea-card ${selected ? "selected" : ""} ${wide ? "wide" : ""}`} type="button" onClick={onSelect}>
      <div className="idea-card-top">
        <StatusChip status={idea.status} />
        <span className="vote-pill">
          <Zap size={14} />
          {idea.votes}
        </span>
      </div>
      <h3>{idea.title}</h3>
      <p>{idea.summary}</p>
      <div className="idea-card-footer">
        <span className="avatar-label">
          <img src={idea.avatar} alt={idea.owner} />
          {wide ? idea.owner : initials(idea.owner)}
        </span>
        <span>{idea.category}</span>
      </div>
      <div className="score-bars" aria-label="Impact and effort score">
        <span style={{ width: `${idea.impact}%` }} />
        <span style={{ width: `${idea.effort}%` }} />
      </div>
    </button>
  );
}

function StatusChip({ status }: { status: IdeaStatus }) {
  const meta = statusMeta[status];
  return <span className={`status-chip ${meta.tone}`}>{meta.label}</span>;
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function IdeaDetail({
  idea,
  onVote,
  onStatusChange,
  onShare,
}: {
  idea: Idea;
  onVote: () => void;
  onStatusChange: (status: IdeaStatus) => void;
  onShare: () => void;
}) {
  return (
    <section className="workspace-card idea-detail">
      <div className="detail-title">
        <div>
          <StatusChip status={idea.status} />
          <h3>{idea.title}</h3>
        </div>
        <button className="icon-button" type="button" aria-label="More options">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <p>{idea.summary}</p>

      <div className="owner-row">
        <img src={idea.avatar} alt={idea.owner} />
        <div>
          <strong>{idea.owner}</strong>
          <span>{idea.category} - captured {idea.created}</span>
        </div>
      </div>

      <div className="detail-metrics">
        <ProgressMetric label="Impact" value={idea.impact} />
        <ProgressMetric label="Effort" value={idea.effort} />
        <ProgressMetric label="Confidence" value={idea.confidence} />
      </div>

      <div className="next-step">
        <Clock3 size={17} />
        <span>{idea.nextStep}</span>
      </div>

      <div className="tag-row">
        {idea.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>

      <div className="detail-actions">
        <button className="secondary-button" type="button" onClick={onVote}>
          <Zap size={16} />
          Vote {idea.votes}
        </button>
        <button className="secondary-button" type="button" data-testid="detail-share" onClick={onShare}>
          <Share2 size={16} />
          Share
        </button>
      </div>

      <label className="status-select">
        <span>Status</span>
          <select
            aria-label="Detail idea status"
            data-testid="detail-status"
            value={idea.status}
            onChange={(event) => onStatusChange(event.target.value as IdeaStatus)}
          >
          {(Object.keys(statusMeta) as IdeaStatus[]).map((status) => (
            <option value={status} key={status}>
              {statusMeta[status].label}
            </option>
          ))}
        </select>
      </label>

      <div className="evidence-list">
        <h4>Evidence and metrics</h4>
        {idea.metrics.map((metric) => (
          <div key={metric}>
            <Activity size={15} />
            <span>{metric}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProgressMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="progress-metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ArtifactView({
  artifacts,
  selectedArtifact,
  onSelect,
  onShare,
  onCreateArtifact,
}: {
  artifacts: Artifact[];
  selectedArtifact: Artifact;
  onSelect: (artifact: Artifact) => void;
  onShare: () => void;
  onCreateArtifact: () => void;
}) {
  return (
    <div className="artifact-view">
      <div className="ideas-toolbar">
        <div>
          <span className="eyebrow">Final artifacts</span>
          <h2>Steering Committee packet</h2>
        </div>
        <button className="secondary-button" type="button" data-testid="detail-share" onClick={onShare}>
          <Share2 size={16} />
          Share artifact
        </button>
        <button className="primary-button" type="button" onClick={onCreateArtifact}>
          <Plus size={16} />
          Create artifact
        </button>
      </div>
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <ArtifactRow
            artifact={artifact}
            selected={artifact.title === selectedArtifact.title}
            onSelect={() => onSelect(artifact)}
            key={artifact.title}
          />
        ))}
      </div>
      <section className="workspace-card artifact-preview">
        <span className="eyebrow">Artifact detail</span>
        <h3>{selectedArtifact.title}</h3>
        <p>{selectedArtifact.summary}</p>
        <div className="tag-row">
          <span>{selectedArtifact.type}</span>
          <span>{selectedArtifact.status}</span>
          <span>{selectedArtifact.owner}</span>
        </div>
      </section>
    </div>
  );
}

function ArtifactRow({
  artifact,
  selected = false,
  onSelect,
}: {
  artifact: Artifact;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`artifact-row ${selected ? "selected" : ""}`} type="button" onClick={onSelect}>
      <span className={`file-badge ${artifact.type.toLowerCase()}`}>{iconForArtifact(artifact.type)}</span>
      <span>
        <strong>{artifact.title}</strong>
        <em>
          {artifact.type} - {artifact.status} - {artifact.owner} - {artifact.date}
        </em>
      </span>
      <MoreHorizontal size={17} />
    </button>
  );
}

function DecisionView({ decisions, onToggle }: { decisions: Decision[]; onToggle: (id: string) => void }) {
  return (
    <div className="decision-view">
      <div className="ideas-toolbar">
        <div>
          <span className="eyebrow">Decision log</span>
          <h2>Open governance actions</h2>
        </div>
      </div>
      {decisions.map((decision) => (
        <button className={`decision-row ${decision.status.toLowerCase()}`} type="button" key={decision.id} onClick={() => onToggle(decision.id)}>
          <ClipboardList size={18} />
          <span>
            <strong>{decision.title}</strong>
            <em>Owner: {decision.owner}</em>
          </span>
          <span>{decision.status === "Open" ? decision.due : decision.status}</span>
        </button>
      ))}
    </div>
  );
}

function PromptView({ onUsePrompt }: { onUsePrompt: (value: string) => void }) {
  const prompts = [
    "Summarize improvement ideas by impact, effort, and status for Steering Committee.",
    "Draft a concise nudge for owners of decisions older than seven days.",
    "Create a RAID summary from the last five project updates.",
  ];

  return (
    <div className="prompt-view">
      <div className="ideas-toolbar">
        <div>
          <span className="eyebrow">Prompt templates</span>
          <h2>Reusable PMO prompts</h2>
        </div>
      </div>
      <div className="prompt-grid">
        {prompts.map((prompt) => (
          <button className="prompt-card" type="button" key={prompt} onClick={() => onUsePrompt(prompt)}>
            <Sparkles size={18} />
            <span>{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TopbarPopover({
  menu,
  model,
  onModel,
  onClose,
  onToast,
}: {
  menu: Exclude<TopbarMenu, null>;
  model: string;
  onModel: (model: string) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const modelOptions = ["GPT 5.5", "Claude Opus 4.6", "Gemini Flash 3.5"];

  return (
    <div className={`topbar-popover ${menu}`}>
      <div className="popover-header">
        <strong>
          {menu === "notifications" ? "Notifications" : null}
          {menu === "people" ? "Team members" : null}
          {menu === "model" ? "Select model" : null}
          {menu === "workspace" ? "Workspace sources" : null}
          {menu === "attachment" ? "Attach to chat" : null}
        </strong>
        <button type="button" onClick={onClose} aria-label="Close panel">
          <X size={15} />
        </button>
      </div>

      {menu === "notifications" ? (
        <div className="popover-list">
          {["Decision taxonomy is still blocked", "RAID Copilot pilot due Friday", "New idea register generated"].map((item) => (
            <button type="button" key={item} onClick={() => onToast(item)}>
              <Bell size={16} />
              <span>{item}</span>
            </button>
          ))}
        </div>
      ) : null}

      {menu === "people" ? (
        <div className="member-list">
          {[
            ["Alex Morgan", avatarAlex, "PMO lead"],
            ["Jordan Lee", avatarJordan, "Governance"],
            ["Taylor Kim", avatarTaylor, "Artifacts"],
            ["Maya Chen", avatarMaya, "Intake"],
          ].map(([name, avatar, role]) => (
            <button type="button" key={name} onClick={() => onToast(`${name} profile opened`)}>
              <img src={avatar} alt={name} />
              <span>
                <strong>{name}</strong>
                <em>{role}</em>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {menu === "model" ? (
        <div className="popover-list">
          {modelOptions.map((option) => (
            <button
              className={option === model ? "active" : ""}
              type="button"
              key={option}
              onClick={() => {
                onModel(option);
                onToast(`${option} selected`);
                onClose();
              }}
            >
              <Bot size={16} />
              <span>{option}</span>
            </button>
          ))}
        </div>
      ) : null}

      {menu === "workspace" ? (
        <div className="popover-list">
          {["Pinned knowledge", "Final artifacts", "Decision log", "Prompt templates"].map((source) => (
            <button type="button" key={source} onClick={() => onToast(`${source} added as context`)}>
              <Folder size={16} />
              <span>{source}</span>
            </button>
          ))}
        </div>
      ) : null}

      {menu === "attachment" ? (
        <div className="popover-list">
          {["Upload status report", "Attach risk register", "Attach meeting notes"].map((source) => (
            <button type="button" key={source} onClick={() => onToast(`${source} queued`)}>
              <Paperclip size={16} />
              <span>{source}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SharePopover({ onToast }: { onToast: (message: string) => void }) {
  const options = [
    ["Create magic link", "Anyone with the link can view", Link2],
    ["Share with Team", "PMO Team", Users],
    ["Share with Project", "Vertex Hub QA Project", Folder],
  ] as const;

  return (
    <div className="share-popover">
      <h3>Share PMO Improvement Queue</h3>
      {options.map(([title, subtitle, Icon]) => (
        <button
          key={title}
          type="button"
          onClick={() => onToast(`${title} selected`)}
        >
          <Icon size={18} />
          <span>
            <strong>{title}</strong>
            <em>{subtitle}</em>
          </span>
          <ChevronRight size={16} />
        </button>
      ))}
      <div className="share-warning">
        <AlertTriangle size={15} />
        Links may grant access outside this project. Share responsibly.
      </div>
    </div>
  );
}

function AccessModal({
  accessLevel,
  onAccessLevel,
  onClose,
  onSave,
}: {
  accessLevel: "Read / Write" | "View only";
  onAccessLevel: (value: "Read / Write" | "View only") => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const members = [
    ["Alex Morgan", avatarAlex, "Owner"],
    ["Jordan Lee", avatarJordan, "Can edit"],
    ["Taylor Kim", avatarTaylor, "Can edit"],
    ["Maya Chen", avatarMaya, "Can view"],
  ];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal access-modal" aria-label="Manage team access">
        <div className="modal-header">
          <div>
            <span className="eyebrow">Team access</span>
            <h2>Manage PMO workspace access</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="access-choice">
          {(["Read / Write", "View only"] as const).map((level) => (
            <button
              className={accessLevel === level ? "active" : ""}
              type="button"
              key={level}
              onClick={() => onAccessLevel(level)}
            >
              {level === "Read / Write" ? <ShieldCheck size={18} /> : <CheckCircle2 size={18} />}
              <span>
                <strong>{level}</strong>
                <em>{level === "Read / Write" ? "Team can chat, add ideas, and update statuses." : "Team can view the prototype without editing state."}</em>
              </span>
            </button>
          ))}
        </div>

        <div className="member-list modal-members">
          {members.map(([name, avatar, role]) => (
            <div key={name}>
              <img src={avatar} alt={name} />
              <span>
                <strong>{name}</strong>
                <em>{role}</em>
              </span>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={onSave}>
            Save access
          </button>
        </div>
      </section>
    </div>
  );
}

function AddIdeaModal({
  form,
  onFormChange,
  onClose,
  onSubmit,
}: {
  form: typeof emptyForm;
  onFormChange: (value: typeof emptyForm) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={onSubmit} aria-label="Add improvement idea">
        <div className="modal-header">
          <div>
            <span className="eyebrow">Add idea</span>
            <h2>Capture PMO improvement</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <label>
          <span>Idea title</span>
          <input
            data-testid="idea-title"
            value={form.title}
            onChange={(event) => onFormChange({ ...form, title: event.target.value })}
            placeholder="Example: Meeting action item extractor"
            autoFocus
          />
        </label>

        <div className="form-grid">
          <label>
            <span>Category</span>
                  <select
                    aria-label="Idea category"
                    data-testid="idea-category"
                    value={form.category}
                    onChange={(event) => onFormChange({ ...form, category: event.target.value })}
                  >
              <option>Governance</option>
              <option>Risk and issue management</option>
              <option>Intake</option>
              <option>Planning</option>
              <option>Artifacts</option>
              <option>Change management</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              aria-label="Idea status"
              data-testid="idea-status"
              value={form.status}
              onChange={(event) => onFormChange({ ...form, status: event.target.value as IdeaStatus })}
            >
              {(Object.keys(statusMeta) as IdeaStatus[]).map((status) => (
                <option value={status} key={status}>
                  {statusMeta[status].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span>Expected impact</span>
          <select
            aria-label="Idea impact"
            data-testid="idea-impact"
            value={form.impact}
            onChange={(event) => onFormChange({ ...form, impact: event.target.value })}
          >
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </label>

        <label>
          <span>Summary</span>
          <textarea
            value={form.summary}
            onChange={(event) => onFormChange({ ...form, summary: event.target.value })}
            placeholder="What problem does this solve, and how would the assistant help?"
          />
        </label>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit" data-testid="submit-idea">
            <Plus size={16} />
            Add to queue
          </button>
        </div>
      </form>
    </div>
  );
}
