const { Readable } = require('stream');
const httpsV2 = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { callLLM } = require('./utils/llmHelper');
const { extractVideoId, fetchTranscript } = require('./utils/youtubeTranscript');
const { ensureStoryFolder, ensureTaskFolder, getDriveClient } = require('./driveHierarchy');

const GOOGLE_OAUTH_CLIENT_ID = defineSecret('GOOGLE_OAUTH_CLIENT_ID');
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
const OPENROUTER_API_KEY_SECRET = defineSecret('OPENROUTER_API_KEY');

function buildAnalysisPrompts(transcript, context) {
  const { entityTitle, entityDescription, acceptanceCriteria, goalTitle } = context;
  const acText = Array.isArray(acceptanceCriteria) && acceptanceCriteria.length
    ? acceptanceCriteria.map((ac, i) => `  ${i + 1}. ${ac}`).join('\n')
    : '  (none provided)';

  const system = `You are an AI assistant analysing YouTube video transcripts for a personal productivity system.
Produce a concise, structured analysis. Output ONLY valid JSON with these exact keys:
- summary: array of 3-5 short strings (bullet points)
- keyInsights: array of 3-5 short strings
- relevanceToEntity: string, 2-3 sentences linking the video content to the entity context
- suggestedActions: array of 2-4 concrete action strings

No markdown, no hashes, no emojis. Plain prose inside the string values.`;

  const user = `Context:
Title: ${entityTitle || '(untitled)'}
Description: ${entityDescription || '(none)'}
${goalTitle ? `Parent goal: ${goalTitle}` : ''}
Acceptance criteria:
${acText}

Transcript (first 8000 chars):
${String(transcript || '').slice(0, 8000)}

Return JSON only.`;

  return { system, user };
}

async function analyzeTranscript(transcript, context) {
  const { system, user } = buildAnalysisPrompts(transcript, context);
  try {
    const raw = await callLLM(system, user);
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[youtubeIngestion] analyzeTranscript failed:', e.message);
    return { summary: ['Transcript analysis unavailable'], keyInsights: [], relevanceToEntity: '', suggestedActions: [] };
  }
}

function buildDocText(videoId, transcript, analysis, entityRef, entityTitle, trackLanguage) {
  const header = `${entityRef || ''} — YouTube Transcript`.trim();
  const analysisLines = [
    'SUMMARY',
    ...(analysis.summary || []).map(b => `- ${b}`),
    '',
    'KEY INSIGHTS',
    ...(analysis.keyInsights || []).map(b => `- ${b}`),
    '',
    'RELEVANCE',
    analysis.relevanceToEntity || '(not available)',
    '',
    'SUGGESTED ACTIONS',
    ...(analysis.suggestedActions || []).map(a => `- ${a}`),
  ].join('\n');

  return [
    header,
    '',
    'VIDEO METADATA',
    `URL: https://www.youtube.com/watch?v=${videoId}`,
    `Entity: ${entityTitle || '(untitled)'}`,
    `Language: ${trackLanguage || 'unknown'}`,
    '',
    '----',
    '',
    'AI ANALYSIS',
    analysisLines,
    '',
    '----',
    '',
    'TRANSCRIPT',
    transcript,
  ].join('\n');
}

async function createTranscriptDoc(uid, folderId, docTitle, content) {
  const drive = await getDriveClient(uid);
  const stream = Readable.from([content]);

  const res = await drive.files.create({
    requestBody: {
      name: docTitle,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    },
    media: {
      mimeType: 'text/plain',
      body: stream,
    },
    fields: 'id,webViewLink',
  });

  return res.data.webViewLink || `https://docs.google.com/document/d/${res.data.id}/edit`;
}

async function ingestYouTubeUrl({ uid, entityType, entityId, videoUrl }) {
  const db = admin.firestore();
  const coll = entityType === 'task' ? 'tasks' : 'stories';
  const docRef = db.collection(coll).doc(entityId);

  await docRef.set(
    { youtubeIngestionStatus: 'in_progress', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    await docRef.set(
      { youtubeIngestionStatus: 'failed', youtubeIngestionError: 'Invalid YouTube URL', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return;
  }

  try {
    const entitySnap = await docRef.get();
    const entity = entitySnap.data() || {};

    let goalTitle = null;
    if (entity.goalId) {
      const goalSnap = await db.collection('goals').doc(entity.goalId).get().catch(() => null);
      goalTitle = goalSnap?.exists ? (goalSnap.data()?.title || null) : null;
    }

    const { transcript, trackLanguage } = await fetchTranscript(videoId);

    const analysis = await analyzeTranscript(transcript, {
      entityTitle: entity.title,
      entityDescription: entity.description,
      acceptanceCriteria: entity.acceptanceCriteria,
      goalTitle,
    });

    const folderId = entityType === 'task'
      ? await ensureTaskFolder(uid, entityId)
      : await ensureStoryFolder(uid, entityId);

    const entityRef = entity.ref || entityId;
    const docTitle = `${entityRef} — YouTube Transcript`;
    const content = buildDocText(videoId, transcript, analysis, entityRef, entity.title, trackLanguage);
    const docUrl = await createTranscriptDoc(uid, folderId, docTitle, content);

    // Cap stored transcript at 20KB to stay well within Firestore 1MB doc limit
    // youtubeDocumentLink is a separate field — documentLink is reserved for delegation output
    await docRef.set({
      youtubeTranscript: transcript.slice(0, 20000),
      youtubeVideoId: videoId,
      youtubeDocumentLink: docUrl,
      youtubeIngested: true,
      youtubeIngestionStatus: 'done',
      youtubeIngestionError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    try {
      await db.collection('activity_stream').add({
        entityId,
        entityType,
        activityType: 'automation_activity',
        userId: uid,
        ownerUid: uid,
        description: `YouTube transcript ingested and analysed — ${docUrl}`,
        source: 'youtube_ingestion',
        persona: entity.persona || 'personal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('[youtubeIngestion] activity stream write failed:', e.message);
    }

    console.info(`[youtubeIngestion] done — ${entityType} ${entityId} → ${docUrl}`);
  } catch (error) {
    console.error(`[youtubeIngestion] failed — ${entityType} ${entityId}:`, error.message);
    await docRef.set({
      youtubeIngestionStatus: 'failed',
      youtubeIngestionError: String(error.code || error.message || 'Unknown error').slice(0, 500),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }
}

exports.ingestYouTubeUrlHttp = httpsV2.onCall({
  secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, OPENROUTER_API_KEY_SECRET],
  timeoutSeconds: 300,
  memory: '512MiB',
}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');

  const { entityType, entityId, videoUrl } = request.data || {};
  if (!entityType || !entityId || !videoUrl) {
    throw new httpsV2.HttpsError('invalid-argument', 'entityType, entityId, and videoUrl are required');
  }
  if (!['story', 'task'].includes(entityType)) {
    throw new httpsV2.HttpsError('invalid-argument', 'entityType must be "story" or "task"');
  }

  const coll = entityType === 'task' ? 'tasks' : 'stories';
  await admin.firestore().collection(coll).doc(entityId).set(
    { youtubeIngested: false, youtubeIngestionStatus: null, youtubeIngestionError: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  await ingestYouTubeUrl({ uid, entityType, entityId, videoUrl });

  const snap = await admin.firestore().collection(coll).doc(entityId).get();
  const data = snap.data() || {};
  return { status: data.youtubeIngestionStatus, youtubeDocumentLink: data.youtubeDocumentLink || null };
});

module.exports = Object.assign(module.exports, { ingestYouTubeUrl });
