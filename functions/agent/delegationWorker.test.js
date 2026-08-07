/**
 * The two things in delegationWorker that fail SILENTLY rather than loudly.
 *
 * Both produce a perfectly well-formed email when they are wrong — one with an empty summary,
 * one crediting the wrong engine — so nothing errors and nothing alerts. That is exactly the
 * class of bug that survived here for months: the file read `aiDelegationNote`, which neither
 * engine writes, and every completion email went out with a bare document link.
 */

// The module registers Firestore triggers and calls admin.initializeApp() at require time, so
// both are stubbed — this file tests pure string logic, not deployment wiring.
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentUpdated: jest.fn(() => ({})) }));
jest.mock('firebase-admin', () => ({
  apps: [{}],
  initializeApp: jest.fn(),
  firestore: Object.assign(jest.fn(() => ({ collection: jest.fn() })), {
    FieldValue: { serverTimestamp: jest.fn() },
  }),
}));
jest.mock('../lib/email', () => ({ sendEmail: jest.fn() }));

const { _internal } = require('./delegationWorker');
const { summaryFor, engineLabel, escapeHtml } = _internal;

/** Exactly what aiDelegation.js and run_delegation_cycle.py both build. */
const aiOutput = (excerpt, model = 'vertex:gemini-2.5-pro') => [
  `Completed via AI delegation (${model}).`,
  'Google Doc: https://docs.google.com/document/d/abc123/edit',
  '',
  excerpt,
].join('\n');

describe('summaryFor', () => {
  it('strips the boilerplate and returns the document excerpt', () => {
    const data = { aiOutput: aiOutput('# Findings\n\nThe market is smaller than assumed.') };
    expect(summaryFor(data)).toBe('# Findings\n\nThe market is smaller than assumed.');
  });

  it('reads aiOutput when aiDelegationNote is absent — the whole point of the fix', () => {
    // Neither engine writes aiDelegationNote. Before the fallback this returned '' every time.
    expect(summaryFor({ aiOutput: aiOutput('Something useful') })).toBe('Something useful');
  });

  it('prefers an explicit note when one exists', () => {
    const data = { aiDelegationNote: 'Hand-written summary', aiOutput: aiOutput('Excerpt') };
    expect(summaryFor(data)).toBe('Hand-written summary');
  });

  it('falls back to the whole string if the output shape ever changes', () => {
    // A missing summary is worse than a noisy one, so an unrecognised shape is passed through
    // rather than filtered down to nothing.
    expect(summaryFor({ aiOutput: 'totally different shape' })).toBe('totally different shape');
  });

  it('returns empty when there is genuinely nothing to say', () => {
    expect(summaryFor({})).toBe('');
    expect(summaryFor({ aiOutput: '   ' })).toBe('');
  });

  it('does not mistake document text for boilerplate mid-paragraph', () => {
    // The filters are anchored, so a line merely mentioning the phrase survives.
    const data = { aiOutput: aiOutput('We reviewed the Google Doc: it was thorough.') };
    expect(summaryFor(data)).toBe('We reviewed the Google Doc: it was thorough.');
  });
});

describe('engineLabel', () => {
  it('names Hermes when the Mac ran it', () => {
    expect(engineLabel({ aiDelegationEngine: 'hermes', aiDelegationModel: 'sonar-pro' }))
      .toBe('Hermes (Mac), sonar-pro');
  });

  it('names the cloud for the gemini engine', () => {
    expect(engineLabel({ aiDelegationEngine: 'gemini', aiDelegationModel: 'vertex:gemini-2.5-pro' }))
      .toBe('BOB cloud, vertex:gemini-2.5-pro');
  });

  it('treats an unset engine as cloud, matching selectEngine in aiDelegation.js', () => {
    expect(engineLabel({})).toBe('BOB cloud');
  });
});

describe('escapeHtml', () => {
  it('neutralises markup in model output before it reaches the email body', () => {
    expect(escapeHtml('<script>alert("x")</script> & more'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more');
  });
});
