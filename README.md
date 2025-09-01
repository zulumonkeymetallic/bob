# BOB — AI-Enhanced Productivity Platform v3.5.2 🚀

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

## 🚀 Quick Start

### Using the Live Application
1. **Access:** Open [https://bob20250810.web.app](https://bob20250810.web.app)
2. **Sign In:** Use Google authentication (fixed v3.5.2 - now prompts for account selection)
3. **Start Managing:** Create goals, stories, tasks with new visualization tools

### For Developers
1. **Documentation:** Start with `Business Analyst AI/GETTING_STARTED.md`
2. **Setup:** Follow the one-command setup process
3. **Development:** See `Business Analyst AI/README.md` for complete guide
4. **Automation:** Use scripts in `Business Analyst AI/automation-scripts/`

## 📚 Documentation Navigation

- **📋 Project Overview:** `Business Analyst AI/README.md`
- **🚀 Getting Started:** `Business Analyst AI/GETTING_STARTED.md`  
- **📊 Project Status:** `Business Analyst AI/STATUS.md`
- **🎯 Action Plan:** `CRITICAL_ACTION_PLAN.md`
- **🔧 Automation:** `Business Analyst AI/automation-scripts/`
- **🏗️ Architecture:** `Business Analyst AI/requirements-traceability-matrix.md`

## 📞 Support & Contributing

- **Issues:** Create GitHub issues for bugs and feature requests
- **Development:** Follow the automation scripts for quality assurance
- **Documentation:** All documentation is in the unified structure under `Business Analyst AI/`

---

**🔥 PRIORITY:** See [CRITICAL_ACTION_PLAN.md](./CRITICAL_ACTION_PLAN.md) for current development priorities and next steps. 

**Version:** v3.5.2 - Goals Refinements + Comprehensive UI Scaffolding  
**Latest Features:** Goals Visualization, Calendar Integration, Sprint Management, Routes & Routines  
**Next Phase:** Full CRUD operations for all platform entities  
**Last Updated:** September 1, 2025

---

## 🎯 **PROJECT STATUS - v3.5.2 Scaffolding Complete**

**✅ CORE PLATFORM STABLE:** Goals refinements, authentication fixes, and comprehensive UI scaffolding  
**✅ NEW SCAFFOLDING:** Goals timeline, calendar integration, sprint management, route optimization  
**🔄 NEXT PHASE:** Backend API integration and real data connectivity  
**📋 ACTION PLAN:** See [CRITICAL_ACTION_PLAN.md](./CRITICAL_ACTION_PLAN.md) for priorities

### 🆕 **v3.5.2 New Components** 
- **Goals Visualization:** Interactive roadmap timeline with drag-and-drop scheduling
- **Calendar Integration:** Google/Outlook sync with goal linking and auto-task creation
- **Sprint Management:** Complete sprint lifecycle with retrospectives and burndown charts
- **Routes & Routines:** Daily optimization with efficiency tracking and navigation integration

### 📁 **Clean Documentation Structure**
- **Master Documentation:** `Business Analyst AI/` (unified requirements, guides, automation)
- **Developer Documentation:** `Developer AI/` (technical implementation details)  
- **Archived Files:** `archive/` (historical documentation preserved in compressed format)
- **Action Plan:** `CRITICAL_ACTION_PLAN.md` (current priorities and roadmap)

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

### **� Comprehensive UI Scaffolding**
- ✅ **Goals Visualization** - Interactive roadmap timeline with sprint markers
- ✅ **Calendar Integration** - Google/Outlook sync with goal linking
- ✅ **Sprint Management** - Complete Agile workflow with retrospectives
- ✅ **Routes & Routines** - Daily optimization with efficiency tracking

### **📱 Mobile & Accessibility**
- ✅ **Responsive Design** - All new components work seamlessly on mobile
- ✅ **Touch-Friendly Controls** - Optimized for tablet and phone interactions
- ✅ **Dark Mode Support** - Consistent theming across all new components

### **� Integration Ready**
- ✅ **API Scaffolding** - Ready for backend integration
- ✅ **Real-time Updates** - Firebase integration hooks prepared
- ✅ **External Services** - Calendar, mapping, and optimization service stubs

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
