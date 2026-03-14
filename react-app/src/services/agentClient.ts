import { httpsCallable } from 'firebase/functions';

import { auth, firebaseConfig, functions } from '../firebase';

export interface AgentEntityLink {
  id: string;
  ref: string;
  title: string;
  deepLink: string;
  existing?: boolean;
  updated?: boolean;
}

export interface AgentCalendarEventResult {
  id: string;
  title: string;
  start?: string | null;
  end?: string | null;
  when?: string | null;
  isAllDay?: boolean;
  location?: string | null;
  htmlLink?: string | null;
  status?: string | null;
}

export interface AgentPriorityItem extends AgentEntityLink {
  entityType: 'task' | 'story';
  reason?: string | null;
  priorityRank?: number | null;
  priority?: number | null;
  dueDateMs?: number | null;
}

export interface AgentReplanSummary {
  startDate: string;
  days: number;
  llmBlocksCreated: number;
  llmApplied?: boolean;
  plannedCount: number;
  unscheduledCount: number;
  pushSummary?: {
    created?: number;
    updated?: number;
    deleted?: number;
  } | null;
}

export interface AgentProcessedDocument {
  dateHeading?: string | null;
  oneLineSummary?: string | null;
  aiSummaryBullets?: string[];
  structuredEntry?: string | null;
  advice?: string | null;
  mindsetAnalysis?: {
    emotionalTone?: string | null;
    cognitiveStyle?: string | null;
    motivationsAndDrivers?: string | null;
    psychologicalStrengths?: string | null;
    potentialStressors?: string | null;
  } | null;
  entryMetadata?: {
    moodScore?: number | null;
    stressLevel?: number | null;
    energyLevel?: number | null;
    primaryThemes?: string[];
    cognitiveState?: string | null;
    sentiment?: 'negative' | 'neutral' | 'mixed' | 'positive' | string | null;
  } | null;
  fullTranscript?: string | null;
}

export interface AgentWarning {
  code?: string | null;
  scope?: string | null;
  message: string;
}

export interface AgentGoogleDocStatus {
  attempted?: boolean;
  appended?: boolean;
  status?: string | null;
  message?: string | null;
  url?: string | null;
}

export interface AgentResponse {
  ok: boolean;
  duplicate?: boolean;
  message?: string;
  mode?: string | null;
  intent?: string | null;
  confidence?: number | null;
  spokenResponse?: string | null;
  actionsExecuted?: string[];
  ingestionId?: string | null;
  entryType?: string | null;
  hasJournal?: boolean;
  resultType?: string | null;
  journalId?: string | null;
  docUrl?: string | null;
  processedAt?: string | null;
  processedDocument?: AgentProcessedDocument | null;
  dateHeading?: string | null;
  oneLineSummary?: string | null;
  aiSummaryBullets?: string[];
  structuredEntry?: string | null;
  advice?: string | null;
  mindsetAnalysis?: AgentProcessedDocument['mindsetAnalysis'];
  entryMetadata?: AgentProcessedDocument['entryMetadata'];
  fullTranscript?: string | null;
  warnings?: AgentWarning[];
  googleDoc?: AgentGoogleDocStatus | null;
  createdTasks?: AgentEntityLink[];
  createdStories?: AgentEntityLink[];
  calendarEvents?: AgentCalendarEventResult[];
  topPriorities?: AgentPriorityItem[];
  replan?: AgentReplanSummary | null;
  reply?: string | null;
}

const TRANSCRIPT_REGION = 'europe-west2';

export function buildTranscriptEndpoint() {
  return `https://${TRANSCRIPT_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/ingestTranscriptHttp`;
}

export function buildRequestId(prefix = 'web_agent') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function extractAgentErrorMessage(errorBody: any, fallback: string) {
  const details = errorBody?.details || errorBody?.error?.details || {};
  const message = errorBody?.error?.message || errorBody?.message || fallback;
  const pieces = [
    message,
    details?.ingestionId ? `Ingestion ID: ${details.ingestionId}` : null,
  ].filter(Boolean);
  return pieces.join(' ');
}

export async function submitTranscriptAgentRequest({
  text,
  persona,
  source,
  sourceProvidedId,
}: {
  text: string;
  persona: string;
  source: string;
  sourceProvidedId?: string;
}): Promise<AgentResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in required');
  }
  const token = await user.getIdToken();
  const response = await fetch(buildTranscriptEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      transcript: text,
      persona,
      source,
      sourceProvidedId: sourceProvidedId || buildRequestId(source),
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractAgentErrorMessage(body, 'Text processing failed'));
  }
  return (body || {}) as AgentResponse;
}

export async function submitAssistantAgentRequest({
  text,
  persona,
  sourceProvidedId,
}: {
  text: string;
  persona: string;
  sourceProvidedId?: string;
}): Promise<AgentResponse> {
  const callable = httpsCallable(functions, 'sendAssistantMessage');
  const response = await callable({
    message: text,
    persona,
    sourceProvidedId: sourceProvidedId || buildRequestId('assistant_ui'),
  });
  return (response.data || {}) as AgentResponse;
}
