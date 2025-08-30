# BOB — AI-Enhanced Productivity Platform v2.1.5 ✅

**Live Application:** https://bob20250810.web.agit push -u origin main
```

## 🚀 Quick Start

### Using the Live Application
1. **Access:** Open [https://bob20250810.web.app](https://bob20250810.web.app)
2. **Sign In:** Use Google authentication
3. **Start Managing:** Create tasks, set goals, organize with kanban boards

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

**🔥 PRIORITY:** See [CRITICAL_ACTION_PLAN.md](./CRITICAL_ACTION_PLAN.md) for current development priorities and next steps. Version:** 2.1.5 - Production Ready Core  
**Next Phase:** AI Integration & Enhancement  
**Last Updated:** August 30, 2025

## 🎯 **PROJECT STATUS - Post-Documentation Cleanup**

**✅ CORE PLATFORM STABLE:** Task management, UI/UX, and infrastructure complete  
**🔄 NEXT PHASE:** AI integration and advanced features in development  
**📋 ACTION PLAN:** See [CRITICAL_ACTION_PLAN.md](./CRITICAL_ACTION_PLAN.md) for priorities

### 📁 **Clean Documentation Structure**
- **Master Documentation:** `Business Analyst AI/` (unified requirements, guides, automation)
- **Developer Documentation:** `Developer AI/` (technical implementation details)  
- **Archived Files:** `archive/` (historical documentation preserved in compressed format)
- **Action Plan:** `CRITICAL_ACTION_PLAN.md` (current priorities and roadmap)

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
