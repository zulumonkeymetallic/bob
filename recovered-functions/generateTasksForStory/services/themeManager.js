// Dynamic Theme Manager Service
// Loads user-defined themes from Firestore and exposes helpers

const admin = require('firebase-admin');

// Default 12 core themes fallback
const DEFAULT_THEMES = [
  { id: 'General', order: 0, colorId: '1' },
  { id: 'Health & Fitness', order: 1, colorId: '10' },
  { id: 'Career & Professional', order: 2, colorId: '7' },
  { id: 'Finance & Wealth', order: 3, colorId: '11' },
  { id: 'Learning & Education', order: 4, colorId: '3' },
  { id: 'Family & Relationships', order: 5, colorId: '5' },
  { id: 'Hobbies & Interests', order: 6, colorId: '9' },
  { id: 'Travel & Adventure', order: 7, colorId: '7' },
  { id: 'Home & Living', order: 8, colorId: '8' },
  { id: 'Spiritual & Personal Growth', order: 9, colorId: '2' },
  { id: 'Chores', order: 10, colorId: '8' },
  { id: 'Routine', order: 11, colorId: '8' },
  { id: 'Dev Tasks', order: 12, colorId: '7' },
];

async function loadThemesForUser(uid) {
  try {
    const db = admin.firestore();
    const doc = await db.collection('theme_settings').doc(uid).get();
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
  const found = themes.find(t => String(t.id).trim().toLowerCase() === norm);
  return found ? found.id : 'General';
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

