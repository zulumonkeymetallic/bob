/**
 * version.ts
 *
 * Build-time constants injected by scripts/build.js via REACT_APP_* env vars.
 * Never hardcode version strings here — they are always derived from git + package.json.
 *
 * Local dev fallbacks are intentionally generic so they can never be confused
 * with a real deployed version.
 */

export const VERSION    = process.env.REACT_APP_VERSION          ?? '0.0.0-dev';
export const BUILD_HASH = process.env.REACT_APP_GIT_COMMIT       ?? 'dev';
export const BUILD_TIME = process.env.REACT_APP_BUILD_TIME       ?? new Date().toISOString();
export const BRANCH     = process.env.REACT_APP_GIT_BRANCH       ?? '';
export const PR_NUMBER  = process.env.REACT_APP_PR_NUMBER        ?? '';

// Legacy aliases kept for compatibility with existing consumers
export const BUILD_ID   = PR_NUMBER ? `pr.${PR_NUMBER}` : (BRANCH || 'dev');

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`🔗 Commit: ${BUILD_HASH}`);
console.log(`🌿 Branch: ${BRANCH || '(unknown)'}`);
console.log(`📅 Build time: ${BUILD_TIME}`);

export {};
