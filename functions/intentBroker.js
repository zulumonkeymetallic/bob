const httpsV2 = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const SNAPSHOT_COLLECTION = 'global_hierarchy_snapshots';
const PROMPT_SET_VERSION = 'v1';
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'over', 'under', 'about', 'will', 'have',
  'want', 'need', 'make', 'build', 'create', 'plan', 'focus', 'goal', 'goals', 'next', 'then', 'than', 'when',
  'what', 'why', 'how', 'can', 'could', 'should', 'would', 'to', 'of', 'in', 'on', 'a', 'an', 'is', 'are'
]);

function buildPromptBank() {
  const openings = [
    'What outcome would make this',
    'If this succeeds, what changes in',
    'What would you like to be true in',
    'What are you trying to unlock in',
    'What would progress look like for',
    'Which constraint is most blocking',
    'What would feel like a breakthrough for',
    'What are you underestimating in',
    'What should be deprioritized to accelerate',
    'What would be a realistic win for',
  ];
  const domains = [
    'health', 'fitness', 'sleep', 'career', 'income', 'savings', 'family', 'home', 'learning', 'business',
    'writing', 'productivity', 'calendar', 'focus', 'stress', 'recovery', 'relationships', 'habits', 'projects', 'finances'
  ];
  const horizons = [
    'this week', 'the next 14 days', 'this sprint', 'this month', 'this quarter',
    'the next 90 days', 'the next 6 months', 'this year', 'the next year', 'the next 3 years'
  ];
  const framings = [
    'with your current schedule',
    'without adding more than 5 hours per week',
    'while protecting recovery',
    'while staying inside budget guardrails',
    'while keeping family commitments stable',
    'with the least operational overhead',
    'with strict quality standards',
    'with clear KPI evidence',
    'with a realistic risk buffer',
    'with calendar-first execution'
  ];

  const prompts = [];
  let idCounter = 1;
  for (const opening of openings) {
    for (const domain of domains) {
      for (const horizon of horizons) {
        for (const framing of framings) {
          prompts.push({
            id: `pb_${String(idCounter).padStart(4, '0')}`,
            text: `${opening} ${domain} by ${horizon} ${framing}?`,
          });
          idCounter += 1;
        }
      }
    }
  }
  return prompts;
}

const PROMPT_BANK = buildPromptBank();

function samplePrompts(bank, count = 3) {
  const copy = [...bank];
  const chosen = [];
  for (let i = 0; i < count && copy.length; i += 1) {
    const idx = Math.floor(Math.random() * copy.length);
    chosen.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return chosen;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function scoreGoal(goal, tokens) {
  const haystack = `${goal.title || ''} ${goal.ref || ''} ${(goal.kpis || []).map((k) => k?.name || '').join(' ')}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function proposeNewGoals(visionText, tokens) {
  const base = (visionText || '').trim();
  const keyword = tokens.slice(0, 4).join(' ');
  const title = base.length > 6 ? base : `New focus area: ${keyword || 'strategic objective'}`;
  return [
    {
      tag: 'NEW',
      title: title.slice(0, 120),
      rationale: 'No strong existing goal match found in snapshot. Recommend creating a new goal candidate.',
      confidence: 0.55,
    },
  ];
}

async function loadSnapshotGoals(db, uid) {
  const snap = await db.collection(SNAPSHOT_COLLECTION).doc(uid).get();
  if (!snap.exists) return { goals: [], generatedAt: 0, stale: true, snapshotVersion: null };
  const data = snap.data() || {};
  const goals = data?.hierarchy?.goals || [];
  const generatedAt = Number(data.generatedAt || 0);
  const staleAfterMs = Number(data.staleAfterMs || 6 * 60 * 60 * 1000);
  const stale = !generatedAt || (Date.now() - generatedAt) > staleAfterMs;
  return {
    goals,
    generatedAt,
    stale,
    snapshotVersion: data.snapshotVersion || null,
  };
}

const getIntentBrokerPrompts = httpsV2.onCall({ region: 'europe-west2', memory: '256MiB' }, async (req) => {
  if (!req.auth?.uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');
  }
  const prompts = samplePrompts(PROMPT_BANK, 3);
  return {
    ok: true,
    promptSetVersion: PROMPT_SET_VERSION,
    promptBankSize: PROMPT_BANK.length,
    prompts,
  };
});

const intentBrokerSuggestFocus = httpsV2.onCall({ region: 'europe-west2', memory: '512MiB' }, async (req) => {
  if (!req.auth?.uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = req.auth.uid;
  const visionText = String(req.data?.visionText || '').trim();
  const selectedPromptId = String(req.data?.selectedPromptId || '').trim();
  const promptIds = Array.isArray(req.data?.promptIds) ? req.data.promptIds.map((x) => String(x)) : [];

  if (!visionText) {
    throw new httpsV2.HttpsError('invalid-argument', 'visionText is required');
  }

  const db = admin.firestore();
  const snapshot = await loadSnapshotGoals(db, uid);
  let goals = snapshot.goals;

  if (!goals.length) {
    const goalsSnap = await db.collection('goals').where('ownerUid', '==', uid).limit(200).get();
    goals = goalsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  }

  const tokens = tokenize(visionText);
  const matches = goals
    .map((goal) => ({
      goalId: goal.id,
      title: goal.title || 'Untitled goal',
      ref: goal.ref || null,
      score: scoreGoal(goal, tokens),
      tag: 'EXISTING',
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const proposals = (!matches.length || matches[0].score < 2) ? proposeNewGoals(visionText, tokens) : [];

  const intakeRef = await db.collection('intent_broker_intakes').add({
    ownerUid: uid,
    visionText,
    selectedPromptId: selectedPromptId || null,
    promptIds,
    promptSetVersion: PROMPT_SET_VERSION,
    snapshotVersion: snapshot.snapshotVersion,
    snapshotGeneratedAt: snapshot.generatedAt || null,
    snapshotAgeMs: snapshot.generatedAt ? (Date.now() - snapshot.generatedAt) : null,
    snapshotStale: !!snapshot.stale,
    goalsScanned: goals.length,
    matchesCount: matches.length,
    proposalsCount: proposals.length,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('intent_broker_metrics').doc(uid).set({
    ownerUid: uid,
    totalIntakes: admin.firestore.FieldValue.increment(1),
    lastIntakeAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSnapshotAgeMs: snapshot.generatedAt ? (Date.now() - snapshot.generatedAt) : null,
    lastMatchesCount: matches.length,
    lastProposalsCount: proposals.length,
  }, { merge: true });

  return {
    ok: true,
    intakeId: intakeRef.id,
    snapshotMeta: {
      snapshotVersion: snapshot.snapshotVersion,
      generatedAt: snapshot.generatedAt,
      stale: snapshot.stale,
      goalsScanned: goals.length,
    },
    matches,
    proposals,
  };
});

/**
 * recordIntentFocusConversion
 *
 * Called by the frontend when a user selects a focus goal from Intent Broker suggestions.
 * Records the conversion event against the original intake and updates the per-user metrics.
 *
 * data: { intakeId, selectedGoalId, selectedGoalTitle? }
 */
const recordIntentFocusConversion = httpsV2.onCall({ region: 'europe-west2' }, async (req) => {
  if (!req.auth?.uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');
  }
  const uid = req.auth.uid;
  const { intakeId, selectedGoalId, selectedGoalTitle } = req.data || {};

  if (!intakeId || typeof intakeId !== 'string') {
    throw new httpsV2.HttpsError('invalid-argument', 'intakeId is required');
  }
  if (!selectedGoalId || typeof selectedGoalId !== 'string') {
    throw new httpsV2.HttpsError('invalid-argument', 'selectedGoalId is required');
  }

  const db = admin.firestore();
  const intakeRef = db.collection('intent_broker_intakes').doc(intakeId);
  const intakeSnap = await intakeRef.get();

  // Verify the intake belongs to this user
  if (!intakeSnap.exists || intakeSnap.data()?.ownerUid !== uid) {
    throw new httpsV2.HttpsError('not-found', 'Intake not found or access denied');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await Promise.all([
    intakeRef.set(
      { convertedAt: now, convertedGoalId: selectedGoalId, convertedGoalTitle: selectedGoalTitle || null },
      { merge: true }
    ),
    db.collection('intent_broker_metrics').doc(uid).set(
      {
        ownerUid: uid,
        totalConversions: admin.firestore.FieldValue.increment(1),
        lastConversionAt: now,
        lastConversionIntakeId: intakeId,
        lastConvertedGoalId: selectedGoalId,
        lastConvertedGoalTitle: selectedGoalTitle || null,
      },
      { merge: true }
    ),
  ]);

  return { ok: true, intakeId, selectedGoalId };
});

module.exports = {
  getIntentBrokerPrompts,
  intentBrokerSuggestFocus,
  recordIntentFocusConversion,
};
