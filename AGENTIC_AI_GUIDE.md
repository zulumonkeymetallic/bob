# 🤖 AGENTIC AI CODING AGENT GUIDE - BOB Platform

> **Last Updated**: December 5, 2025  
> **Version**: 4.5.0  
> **Purpose**: Comprehensive guide for AI coding agents working on the BOB productivity platform

---

## 🎯 QUICK REFERENCE FOR AI AGENTS

### **Essential Information**
- **Production URL**: https://bob.jc1.tech (alias for https://bob20250810.web.app)
- **Firebase Project**: bob20250810
- **Repository**: https://github.com/zulumonkeymetallic/bob
- **Current Version**: Check `/version.json` on live site
- **Test User**: `agenticaitestuser@jc1.tech` / `SecureAgenticAI2025!`

### **Key Directories**
```
/Users/jim/GitHub/bob/
├── react-app/          # React frontend (main application)
├── functions/          # Firebase Cloud Functions
├── scripts/            # Deployment and utility scripts
├── docs/               # Documentation
└── deployment-logs/    # Deployment history
```

---

## 🚀 DEPLOYMENT GUIDE

### **Primary Deployment Methods**

#### **1. Full Deployment with Version Management** (RECOMMENDED)
```bash
./scripts/deploy-with-version.sh
```

**Features**:
- ✅ Interactive version bumping (patch/minor/major)
- ✅ Automatic Git commits and tags
- ✅ Pre-deployment validation
- ✅ Post-deployment verification
- ✅ Deployment history tracking

**When to use**: For releases with version changes

#### **2. Quick Deploy** (For Bug Fixes)
```bash
./scripts/quick-deploy.sh
```

**Features**:
- ✅ Fast deployment (hosting only)
- ✅ No version bump
- ✅ Minimal overhead

**When to use**: For urgent bug fixes or when code changes are already committed

#### **3. Legacy Comprehensive Deploy** (With Testing)
```bash
./deploy-comprehensive.sh
```

**Features**:
- ✅ Selenium E2E testing
- ✅ Automated defect detection
- ✅ Full test reports

**When to use**: When comprehensive testing is required

---

## 📋 VERSION MANAGEMENT

### **Version Files to Keep in Sync**
1. `react-app/package.json` - Source of truth
2. `react-app/src/version.ts` - Runtime version
3. `react-app/build/version.json` - Deployed version info

### **Version Sync Scripts**
```bash
# Sync version across all files
node scripts/sync-version.js

# Check version alignment
node scripts/check-version-alignment.js

# Generate version.json (runs automatically during build)
node scripts/generate-version.js
```

### **Version Format**
- **Semantic Versioning**: `MAJOR.MINOR.PATCH`
- **Build Hash**: Descriptive label (e.g., `navigation-fix-4.5.1`)
- **Git Tag**: `vMAJOR.MINOR.PATCH`

---

## 🔧 DEVELOPMENT WORKFLOW

### **Making Code Changes**

1. **Make your changes** in the appropriate directory
   - Frontend: `react-app/src/`
   - Functions: `functions/src/`
   - Scripts: `scripts/`

2. **Test locally** (if possible)
   ```bash
   cd react-app
   npm start  # Runs on localhost:3000
   ```

3. **Deploy changes**
   ```bash
   # For bug fixes (no version bump)
   ./scripts/quick-deploy.sh
   
   # For features (with version bump)
   ./scripts/deploy-with-version.sh
   ```

4. **Verify deployment**
   ```bash
   # Check deployed version
   curl https://bob.jc1.tech/version.json | jq .
   
   # Test in browser
   open https://bob.jc1.tech
   ```

---

## 🧪 TESTING

### **Test User Credentials**
- **Email**: `agenticaitestuser@jc1.tech`
- **Password**: `SecureAgenticAI2025!`
- **Purpose**: For automated testing and validation

### **Manual Testing Checklist**
- [ ] Login works
- [ ] Navigation between pages works
- [ ] Goals/Stories/Tasks CRUD operations work
- [ ] No console errors
- [ ] Version displayed correctly (bottom left sidebar)

### **Automated Testing**
```bash
# Run Selenium E2E tests
python3 selenium_virtual_browser_test.py --browser firefox --headless

# Run React unit tests
cd react-app
npm test
```

---

## 🐛 DEBUGGING COMMON ISSUES

### **Issue: Navigation shows wrong page**
**Symptom**: Clicking menu items changes URL but shows wrong content  
**Cause**: React Router issues or stale component rendering  
**Fix**: Check `App.tsx` Routes configuration, remove any `key={location.pathname}` props

### **Issue: Version mismatch**
**Symptom**: Deployed version doesn't match local version  
**Cause**: Code not deployed or CDN caching  
**Fix**: 
```bash
# Verify what's deployed
curl https://bob.jc1.tech/version.json

# Deploy latest changes
./scripts/quick-deploy.sh

# Wait 30 seconds for CDN propagation
```

### **Issue**: Build fails**
**Symptom**: `npm run build` errors  
**Cause**: TypeScript errors or dependency issues  
**Fix**:
```bash
cd react-app
npm ci  # Clean install
npm run build
```

---

## 📁 KEY FILES FOR AI AGENTS

### **Configuration Files**
- `firebase.json` - Firebase hosting/functions config
- `firestore.rules` - Database security rules
- `firestore.indexes.json` - Database indexes
- `.firebaserc` - Firebase project configuration

### **Version Files**
- `react-app/package.json` - Version source of truth
- `react-app/src/version.ts` - Runtime version constants
- `deployment_history.json` - Deployment records

### **Documentation**
- `README.md` - Project overview
- `AI_DEPLOYMENT_GUIDE.md` - Legacy deployment guide
- `DEPLOYMENT_README.md` - Testing gates documentation
- **THIS FILE** - Comprehensive AI agent guide

---

## 🔐 AUTHENTICATION & SECURITY

### **Firebase Authentication**
- **Method**: Google OAuth, Email/Password
- **Test Account**: `agenticaitestuser@jc1.tech`
- **Firestore Rules**: Row-level security based on `ownerUid`

### **API Keys & Secrets**
- **Location**: Firebase Functions Secrets
- **Never commit**: API keys or credentials
- **Access**: Via Firebase Console or `firebase functions:secrets:list`

---

## 📊 MONITORING & LOGS

### **Deployment Logs**
```bash
# View recent deployments
ls -lt deployment-logs/ | head -10

# Check deployment history
cat deployment_history.json | jq .
```

### **Application Logs**
- **Frontend**: Browser console (F12)
- **Functions**: Firebase Console → Functions → Logs
- **Firestore**: Firebase Console → Firestore → Usage

### **Version Verification**
```bash
# Check deployed version
curl -s https://bob.jc1.tech/version.json | jq .

# Check local version
cat react-app/package.json | jq .version
```

---

## 🎨 CODEBASE STRUCTURE

### **Frontend (react-app/)**
```
src/
├── components/        # React components
├── contexts/          # React contexts (Auth, Theme, etc.)
├── hooks/             # Custom React hooks
├── services/          # API services
├── utils/             # Utility functions
├── types/             # TypeScript types
└── version.ts         # Version constants
```

### **Backend (functions/)**
```
src/
├── index.ts           # Main functions export
├── api/               # HTTP endpoints
├── scheduled/         # Cron jobs
└── triggers/          # Firestore triggers
```

---

## 🚨 CRITICAL RULES FOR AI AGENTS

### **DO**
✅ Always use `./scripts/quick-deploy.sh` for bug fixes  
✅ Always verify deployment with `curl https://bob.jc1.tech/version.json`  
✅ Always check console logs after deployment  
✅ Always test with `agenticaitestuser@jc1.tech` account  
✅ Always sync versions with `node scripts/sync-version.js`  
✅ Always commit changes before deploying (if using versioned deploy)

### **DON'T**
❌ Never deploy without testing locally first (if possible)  
❌ Never commit API keys or secrets  
❌ Never use `key={location.pathname}` on React Router Routes  
❌ Never deploy to production without verifying in browser  
❌ Never skip version alignment checks  
❌ Never modify `deployment_history.json` manually

---

## 🔄 DEPLOYMENT CHECKLIST

### **Pre-Deployment**
- [ ] Code changes tested locally
- [ ] No TypeScript errors
- [ ] No console errors
- [ ] Version files aligned (if doing versioned deploy)
- [ ] Changes committed to Git (if doing versioned deploy)

### **Deployment**
- [ ] Run appropriate deploy script
- [ ] Monitor deployment output for errors
- [ ] Wait for "Deployment complete" message

### **Post-Deployment**
- [ ] Verify version: `curl https://bob.jc1.tech/version.json`
- [ ] Test in browser: https://bob.jc1.tech
- [ ] Check for console errors
- [ ] Verify fix/feature works as expected
- [ ] Update documentation if needed

---

## 📞 GETTING HELP

### **Documentation**
- This file: Comprehensive AI agent guide
- `README.md`: Project overview
- `AI_DEPLOYMENT_GUIDE.md`: Legacy deployment info
- `DEPLOYMENT_README.md`: Testing gates

### **Debugging**
- Browser console: Check for JavaScript errors
- Firebase Console: Check Functions logs
- `deployment-logs/`: Check deployment history

### **Common Commands**
```bash
# Check current directory
pwd  # Should be /Users/jim/GitHub/bob

# Check Firebase project
firebase use  # Should show bob20250810

# Check Node/npm versions
node -v && npm -v

# Check Git status
git status

# View recent commits
git log --oneline -5
```

---

## 🎯 QUICK FIXES FOR COMMON TASKS

### **Fix Navigation Bug**
```bash
# 1. Edit App.tsx to remove problematic code
# 2. Deploy
./scripts/quick-deploy.sh
# 3. Verify
curl https://bob.jc1.tech/version.json
```

### **Update Version**
```bash
# 1. Use versioned deploy script
./scripts/deploy-with-version.sh
# 2. Choose version bump type
# 3. Script handles everything automatically
```

### **Rollback Deployment**
```bash
# 1. Check deployment history
cat deployment_history.json | jq .
# 2. Checkout previous version
git checkout <previous-commit>
# 3. Deploy
./scripts/quick-deploy.sh
```

---

## 📈 SUCCESS METRICS

### **Deployment Success**
- ✅ Exit code 0
- ✅ "Deployment complete" message
- ✅ Version matches on live site
- ✅ No console errors
- ✅ Application loads correctly

### **Code Quality**
- ✅ No TypeScript errors
- ✅ No ESLint errors
- ✅ Tests pass (if applicable)
- ✅ No security vulnerabilities

---

**🤖 Remember**: Always verify your changes in the browser after deployment. The version number in the bottom-left sidebar should match your deployed version.

**Last Updated**: December 5, 2025 | **Maintained by**: Agentic AI Coding Agents
