// Media Import Controller
// Creates Stories + Tasks from external media sources (Trakt, Steam, Goodreads-like inputs)

const admin = require('firebase-admin');
const { ensureTaskPoints } = require('../utils/taskPoints');

async function createStory(db, uid, payload) {
  const ref = db.collection('stories').doc();
  const now = Date.now();
  await ref.set(ensureTaskPoints({
    id: ref.id,
    ownerUid: uid,
    persona: 'personal',
    title: payload.title,
    description: payload.description || '',
    theme: payload.theme || 'Hobbies & Interests',
    theme_id: payload.theme_id || payload.theme || 'Hobbies & Interests',
    status: 0,
    priority: 2,
    points: 1,
    orderIndex: now,
    entry_method: payload.entry_method || 'import',
    source: payload.source || null,
    externalId: payload.externalId || null,
    metadata: payload.metadata || null,
    createdAt: now,
    updatedAt: now,
  }), { merge: true });
  return ref.id;
}

async function createTask(db, uid, storyId, payload) {
  const ref = db.collection('tasks').doc();
  const now = Date.now();
  await ref.set({
    id: ref.id,
    ownerUid: uid,
    persona: 'personal',
    title: payload.title,
    description: payload.description || '',
    storyId,
    status: 0,
    priority: 2,
    effort: payload.effort || 'S',
    estimated_duration: payload.estimated_duration || 30,
    entry_method: payload.entry_method || 'import',
    task_type: payload.task_type || 'task',
    theme: payload.theme || 'Hobbies & Interests',
    theme_id: payload.theme_id || payload.theme || 'Hobbies & Interests',
    confidence_score: payload.confidence_score || 0.8,
    source: payload.source || null,
    externalId: payload.externalId || null,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  return ref.id;
}

async function importFromSteam(uid, options = {}) {
  const db = admin.firestore();
  const snap = await db.collection('steam').where('ownerUid', '==', uid).get();
  const created = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const title = data.name || `Steam App ${data.appid}`;
    const externalId = String(data.appid);
    const storyId = await createStory(db, uid, {
      title,
      description: `Steam game: ${title}`,
      theme: 'Hobbies & Interests',
      source: 'steam',
      externalId,
      entry_method: 'import:steam',
      metadata: { steamAppId: data.appid || externalId, rating: data.rating ?? null },
    });
    await createTask(db, uid, storyId, {
      title: 'Play 30 mins',
      estimated_duration: 30,
      effort: 'S',
      entry_method: 'import:steam',
      task_type: 'task',
      theme: 'Hobbies & Interests',
      source: 'steam',
      externalId,
    });
    created.push({ storyId, externalId });
  }
  return { ok: true, created: created.length };
}

async function importFromTrakt(uid, options = {}) {
  const db = admin.firestore();
  const snap = await db.collection('trakt').where('ownerUid', '==', uid).get();
  const created = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (data.category && data.category !== 'watchlist') continue;
    if (data.lastConvertedStoryId) continue;
    const movie = data.movie || null;
    const show = data.show || null;
    const ids = show?.ids || movie?.ids || data.ids || {};
    if (!movie && !show && !Object.keys(ids).length) continue;
    const title = movie?.title || show?.title || data.title || 'Trakt Title';
    const externalId = String(ids.slug || ids.trakt || movie?.ids?.slug || show?.ids?.slug || data.id);
    const storyId = await createStory(db, uid, {
      title,
      description: `Imported from Trakt: ${title}`,
      theme: 'Hobbies & Interests',
      source: 'trakt',
      externalId,
      entry_method: 'import:trakt',
      metadata: {
        traktIds: ids,
        traktShowId: ids.trakt || null,
        traktSlug: ids.slug || null,
        rating: data.rating ?? null,
      },
    });
    await createTask(db, uid, storyId, {
      title: movie ? 'Watch movie' : 'Watch Ep. 1',
      estimated_duration: movie ? 120 : (data.runtime || 45),
      effort: movie ? 'L' : 'M',
      entry_method: 'import:trakt',
      task_type: 'task',
      theme: 'Hobbies & Interests',
      source: 'trakt',
      externalId,
    });
    await db.collection('trakt').doc(doc.id).set({
      lastConvertedStoryId: storyId,
      lastConvertedAt: admin.firestore.FieldValue.serverTimestamp(),
      persona: 'personal',
    }, { merge: true });
    created.push({ storyId, externalId });
  }
  return { ok: true, created: created.length };
}

async function importFromGoodreadsLike(uid, items = []) {
  const db = admin.firestore();
  const created = [];
  for (const b of items) {
    const title = b.title || b.bookTitle || 'Book';
    const externalId = String(b.id || b.isbn || title);
    const storyId = await createStory(db, uid, {
      title,
      description: `Reading: ${title}`,
      theme: 'Learning & Education',
      source: 'goodreads',
      externalId,
    });
    await createTask(db, uid, storyId, {
      title: 'Read 1 chapter',
      estimated_duration: 30,
      effort: 'S',
      entry_method: 'import:goodreads',
      task_type: 'task',
      theme: 'Learning & Education',
      source: 'goodreads',
      externalId,
    });
    created.push({ storyId, externalId });
  }
  return { ok: true, created: created.length };
}

module.exports = {
  importFromSteam,
  importFromTrakt,
  importFromGoodreadsLike,
};
