const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

function isMainGigLabel(value) {
  const raw = String(value || '').toLowerCase();
  if (!raw) return false;
  if (raw.includes('workout')) return false;
  if (raw.includes('main gig') || raw.includes('work shift')) return true;
  return /\bwork\b/.test(raw);
}

function isMainGigBlock(block) {
  if (!block) return false;
  if (block.entityType === 'work_shift' || block.sourceType === 'work_shift_allocation') return true;
  const label = block.theme || block.category || block.title || '';
  return isMainGigLabel(label);
}

async function main() {
  const uid = process.argv[2] || '3L3nnXSuTPfr08c8DTXG5zYX37A2';
  const start = Date.parse('2026-03-12T00:00:00.000Z');
  const end = Date.parse('2026-03-12T23:59:59.999Z');

  const snap = await db
    .collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', start)
    .where('start', '<=', end)
    .get();

  const blocks = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.start || 0) - (b.start || 0));
  const work = blocks.filter(isMainGigBlock);
  const personal = blocks.filter((b) => String(b.persona || 'personal').toLowerCase() !== 'work');

  const overlaps = [];
  for (const p of personal) {
    for (const w of work) {
      if (p.id === w.id) continue;
      if ((p.end || 0) > (w.start || 0) && (p.start || 0) < (w.end || 0)) {
        overlaps.push({
          personal: {
            id: p.id,
            title: p.title || null,
            startIso: p.start ? new Date(p.start).toISOString() : null,
            endIso: p.end ? new Date(p.end).toISOString() : null,
            persona: p.persona || null,
            entityType: p.entityType || null,
            sourceType: p.sourceType || p.source || null,
            theme: p.theme || null,
            category: p.category || null,
            aiGenerated: p.aiGenerated === true,
          },
          work: {
            id: w.id,
            title: w.title || null,
            startIso: w.start ? new Date(w.start).toISOString() : null,
            endIso: w.end ? new Date(w.end).toISOString() : null,
            persona: w.persona || null,
            entityType: w.entityType || null,
            sourceType: w.sourceType || w.source || null,
            theme: w.theme || null,
            category: w.category || null,
            aiGenerated: w.aiGenerated === true,
          },
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        uid,
        total: blocks.length,
        workCount: work.length,
        personalCount: personal.length,
        overlapCount: overlaps.length,
        sample: blocks.slice(0, 50).map((b) => ({
          id: b.id,
          title: b.title || null,
          startIso: b.start ? new Date(b.start).toISOString() : null,
          endIso: b.end ? new Date(b.end).toISOString() : null,
          persona: b.persona || null,
          entityType: b.entityType || null,
          sourceType: b.sourceType || b.source || null,
          theme: b.theme || null,
          category: b.category || null,
          aiGenerated: b.aiGenerated === true,
          mainGig: isMainGigBlock(b),
        })),
        overlaps: overlaps.slice(0, 40),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
