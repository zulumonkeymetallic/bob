const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

async function main() {
  const uid = process.argv[2] || '3L3nnXSuTPfr08c8DTXG5zYX37A2';
  const snap = await db.collection('theme_allocations').doc(uid).get();
  if (!snap.exists) {
    console.log(JSON.stringify({ exists: false, uid }, null, 2));
    return;
  }

  const data = snap.data() || {};
  const allocations = Array.isArray(data.allocations) ? data.allocations : [];
  const weeklyOverrides = data.weeklyOverrides || {};

  const isWorkish = (a) => {
    const rawTheme = String(a.theme || '').toLowerCase();
    const rawSub = String(a.subTheme || '').toLowerCase();
    return (
      rawTheme.includes('work') ||
      rawTheme.includes('main gig') ||
      rawSub.includes('work') ||
      rawSub.includes('main gig') ||
      Number(a.theme) === 12
    );
  };

  const workAllocations = allocations.filter(isWorkish);
  const overrideSummary = Object.keys(weeklyOverrides).slice(-8).map((key) => {
    const list = Array.isArray(weeklyOverrides[key]) ? weeklyOverrides[key] : [];
    return {
      weekKey: key,
      total: list.length,
      workish: list.filter(isWorkish).length,
      sample: list.filter(isWorkish).slice(0, 4),
    };
  });

  console.log(
    JSON.stringify(
      {
        exists: true,
        uid,
        allocationsTotal: allocations.length,
        allocationsWorkish: workAllocations.length,
        allocationsWorkishSample: workAllocations.slice(0, 20),
        overrideSummary,
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
