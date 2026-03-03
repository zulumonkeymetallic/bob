import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { AgentResponse } from '../services/agentClient';
import { buildRequestId, submitTranscriptAgentRequest } from '../services/agentClient';

export interface ProcessTextBannerState {
  status: 'processing' | 'success' | 'error';
  requestId: string;
  submittedText: string;
  result?: AgentResponse | null;
  error?: string | null;
  source?: string | null;
}

interface ProcessTextActivityContextValue {
  composerOpen: boolean;
  composerText: string;
  composerSource: string;
  banner: ProcessTextBannerState | null;
  openComposer: (seedText?: string, source?: string) => void;
  closeComposer: () => void;
  setComposerText: (value: string) => void;
  dismissBanner: () => void;
  submitComposer: (persona: string) => Promise<void>;
  submitText: (args: {
    text: string;
    persona: string;
    source: string;
    sourceProvidedId?: string;
  }) => Promise<AgentResponse | null>;
  reportAgentResult: (args: {
    requestId: string;
    submittedText: string;
    result: AgentResponse;
    source?: string;
  }) => void;
  reportAgentError: (args: {
    requestId: string;
    submittedText: string;
    error: string;
    source?: string;
  }) => void;
  reopenComposerFromBanner: () => void;
}

const ProcessTextActivityContext = createContext<ProcessTextActivityContextValue | undefined>(undefined);

export const ProcessTextActivityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerSource, setComposerSource] = useState('web_process_text');
  const [banner, setBanner] = useState<ProcessTextBannerState | null>(null);

  const openComposer = useCallback((seedText = '', source = 'web_process_text') => {
    setComposerText(seedText);
    setComposerSource(source);
    setComposerOpen(true);
  }, []);

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
  }, []);

  const dismissBanner = useCallback(() => {
    setBanner(null);
  }, []);

  const reportAgentResult = useCallback(({
    requestId,
    submittedText,
    result,
    source = 'web_process_text',
  }: {
    requestId: string;
    submittedText: string;
    result: AgentResponse;
    source?: string;
  }) => {
    setBanner({
      status: 'success',
      requestId,
      submittedText,
      result,
      error: null,
      source,
    });
  }, []);

  const reportAgentError = useCallback(({
    requestId,
    submittedText,
    error,
    source = 'web_process_text',
  }: {
    requestId: string;
    submittedText: string;
    error: string;
    source?: string;
  }) => {
    setBanner({
      status: 'error',
      requestId,
      submittedText,
      result: null,
      error,
      source,
    });
  }, []);

  const submitText = useCallback(async ({
    text,
    persona,
    source,
    sourceProvidedId,
  }: {
    text: string;
    persona: string;
    source: string;
    sourceProvidedId?: string;
  }) => {
    const value = String(text || '').trim();
    if (!value) return null;
    const requestId = sourceProvidedId || buildRequestId(source);

    setComposerOpen(false);
    setBanner({
      status: 'processing',
      requestId,
      submittedText: value,
      result: null,
      error: null,
      source,
    });

    try {
      const body = await submitTranscriptAgentRequest({
        text: value,
        persona,
        source,
        sourceProvidedId: requestId,
      });
      setBanner({
        status: 'success',
        requestId,
        submittedText: value,
        result: body,
        error: null,
        source,
      });
      setComposerText('');
      return body;
    } catch (error: any) {
      setBanner({
        status: 'error',
        requestId,
        submittedText: value,
        result: null,
        error: error?.message || 'Text processing failed',
        source,
      });
      throw error;
    }
  }, []);

  const submitComposer = useCallback(async (persona: string) => {
    await submitText({
      text: composerText,
      persona,
      source: composerSource || 'web_process_text',
    });
  }, [composerSource, composerText, submitText]);

  const reopenComposerFromBanner = useCallback(() => {
    if (!banner?.submittedText) return;
    openComposer(banner.submittedText, 'web_process_text');
  }, [banner, openComposer]);

  const value = useMemo<ProcessTextActivityContextValue>(() => ({
    composerOpen,
    composerText,
    composerSource,
    banner,
    openComposer,
    closeComposer,
    setComposerText,
    dismissBanner,
    submitComposer,
    submitText,
    reportAgentResult,
    reportAgentError,
    reopenComposerFromBanner,
  }), [
    banner,
    closeComposer,
    composerOpen,
    composerSource,
    composerText,
    dismissBanner,
    openComposer,
    reportAgentError,
    reportAgentResult,
    reopenComposerFromBanner,
    submitComposer,
    submitText,
  ]);

  return (
    <ProcessTextActivityContext.Provider value={value}>
      {children}
    </ProcessTextActivityContext.Provider>
  );
};

export function useProcessTextActivity() {
  const context = useContext(ProcessTextActivityContext);
  if (!context) {
    throw new Error('useProcessTextActivity must be used within a ProcessTextActivityProvider');
  }
  return context;
}
