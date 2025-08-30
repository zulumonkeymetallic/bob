# BOB — AI-Powered Personal Productivity Platform v2.1.0 ⚠️

**Live Application:** https://bob20250810.web.app  
**Current Version:** 2.1.0 - Major Feature Release (Critical Issues Identified)  
**Next Version:** 2.1.1 - Critical Defect Fixes  
**Last Updated:** August 29, 2025

## 🔴 **CRITICAL ISSUES IDENTIFIED - Version 2.1.1 In Progress**

**Post-deployment testing has revealed critical defects that require immediate fixes:**

- **C17:** Emoji display issues (violates clean Material Design)
- **C18:** Red circle buttons not visible (critical functionality blocked) 
- **C19:** System status dashboard needs user-focused replacement
- **C20:** Cannot delete goals/stories/tasks (CRUD operations incomplete)
- **C21:** Kanban drag & drop still broken (library replacement needed)
- **C22:** Tasks not visible under stories (hierarchical view missing)

**Status:** Fixes in progress for Version 2.1.1 release

## 🆕 **What's New in Version 2.1.0**

### **Core Features**
- ✅ **Material Design UI** with dark mode accessibility fixes
- ✅ **Persona System** - Switch between Personal and Work contexts
- ✅ **Goals → Stories → Tasks** hierarchy with progress tracking
- ✅ **Kanban Board** with drag-and-drop functionality (mobile + desktop)
- ✅ **AI-Powered Planning** - Smart task prioritization and calendar scheduling
- ✅ **Separate Tasks List** view with advanced filtering

### **🆕 NEW: Personal Backlogs Manager** 
- Steam games library management
- Trakt movies and TV shows tracking  
- Books and custom collection support
- Grid/list views with status tracking
- Search and filter capabilities

### **🆕 NEW: Mobile-Optimized Interface**
- Auto-detected device-responsive design
- Touch-friendly Priority Dashboard (`/mobile-priorities`)
- One-tap task completion with priority filtering
- Urgent task alerts and daily focus view

### **🆕 NEW: Visual Canvas**
- Interactive goal-story-task mind mapping
- SVG-based visualization with zoom/pan controls
- Click-to-select nodes with relationship highlighting
- Visual project organization and planning tool

### **🔧 Enhanced Features**
- **Dark Mode Fixes** - All tables properly styled for accessibility
- **Improved Drag & Drop** - Enhanced mobile touch support
- **Device Detection** - Responsive UI adaptation
- **Better Mobile UX** - Touch-optimized interfaces throughout

## What this platform does
- **Personal Productivity**: Goals ↔ Stories ↔ Tasks linkage with AI-powered prioritization
- **Work Management**: Projects → Tasks without goal dependencies  
- **Smart Planning**: AI calendar scheduling with constraint awareness
- **Entertainment Tracking**: Personal backlogs for games, movies, books
- **Mobile Optimization**: Touch-friendly interfaces with device detection
- **Visual Organization**: Interactive mind mapping for project visualization 
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
