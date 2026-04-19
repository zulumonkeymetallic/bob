# CI/CD & Automated Distribution Guide

This repository is configured with an automated CI/CD pipeline to ensure that all changes pushed to the `main` branch are automatically built, tested, and distributed.

## 🚀 Automated Workflows

### 1. Web App Deployment (Firebase)
- **Workflow:** `.github/workflows/auto-deploy.yml`
- **Trigger:** Push to `main`
- **Action:** Builds the React app and deploys to Firebase Hosting.
- **Secrets Required:** `FIREBASE_TOKEN`

### 2. iOS/Mac Distribution (TestFlight)
- **Workflow:** `.github/workflows/testflight.yml`
- **Fastlane:** `fastlane/Fastfile`
- **Trigger:** Push to `main`
- **Action:** Signs the app using Apple Developer API keys, builds the `.ipa`, and uploads to TestFlight.
- **Secrets Required:** 
  - `APP_STORE_CONNECT_KEY_ID`
  - `APP_STORE_CONNECT_ISSUER_ID`
  - `APP_STORE_CONNECT_KEY_CONTENT` (.p8 key)

## 🛠️ Instructions for Agents & Developers

### Branching Strategy
- **Feature Branches:** Perform all development on feature branches (e.g., `feature/your-feature-name`).
- **Deployment:** Only merge to `main` when the code is stable and ready for distribution. Pushing to `main` **WILL** trigger a live deployment/TestFlight build.

### Adding New Files
If you add new files to the iOS project, ensure they are included in the Xcode project file (`.pbxproj`) so the automated build can see them.

### Local Testing
Before pushing to `main`, it is recommended to run the build locally if possible:
- **Web:** `cd react-app && npm run build`
- **iOS:** `fastlane release` (requires local environment setup)

## 🔒 Secrets Management
All sensitive credentials (Firebase tokens, Apple API keys) are stored in GitHub Secrets. Do not hardcode these values in any file. If secrets need updating, notify Jim.

---
*Configured by Max (OpenClaw Agent) — March 2026*
