# BOB — AI-Enhanced Productivity Platform 🚀

## 🌐 **IMPORTANT URLS & ACCESS**

### **Production Application**
- **Live URL:** [https://bob20250810.web.app](https://bob20250810.web.app)
- **Test Mode:** [https://bob20250810.web.app?test_login=true](https://bob20250810.web.app?test_login=true)
- **AI Agent Test:** [https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true](https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true)

### **Firebase Console & Management**
- **Firebase Console:** [https://console.firebase.google.com/project/bob20250810/overview](https://console.firebase.google.com/project/bob20250810/overview)
- **Firestore Database:** [https://console.firebase.google.com/project/bob20250810/firestore](https://console.firebase.google.com/project/bob20250810/firestore)
- **Firebase Hosting:** [https://console.firebase.google.com/project/bob20250810/hosting](https://console.firebase.google.com/project/bob20250810/hosting)
- **Firebase Functions:** [https://console.firebase.google.com/project/bob20250810/functions](https://console.firebase.google.com/project/bob20250810/functions)

### **GitHub Repository**
- **Main Repository:** [https://github.com/zulumonkeymetallic/bob](https://github.com/zulumonkeymetallic/bob)
- **Latest Release:** [https://github.com/zulumonkeymetallic/bob/releases](https://github.com/zulumonkeymetallic/bob/releases)
- **Issues:** [https://github.com/zulumonkeymetallic/bob/issues](https://github.com/zulumonkeymetallic/bob/issues)
- **Pull Requests:** [https://github.com/zulumonkeymetallic/bob/pulls](https://github.com/zulumonkeymetallic/bob/pulls)

### **Local Issue Files (in repo)**
- Markdown issues: `issues/` (e.g., `issues/192-task-sprint-alignment.md`)
- Issue templates/seeds: `.gh-issue-bodies/`, `.gh-issue-comments/`, `.gh-new-issues/`
- Backlog snapshot: `issues.json`

## 🚀 Quick Start

### Using the Live Application
1. **Access:** Open [https://bob20250810.web.app](https://bob20250810.web.app)
2. **Sign In:** Use Google authentication (fixed v3.5.2 - now prompts for account selection)
3. **Start Managing:** Create goals, stories, tasks with new visualization tools

### For Developers
1. **Docs:** Start with `Business Analyst AI/GETTING_STARTED.md`
2. **Setup:** See root scripts (e.g., `setup-master.sh`) and `functions/`
3. **Integrations:** Review `docs/integrations/n8n/` for external orchestration
4. **Issues/Epics:** See Epics #229 (Finance) and #230 (Scheduling)

## 📚 Documentation Navigation

- Requirements & Guides: `Business Analyst AI/`
- Agent Guide: `AGENTS.md`
- Integrations (n8n): `docs/integrations/n8n/`
- Gaps & TODOs: `docs/ROADMAP_GAPS.md`
- Action Plan: `CRITICAL_ACTION_PLAN.md`

## 📞 Support & Contributing

- **Issues:** Create GitHub issues for bugs and feature requests
- **Development:** Follow the automation scripts for quality assurance
- **Documentation:** All documentation is in the unified structure under `Business Analyst AI/`

---

**🔥 PRIORITY:** See [CRITICAL_ACTION_PLAN.md](./CRITICAL_ACTION_PLAN.md) and Epics #229/#230. 

**Current Focus**
- Scheduling & Routines: Auto-scheduler, Daily Summary, Reminders bridge (#226, #218, #215, #227)
- Finance Platform: Monzo ingestion → Budget engine → Dashboards (#220–#225)
- Roadmap V3 polish and performance (#181, #203–#212)

**Last Reviewed:** September 20, 2025

---

## 🎯 **PROJECT STATUS - v3.5.2 Scaffolding Complete**

**✅ CORE PLATFORM STABLE:** Goals refinements, authentication fixes, and comprehensive UI scaffolding  
**✅ NEW SCAFFOLDING:** Goals timeline, calendar integration, sprint management, route optimization  
**🔄 NEXT PHASE:** Backend API integration and real data connectivity  
**📋 ACTION PLAN:** See [CRITICAL_ACTION_PLAN.md](./CRITICAL_ACTION_PLAN.md) for priorities

### Key Capabilities
- Roadmap (V2/V3): Interactive timeline with drag/resize, filters, presets
- Goals/Stories/Tasks: Firestore-backed CRUD, activity stream, AI helpers
- Scheduling: Theme Blocks Auto-Scheduler (hybrid with n8n)
- Messaging: Daily Priority Summary to Email/Telegram (n8n)
- Reminders: iOS Reminders sync (hybrid with n8n)
- Finance: Monzo → Budget Plan → Dashboards
- Health: MyFitnessPal ingestion → Macro insights
- Travel: Visited map → Stories

### 📁 Documentation Structure
- Requirements & Guides: `Business Analyst AI/`
- Product requirements: `gemini.md`
- Integrations (n8n): `docs/integrations/n8n/`
- Gaps & TODOs: `docs/ROADMAP_GAPS.md`
- Archives & Logs: `archive/`, `deployment-logs/`

## 🔼 Deployment

- One‑liner (prod): `./scripts/deploy.sh`
  - Builds CRA, prepares Functions, deploys to project `bob20250810`.
- Full deploy (rules + functions + hosting): `./scripts/deploy-full.sh`
- GitHub Actions (manual): Run workflow `.github/workflows/deploy-prod.yml` on branch `main`.


## 🆕 **What's New in Version 3.5.2**

### **🎯 Goals Refinements**
- ✅ **Enhanced Goals System** with improved CRUD operations
- ✅ **Visual Progress Tracking** with theme-based color coding
- ✅ **Goals-Stories-Tasks Hierarchy** with better relationship management
- ✅ **Priority and Status Management** with drag-and-drop reordering

### **🔧 Authentication Fixes**
- ✅ **Google OAuth Enhancement** - Fixed account selection prompt
- ✅ **Force Refresh Mechanism** - v3.5.2 prompts users to refresh for latest features
- ✅ **Session Management** - Improved logout and cache clearing

### **UI & Performance**
- ✅ **Goals Visualization** - Interactive roadmap timeline with sprint markers
- ✅ **Calendar Integration** - Google/Outlook sync with goal linking
- ✅ **Sprint Management** - Complete Agile workflow with retrospectives
- ✅ **Routes & Routines** - Daily optimization with efficiency tracking

### **📱 Mobile & Accessibility**
- ✅ **Responsive Design** - All new components work seamlessly on mobile
- ✅ **Touch-Friendly Controls** - Optimized for tablet and phone interactions
- ✅ **Dark Mode Support** - Consistent theming across all new components

### **Integrations**
- External I/O via n8n (Calendar, Reminders, Monzo, MFP). See `docs/integrations/n8n/`.
- OAuth/verification in Firebase Functions.

## What this platform does
- **Personal Productivity**: Goals ↔ Stories ↔ Tasks linkage with AI-powered prioritization
- **Work Management**: Projects → Tasks without goal dependencies  
- **Smart Planning**: AI calendar scheduling with constraint awareness
- **Entertainment Tracking**: Personal backlogs for games, movies, books
- **Mobile Optimization**: Touch-friendly interfaces with device detection
- **Visual Organization**: Interactive mind mapping for project visualization 
## Setup (Firebase)
```bash
cd /Users/jim/Github/bob/functions
npm install
cd ..

# Set secrets (Blaze plan required)
firebase use bob20250810
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set NYLAS_API_KEY
firebase functions:secrets:set TRAKT_CLIENT_ID
firebase functions:secrets:set TRAKT_CLIENT_SECRET
firebase functions:secrets:set TRAKT_ACCESS_TOKEN
firebase functions:secrets:set STEAM_WEB_API_KEY

# Deploy storage rules (for file uploads)
firebase deploy --only storage

# Deploy functions/hosting
firebase deploy --only functions,hosting
```

## Project Hygiene
- Use issues/epics for tracking. Avoid manual bundle overwrites.

## Using the app
- Open your hosting URL (e.g., https://bob20250810.web.app), Sign in with Google.
- Go to **/admin.html** to import spreadsheets and save your Trakt/Steam IDs.
- If your OKRs have only a goal title, run the linker in the browser console:
```js
firebase.functions("europe-west2").httpsCallable("linkOkrsToGoals")().then(x=>console.log(x.data));
```

## Notes
- Trakt/Steam/Goodreads require secrets and per‑integration enablement.
- n8n workflows are stubs; configure credentials and endpoints before enabling.
