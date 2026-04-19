# Bob — Goals/OKRs Kanban (no Goodreads) — 2025-08-10

## What this version does
- Goals ↔ OKRs linkage (by `goalId`; auto-linker via `goalTitle`).
- Kanban board (Backlog / Doing / Done) with drag-and-drop; cards colour-coded by area (growth/tribe/wealth/health/home).
- Bulk import of `.xlsx`, `.csv`, `.json` into: `goals`, `okrs`, `tasks`, `resources`, `trips`.
- Per-user profile storing **Trakt username** and **SteamID**.
- Buttons to trigger **Trakt** / **Steam** sync (currently stubs; wire after adding secrets).
- File uploads to Storage (optional checkbox): archives source files to `uploads/<uid>/<timestamp>-<filename>`.
- AI helpers: `classifyGoal`, `prioritizeBacklog`, `rankResources` (OpenAI via secret).
option 
## Setup
```bash
cd /Users/jim/Github/bob/functions
npm install
cd ..

# Set secrets (Blaze plan required)
firebase use bob20250810
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set TRAKT_CLIENT_ID
firebase functions:secrets:set TRAKT_CLIENT_SECRET
firebase functions:secrets:set TRAKT_ACCESS_TOKEN
firebase functions:secrets:set STEAM_WEB_API_KEY

# Deploy storage rules (for file uploads)
firebase deploy --only storage

# Deploy everything
firebase deploy
```

## Overwrite your existing folder
```bash
# Backup current project
mv /Users/jim/Github/bob /Users/jim/Github/bob_backup_$(date +%Y%m%d)

# Unzip this bundle (adjust path to your download)
unzip ~/Downloads/bob_full_no_goodreads.zip -d /Users/jim/Github/bob
```

## Push to GitHub
```bash
cd /Users/jim/Github/bob
git init
git add .
git commit -m "Bob full bundle: Goals/OKRs, Kanban, Imports, Storage, Trakt/Steam stubs"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/bob.git
git push -u origin main
```

## Using the app
- Open your hosting URL (e.g., https://bob20250810.web.app), Sign in with Google.
- Go to **/admin.html** to import spreadsheets and save your Trakt/Steam IDs.
- If your OKRs have only a goal title, run the linker in the browser console:
```js
firebase.functions("europe-west2").httpsCallable("linkOkrsToGoals")().then(x=>console.log(x.data));
```

## Notes
- Trakt/Steam callables are stubs until secrets are configured and fetchers implemented.
- If you want scheduled nightly syncs, I’ll add `onSchedule` functions and parsers for each platform.
