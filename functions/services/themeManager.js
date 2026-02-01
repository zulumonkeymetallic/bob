// Dynamic Theme Manager Service
// Loads user-defined themes from Firestore and exposes helpers

const admin = require('firebase-admin');

// Default themes fallback (colorId maps to Google Calendar palette 1–11)
const DEFAULT_THEMES = [
  { id: 'General', order: 0, colorId: '1' },                 // neutral lavender
  { id: 'Health & Fitness', order: 1, colorId: '11' },        // bold red
  { id: 'Career & Professional', order: 2, colorId: '7' },    // peacock blue
  { id: 'Finance & Wealth', order: 3, colorId: '10' },        // basil green
  { id: 'Learning & Education', order: 4, colorId: '3' },     // grape purple
  { id: 'Family & Relationships', order: 5, colorId: '4' },   // flamingo pink
  { id: 'Hobbies & Interests', order: 6, colorId: '9' },      // blueberry
  { id: 'Travel & Adventure', order: 7, colorId: '6' },       // tangerine
  { id: 'Home & Living', order: 8, colorId: '8' },            // graphite
  { id: 'Spiritual & Personal Growth', order: 9, colorId: '2' }, // sage
  { id: 'Chores', order: 10, colorId: '5' },                  // banana
  { id: 'Routine', order: 11, colorId: '5' },                 // banana
  { id: 'Dev Tasks', order: 12, colorId: '9' },               // blueberry
  { id: 'Work (Main Gig)', order: 13, colorId: '7' },         // peacock
  { id: 'Side Gig', order: 14, colorId: '2' },                // sage
  { id: 'Sleep', order: 15, colorId: '1' },                   // calm lavender
  { id: 'Random', order: 16, colorId: '8' },                  // graphite
];

async function loadThemesForUser(uid) {
  try {
    const db = admin.firestore();
    const doc = await db.collection('global_themes').doc(uid).get();
    if (doc.exists) {
      const data = doc.data() || {};
      const themes = Array.isArray(data.themes) ? data.themes : null;
      if (themes && themes.length) return themes;
    }
  } catch (e) {
    // fallthrough to defaults
  }
  return DEFAULT_THEMES;
}

function mapThemeLabelToId(label, themes = DEFAULT_THEMES) {
  if (!label) return 'General';
  const norm = String(label).trim().toLowerCase();
  const canonical = norm.replace(/[^a-z0-9]/g, '');
  const canonicalize = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const direct = themes.find((t) => canonicalize(t.id) === canonical);
  if (direct) return direct.id;
  if (['work', 'maingig', 'workmaingig'].includes(canonical)) return 'Work (Main Gig)';
  if (['sidegig', 'sidegigwork', 'sidegigproject'].includes(canonical) || norm.includes('side gig')) return 'Side Gig';
  if (['health', 'fitness', 'healthfitness'].includes(canonical)) return 'Health & Fitness';
  if (['career', 'professional', 'careerprofessional'].includes(canonical)) return 'Career & Professional';
  if (['finance', 'wealth', 'financewealth'].includes(canonical)) return 'Finance & Wealth';
  if (['learning', 'education', 'learningeducation'].includes(canonical)) return 'Learning & Education';
  if (['family', 'relationships', 'tribe'].includes(canonical)) return 'Family & Relationships';
  if (['hobbies', 'hobby', 'interests', 'hobbiesinterests'].includes(canonical)) return 'Hobbies & Interests';
  if (['travel', 'adventure', 'traveladventure'].includes(canonical)) return 'Travel & Adventure';
  if (['home', 'homeliving'].includes(canonical)) return 'Home & Living';
  if (['spiritual', 'growth', 'personalgrowth', 'spiritualpersonalgrowth'].includes(canonical)) return 'Spiritual & Personal Growth';
  if (['chores', 'chore'].includes(canonical)) return 'Chores';
  if (['rest', 'recovery', 'restandrecovery', 'restrecovery'].includes(canonical)) return 'Rest & Recovery';
  if (['sleep'].includes(canonical)) return 'Sleep';
  if (['random', 'misc'].includes(canonical)) return 'Random';
  if (['general'].includes(canonical)) return 'General';
  const partial = themes.find((t) => {
    const idCanonical = canonicalize(t.id);
    return idCanonical.includes(canonical) || canonical.includes(idCanonical);
  });
  return partial ? partial.id : 'General';
}

function mapThemeIdToLabel(id, themes = DEFAULT_THEMES) {
  if (!id) return 'General';
  const found = themes.find(t => String(t.id) === String(id));
  return found ? found.id : 'General';
}

function getGoogleColorForThemeId(themeId, themes = DEFAULT_THEMES) {
  const found = themes.find(t => String(t.id) === String(themeId));
  return found?.colorId || '1';
}

module.exports = {
  DEFAULT_THEMES,
  loadThemesForUser,
  mapThemeIdToLabel,
  mapThemeLabelToId,
  getGoogleColorForThemeId,
};
