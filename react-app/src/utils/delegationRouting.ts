/**
 * delegationRouting — the client's view of how a delegated prompt is routed.
 *
 * MIRRORS functions/aiDelegation.js. The keyword sets, the tie-break and the 'analysis'
 * default are copied from there deliberately: this exists so the Delegate to AI modal can
 * show which model a prompt will land on *before* it is queued, and a wrong preview is worse
 * than none. The server remains the authority — it re-classifies on every run — so a drift
 * here shows a misleading label, it does not misroute the work.
 *
 * If the tiers change, change them in both places. The alternative (a callable that just
 * classifies) costs a round trip per keystroke for a label.
 */

export type DelegationTier = 'simple' | 'research' | 'analysis' | 'image';
export type DelegationEngine = 'gemini' | 'hermes';

const SIMPLE_KW = ['write', 'draft', 'email', 'letter', 'format', 'summarise', 'summarize',
  'compose', 'outline', 'template', 'create', 'plan', 'list', 'describe', 'explain how to',
  'guide', 'step by step'];
const RESEARCH_KW = ['research', 'search', 'find', 'investigate', 'explore', 'discover',
  'lookup', 'look up', 'identify', 'who is', 'what is', 'when did', 'current status', 'latest'];
const ANALYSIS_KW = ['analyse', 'analyze', 'compare', 'evaluate', 'assess', 'review',
  'strategy', 'market', 'opportunities', 'landscape', 'deep dive', 'replicate', 'investment',
  'business model', 'feasibility', 'impact'];
const IMAGE_KW = ['image', 'picture', 'diagram', 'visual', 'illustration', 'generate image',
  'create image', 'draw', 'render'];

const countHits = (text: string, keywords: string[]) =>
  keywords.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);

export function classifyDelegationPrompt(prompt: string): DelegationTier {
  const text = String(prompt || '').toLowerCase();
  const scores: Record<DelegationTier, number> = {
    image: countHits(text, IMAGE_KW),
    research: countHits(text, RESEARCH_KW),
    analysis: countHits(text, ANALYSIS_KW),
    simple: countHits(text, SIMPLE_KW),
  };
  if (scores.image > 0) return 'image';
  const ranked = (['research', 'analysis', 'simple'] as const)
    .slice()
    .sort((a, b) => scores[b] - scores[a] || (a === 'research' ? -1 : b === 'research' ? 1 : 0));
  const winner = ranked[0];
  return scores[winner] > 0 ? winner : 'analysis';
}

/** `null` means the tier cannot be served — currently only image generation. */
export const TIER_MODELS: Record<DelegationTier, string | null> = {
  simple: 'gemini-2.5-flash',
  research: 'gemini-2.5-pro',
  analysis: 'gemini-2.5-pro',
  image: null,
};

/** Every revision runs on the top tier — a rejection is evidence the cheap tier was wrong. */
export const REVISION_MODEL = 'gemini-2.5-pro';

export const TIER_LABELS: Record<DelegationTier, string> = {
  simple: 'Simple — drafting and summarising',
  research: 'Research — find and synthesise',
  analysis: 'Analysis — evaluate and compare',
  image: 'Image — not supported',
};

/**
 * What the routing will do with this prompt, as a sentence for the modal.
 * `hasFeedback` is the rejection case: the tier is forced up regardless of the keywords.
 */
export function describeRouting(
  prompt: string,
  engine: DelegationEngine,
  forcedTier: DelegationTier | 'auto',
  hasFeedback = false,
): { tier: DelegationTier; model: string | null; summary: string } {
  const tier = forcedTier === 'auto' ? classifyDelegationPrompt(prompt) : forcedTier;
  if (engine === 'hermes') {
    return {
      tier,
      model: null,
      summary: `Hermes will classify this as ${tier} and pick its own backend on the Mac.`,
    };
  }
  const model = hasFeedback ? REVISION_MODEL : TIER_MODELS[tier];
  if (!model) {
    return { tier, model: null, summary: 'Image generation is not supported — this will be returned to the queue.' };
  }
  return {
    tier,
    model,
    summary: hasFeedback
      ? `Revision — runs on ${model} regardless of tier.`
      : `${TIER_LABELS[tier]} → ${model}.`,
  };
}

/** The delegation review state, labelled for the UI. Not a `status` lane — see types.ts. */
export const isAwaitingReview = (item: any) => String(item?.aiDelegationStatus || '') === 'human_review';
