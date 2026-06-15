import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pmoWorkspaceQueryKey, type WorkspaceMode } from "@/lib/pmo-data";
import { type RealtimeMutationEvent } from "@/lib/realtime-events";
import { getRealtimeClientId, realtimeLastEventKey } from "./shared";

type UseWorkspaceEventSourceInput = {
  enabled?: boolean;
  mode: WorkspaceMode;
  teamId?: string | null;
  userId: string;
};

export function useWorkspaceEventSource({ enabled = true, mode, teamId = null, userId }: UseWorkspaceEventSourceInput) {
  const queryClient = useQueryClient();
  const clientIdRef = useRef("");
  const lastAppliedEventIdRef = useRef(0);
  const seenEventIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (mode === "Team" && !teamId) return;

    const clientId = getRealtimeClientId();
    clientIdRef.current = clientId;
    const scopedTeamId = mode === "Team" ? teamId : null;
    const lastEventStorageKey = realtimeLastEventKey(mode, scopedTeamId, userId);
    const lastEventId = window.sessionStorage.getItem(lastEventStorageKey);
    lastAppliedEventIdRef.current = Number(lastEventId) || 0;
    const params = new URLSearchParams({ mode, clientId });
    if (scopedTeamId) params.set("teamId", scopedTeamId);
    if (lastEventId) params.set("lastEventId", lastEventId);

    const events = new EventSource(`/sse/workspace-events?${params.toString()}`);

    const invalidateWorkspace = () => queryClient.invalidateQueries({ queryKey: pmoWorkspaceQueryKey });
    const invalidateTeams = () => queryClient.invalidateQueries({ queryKey: ["my-teams"] });
    const invalidateProjects = () => queryClient.invalidateQueries({ queryKey: ["scoped-projects"] });
    const invalidateChats = () => queryClient.invalidateQueries({ queryKey: ["scoped-chats"] });

    events.addEventListener("mutation", (mutationEvent) => {
      try {
        const event = JSON.parse(mutationEvent.data) as RealtimeMutationEvent;
        const eventSourceId = Number((mutationEvent as MessageEvent).lastEventId);
        const deliveredEventId = Number.isSafeInteger(eventSourceId) && eventSourceId > 0 ? eventSourceId : event.id;
        if (deliveredEventId <= lastAppliedEventIdRef.current || seenEventIdsRef.current.has(deliveredEventId)) return;

        seenEventIdsRef.current.add(deliveredEventId);
        if (seenEventIdsRef.current.size > 500) {
          const oldest = seenEventIdsRef.current.values().next().value;
          if (typeof oldest === "number") seenEventIdsRef.current.delete(oldest);
        }
        lastAppliedEventIdRef.current = deliveredEventId;
        window.sessionStorage.setItem(lastEventStorageKey, String(deliveredEventId));

        if (event.sourceClientId && event.sourceClientId === clientIdRef.current) return;

        if (event.invalidates.includes("workspace")) void invalidateWorkspace();
        if (event.invalidates.includes("teams")) void invalidateTeams();
        if (event.invalidates.includes("projects")) void invalidateProjects();
        if (event.invalidates.includes("chats")) void invalidateChats();
      } catch (error) {
        console.warn("Could not apply workspace SSE mutation event.", error);
      }
    });

    events.addEventListener("stream-error", (errorEvent) => {
      console.warn("Workspace SSE stream reported an error.", (errorEvent as MessageEvent).data);
    });

    events.onerror = () => {
      if (events.readyState === EventSource.CLOSED) {
        void invalidateWorkspace();
        void invalidateProjects();
        void invalidateChats();
      }
    };

    return () => events.close();
  }, [enabled, mode, queryClient, teamId, userId]);
}
