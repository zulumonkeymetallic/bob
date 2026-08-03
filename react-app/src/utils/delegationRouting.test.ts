/**
 * delegationRouting mirrors functions/aiDelegation.js. These tests exist for one reason: to
 * catch the mirror drifting. If a prompt lands in a different tier here than it does on the
 * server, the Delegate to AI modal tells Jim it will run on flash and it runs on pro — a lie
 * about cost and quality, in the one place he goes to decide which engine to use.
 *
 * The expectations below are copied from functions/aiDelegation.test.js on purpose. Changing
 * one without the other is exactly the failure this is here to surface.
 */
import {
  REVISION_MODEL,
  TIER_MODELS,
  classifyDelegationPrompt,
  describeRouting,
  isAwaitingReview,
} from './delegationRouting';

describe('classifyDelegationPrompt', () => {
  it('routes an image request to the image tier, whatever else it says', () => {
    expect(classifyDelegationPrompt('research and draw a diagram of the market')).toBe('image');
    expect(classifyDelegationPrompt('generate image of the logo')).toBe('image');
  });

  it('recognises research prompts', () => {
    expect(classifyDelegationPrompt('research the latest ServiceNow ITOM pricing')).toBe('research');
    expect(classifyDelegationPrompt('find out who is running the programme')).toBe('research');
  });

  it('recognises analysis prompts', () => {
    expect(classifyDelegationPrompt('evaluate the business model and assess feasibility')).toBe('analysis');
    expect(classifyDelegationPrompt('compare the two vendors')).toBe('analysis');
  });

  it('recognises simple drafting prompts', () => {
    expect(classifyDelegationPrompt('draft an email to the client')).toBe('simple');
    expect(classifyDelegationPrompt('write a letter')).toBe('simple');
  });

  it('breaks a research/analysis tie in favour of research', () => {
    expect(classifyDelegationPrompt('research strategy')).toBe('research');
  });

  it('defaults to analysis when nothing matches, not to simple', () => {
    expect(classifyDelegationPrompt('the quick brown fox')).toBe('analysis');
  });

  it('is case-insensitive', () => {
    expect(classifyDelegationPrompt('RESEARCH THE MARKET')).toBe('research');
  });
});

describe('TIER_MODELS', () => {
  it('matches the server tiers', () => {
    expect(TIER_MODELS.simple).toBe('gemini-2.5-flash');
    expect(TIER_MODELS.research).toBe('gemini-2.5-pro');
    expect(TIER_MODELS.analysis).toBe('gemini-2.5-pro');
    expect(TIER_MODELS.image).toBeNull();
  });
});

describe('describeRouting', () => {
  it('names the model a cloud delegation will actually run on', () => {
    const out = describeRouting('draft an email', 'gemini', 'auto');
    expect(out.tier).toBe('simple');
    expect(out.model).toBe('gemini-2.5-flash');
    expect(out.summary).toContain('gemini-2.5-flash');
  });

  it('honours a forced tier over the classifier', () => {
    const out = describeRouting('research the market', 'gemini', 'simple');
    expect(out.tier).toBe('simple');
    expect(out.model).toBe('gemini-2.5-flash');
  });

  it('promises no specific model for Hermes, which picks its own backend', () => {
    const out = describeRouting('research the market', 'hermes', 'auto');
    expect(out.model).toBeNull();
    expect(out.summary).toContain('Hermes');
  });

  it('reports the top tier for a revision regardless of the prompt', () => {
    const out = describeRouting('draft an email', 'gemini', 'auto', true);
    expect(out.model).toBe(REVISION_MODEL);
  });

  it('says image generation is unsupported rather than naming a model', () => {
    const out = describeRouting('draw a diagram', 'gemini', 'auto');
    expect(out.model).toBeNull();
    expect(out.summary).toContain('not supported');
  });
});

describe('isAwaitingReview', () => {
  it('is true only for the canonical review state', () => {
    expect(isAwaitingReview({ aiDelegationStatus: 'human_review' })).toBe(true);
  });

  it('is false for a queued, revised or cleared item', () => {
    // Notably false for 'revision_requested': that item is back in the AI's hands, not Jim's.
    [undefined, null, '', 'queued', 'revision_requested', 'failed'].forEach((s) => {
      expect(isAwaitingReview({ aiDelegationStatus: s })).toBe(false);
    });
  });
});
