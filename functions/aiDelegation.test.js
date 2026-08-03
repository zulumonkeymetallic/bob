/**
 * The two deterministic halves of the delegation cycle: which tier a prompt lands in, and
 * whether it should never reach a model at all.
 *
 * These are ported from ~/.hermes/scripts/hermes_utils.py and run_delegation_cycle.py, so the
 * point of these tests is EQUIVALENCE — a prompt must land in the same tier and be rejected on
 * the same grounds wherever it is processed, or moving the cycle server-side quietly changes
 * what Jim gets back.
 */
// Mocked for the whole file: resolveWorkingPrompt makes a real model call on the revision
// path, and a unit test must never depend on Vertex credentials being present.
jest.mock('./utils/llmHelper', () => ({ callLLM: jest.fn() }));

const {
  classifyDelegationTask, shouldReject, selectEngine, resolveWorkingPrompt,
  TIER_MODELS, REVISION_MODEL, ENGINE_GEMINI, ENGINE_HERMES,
} = require('./aiDelegation');

describe('classifyDelegationTask', () => {
  it('routes an image request to the image tier, whatever else it says', () => {
    // Image wins outright on any hit, even against research/analysis keywords.
    expect(classifyDelegationTask('research and draw a diagram of the market')).toBe('image');
    expect(classifyDelegationTask('generate image of the logo')).toBe('image');
  });

  it('recognises research prompts', () => {
    expect(classifyDelegationTask('research the latest ServiceNow ITOM pricing')).toBe('research');
    expect(classifyDelegationTask('find out who is running the programme')).toBe('research');
  });

  it('recognises analysis prompts', () => {
    expect(classifyDelegationTask('evaluate the business model and assess feasibility')).toBe('analysis');
    expect(classifyDelegationTask('compare the two vendors')).toBe('analysis');
  });

  it('recognises simple drafting prompts', () => {
    expect(classifyDelegationTask('draft an email to the client')).toBe('simple');
    expect(classifyDelegationTask('write a letter')).toBe('simple');
  });

  it('breaks a research/analysis tie in favour of research', () => {
    // One hit each ('research', 'strategy'). The Python's sort key prefers research, because
    // an unanswered factual question is worse than an over-thought one.
    expect(classifyDelegationTask('research strategy')).toBe('research');
  });

  it('defaults to analysis when nothing matches, not to simple', () => {
    // Over-provisioning a cheap prompt costs pennies; under-provisioning a hard one produces
    // a document that has to be redone.
    expect(classifyDelegationTask('Thoughts on the Q3 numbers?')).toBe('analysis');
    expect(classifyDelegationTask('')).toBe('analysis');
    expect(classifyDelegationTask(null)).toBe('analysis');
  });

  it('is case-insensitive', () => {
    expect(classifyDelegationTask('RESEARCH the market')).toBe('research');
  });
});

describe('shouldReject', () => {
  it('declines anything needing a human body or hands', () => {
    const cases = [
      ['read: the Q3 board pack', 'Requires human reading'],
      ['watch: the keynote', 'Requires human viewing'],
      ['buy a new laptop stand', 'Physical purchase — requires human action'],
      ['call the dentist', 'Requires human phone call'],
      ['attend the standup', 'Requires in-person attendance'],
      ['sign the contract', 'Requires human signature'],
      ['take a photo of the meter', 'Requires human to take image'],
    ];
    for (const [prompt, reason] of cases) {
      const out = shouldReject(prompt);
      expect(out.reject).toBe(true);
      expect(out.reason).toBe(reason);
    }
  });

  it('only matches at the START of the prompt', () => {
    // "Draft a note to say I will call the dentist" is a writing job, not a phone call. The
    // patterns are anchored precisely so a mention of a physical act does not veto the task.
    expect(shouldReject('draft a note to say I will call the dentist').reject).toBe(false);
    expect(shouldReject('summarise what to buy for the trip').reject).toBe(false);
  });

  it('lets ordinary delegable work through', () => {
    ['research the market', 'draft an email', 'evaluate the two options', '']
      .forEach((p) => expect(shouldReject(p).reject).toBe(false));
  });

  it('is insensitive to case and surrounding whitespace', () => {
    expect(shouldReject('  CALL the dentist  ').reject).toBe(true);
  });
});

describe('model routing', () => {
  it('sends cheap work to flash and thinking work to pro', () => {
    expect(TIER_MODELS.simple).toBe('gemini-2.5-flash');
    expect(TIER_MODELS.research).toBe('gemini-2.5-pro');
    expect(TIER_MODELS.analysis).toBe('gemini-2.5-pro');
  });

  it('has no model for images, so the cycle rejects rather than pretending', () => {
    expect(TIER_MODELS.image).toBeNull();
  });

  it('routes every tier the classifier can return', () => {
    // A tier with no entry would be `undefined` and read as "unsupported" by accident.
    ['simple', 'research', 'analysis', 'image'].forEach((tier) => {
      expect(Object.prototype.hasOwnProperty.call(TIER_MODELS, tier)).toBe(true);
    });
  });
});

describe('selectEngine', () => {
  it('routes to hermes only on an explicit hermes value', () => {
    expect(selectEngine('hermes')).toBe(ENGINE_HERMES);
    expect(selectEngine('  HERMES  ')).toBe(ENGINE_HERMES);
  });

  it('defaults everything else — including unset — to the cloud engine', () => {
    // The default matters: every item flagged before aiDelegationEngine existed has no value,
    // and those must keep being processed by the engine that runs whether or not the Mac is on.
    [undefined, null, '', 'gemini', 'nonsense'].forEach((v) => {
      expect(selectEngine(v)).toBe(ENGINE_GEMINI);
    });
  });
});

describe('resolveWorkingPrompt', () => {
  const { callLLM } = require('./utils/llmHelper');

  beforeEach(() => {
    callLLM.mockReset();
  });

  it('passes the prompt through untouched with no feedback, at the classified tier', async () => {
    const out = await resolveWorkingPrompt({}, 'research the ITOM market', 'ST-1');
    expect(out.revised).toBe(false);
    expect(out.prompt).toBe('research the ITOM market');
    expect(out.taskType).toBe('research');
    expect(out.model).toBe(TIER_MODELS.research);
    // No feedback means no rewrite call — the revision pass must not cost a model call on
    // every ordinary delegation.
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('honours an explicit tier override instead of classifying', async () => {
    const out = await resolveWorkingPrompt({ aiDelegationType: 'simple' }, 'research the market', 'ST-1');
    expect(out.taskType).toBe('simple');
    expect(out.model).toBe(TIER_MODELS.simple);
  });

  it('rewrites the prompt from the rejection commentary', async () => {
    callLLM.mockResolvedValue('Name at least five UK suppliers with 2026 list prices.');
    const out = await resolveWorkingPrompt(
      { aiDelegationFeedback: 'Too generic — I need named suppliers.', aiOutput: 'previous doc' },
      'research suppliers',
      'ST-1',
    );
    expect(out.revised).toBe(true);
    expect(out.prompt).toBe('Name at least five UK suppliers with 2026 list prices.');
    // The rewrite must see the original prompt, the rejected output and the commentary —
    // rewriting from the commentary alone loses what the document was supposed to be.
    const sentToModel = callLLM.mock.calls[0][1];
    expect(sentToModel).toContain('research suppliers');
    expect(sentToModel).toContain('previous doc');
    expect(sentToModel).toContain('Too generic');
  });

  it('forces the top tier on a revision, whatever the prompt classifies as', async () => {
    // 'draft an email' is the cheap tier, but a rejected result is evidence the cheap tier
    // was the wrong call — so a revision must not go back to flash.
    callLLM.mockResolvedValue('Rewritten prompt.');
    const out = await resolveWorkingPrompt(
      { aiDelegationFeedback: 'Too shallow.' },
      'draft an email',
      'ST-1',
    );
    expect(out.revised).toBe(true);
    expect(out.model).toBe(REVISION_MODEL);
    expect(callLLM.mock.calls[0][2]).toBe(REVISION_MODEL);
  });

  it('falls back to appending the commentary when the rewrite call fails', async () => {
    // The rewrite is one extra model call; if it fails the revision must still happen with
    // the feedback incorporated, not silently re-run the prompt that was already rejected.
    callLLM.mockRejectedValue(new Error('vertex down'));
    const out = await resolveWorkingPrompt(
      { aiDelegationFeedback: 'Needs named suppliers.' },
      'research suppliers',
      'ST-1',
    );
    expect(out.revised).toBe(true);
    expect(out.prompt).toContain('research suppliers');
    expect(out.prompt).toContain('Needs named suppliers.');
  });

  it('keeps the original prompt when the rewrite comes back empty', async () => {
    callLLM.mockResolvedValue('   ');
    const out = await resolveWorkingPrompt(
      { aiDelegationFeedback: 'Not good enough.' },
      'research suppliers',
      'ST-1',
    );
    expect(out.prompt).toBe('research suppliers');
  });
});
