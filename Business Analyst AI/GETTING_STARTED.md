# Getting Started - BOB Development Environment

**Version:** 2.1.5-working-complete  
**Date:** August 30, 2025  
**Audience:** New developers, contributors, and team members  

---

## 🚀 Quick Start

### Prerequisites Checklist
- [ ] **Node.js** 18+ installed
- [ ] **npm** or **yarn** package manager
- [ ] **Git** version control
- [ ] **Firebase CLI** (`npm install -g firebase-tools`)
- [ ] **VS Code** (recommended) with React/TypeScript extensions
- [ ] **Chrome** or **Firefox** for development/debugging

### One-Command Setup
```bash
# Clone and setup the project
git clone https://github.com/zulumonkeymetallic/bob.git
cd bob
npm install
npm run dev
```

---

## 🏗️ Environment Setup

### 1. Repository Setup
```bash
# Clone the repository
git clone https://github.com/zulumonkeymetallic/bob.git
cd bob

# Checkout the main development branch
git checkout react-ui
git pull origin react-ui
```

### 2. Firebase Project Setup
```bash
# Install Firebase CLI globally
npm install -g firebase-tools

# Login to Firebase
firebase login

# Select the project
firebase use bob20250810

# Verify project connection
firebase projects:list
```

### 3. React Application Setup
```bash
# Navigate to React app directory
cd react-app

# Install dependencies
npm install

# Verify installation
npm list --depth=0
```

### 4. Environment Variables
Create `.env.local` in the `react-app` directory:
```env
# Firebase Configuration
REACT_APP_FIREBASE_API_KEY=your_api_key_here
REACT_APP_FIREBASE_AUTH_DOMAIN=bob20250810.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=bob20250810
REACT_APP_FIREBASE_STORAGE_BUCKET=bob20250810.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id

# Development Settings
REACT_APP_ENVIRONMENT=development
REACT_APP_DEBUG_MODE=true
```

---

## 🏃 Running the Application

### Development Mode
```bash
# Start the development server
cd react-app
npm start

# Application will open at http://localhost:3000
# Hot reload enabled for live development
```

### Production Build
```bash
# Create production build
npm run build

# Test production build locally
npx serve -s build
```

### Firebase Functions (Optional)
```bash
# Navigate to functions directory
cd functions

# Install function dependencies
npm install

# Start functions emulator
firebase emulators:start --only functions
```

---

## 🛠️ Development Tools

### Recommended VS Code Extensions
```json
{
  "recommendations": [
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-typescript-next",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "ms-vscode.vscode-json",
    "firebase.vscode-firestore-rules"
  ]
}
```

### Debugging Setup
1. **React Developer Tools**: Install browser extension
2. **Firebase Debug**: Use Firebase console for real-time data
3. **Network Tab**: Monitor API calls and performance
4. **VS Code Debugger**: Configure for React debugging

### Code Quality Tools
```bash
# ESLint (already configured)
npm run lint

# Prettier formatting
npm run format

# Type checking
npm run type-check

# All quality checks
npm run validate
```

---

## 📂 Project Structure Overview

```
bob/
├── react-app/                 # Main React application
│   ├── public/               # Static assets
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── contexts/         # React Context providers
│   │   ├── services/         # API and Firebase services
│   │   ├── types/           # TypeScript type definitions
│   │   ├── styles/          # CSS and styling
│   │   └── App.tsx          # Main application component
│   ├── package.json         # Dependencies and scripts
│   └── tsconfig.json        # TypeScript configuration
├── functions/               # Firebase Functions (Node.js)
├── Business Analyst AI/     # BA requirements and documentation
├── Developer AI/           # Development documentation
├── firebase.json           # Firebase project configuration
└── README.md              # Project overview
```

### Key Directories
- **`src/components/`** - All React components (pages, UI elements, forms)
- **`src/contexts/`** - Global state management (Auth, Theme, etc.)
- **`src/services/`** - Firebase integration and API calls
- **`src/types/`** - TypeScript interfaces and type definitions

---

## 🔧 Configuration Details

### Firebase Configuration
The app uses Firebase for:
- **Authentication** - User login/logout
- **Firestore** - Real-time database
- **Hosting** - Static site hosting
- **Functions** - Server-side logic

### React Configuration
- **TypeScript** - Type safety and development experience
- **React Router** - Client-side routing
- **Bootstrap** - UI component library
- **Context API** - State management

### Build Configuration
- **Create React App** - Build tooling and dev server
- **ESLint** - Code linting and quality
- **Prettier** - Code formatting
- **Husky** - Git hooks for quality gates

---

## 📋 Development Workflow

### 1. Feature Development
```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "feat: implement your feature"

# Push and create PR
git push origin feature/your-feature-name
```

### 2. Code Quality Checks
```bash
# Before committing
npm run lint          # Check for linting errors
npm run type-check    # Verify TypeScript types
npm run test          # Run unit tests
npm run build         # Verify build succeeds
```

### 3. Testing Strategy
```bash
# Unit tests
npm test

# Watch mode for development
npm test -- --watch

# Coverage report
npm test -- --coverage
```

---

## 🧪 Testing Guide

### Running Tests
```bash
# All tests
npm test

# Specific test file
npm test -- TasksList.test.tsx

# Tests in watch mode
npm test -- --watch

# Coverage report
npm test -- --coverage --watchAll=false
```

### Writing Tests
```typescript
// Example component test
import { render, screen } from '@testing-library/react';
import { TasksList } from './TasksList';

test('renders task list component', () => {
  render(<TasksList />);
  const element = screen.getByText(/tasks/i);
  expect(element).toBeInTheDocument();
});
```

### Test Structure
- **Unit Tests** - Individual components and functions
- **Integration Tests** - Component interactions
- **E2E Tests** - Full user workflows (coming soon)

---

## 🚀 Deployment Process

### Local Testing
```bash
# Build and test locally
npm run build
npx serve -s build

# Verify at http://localhost:3000
```

### Firebase Deployment
```bash
# Deploy to Firebase Hosting
firebase deploy --only hosting

# Deploy everything (hosting + functions)
firebase deploy

# Deploy with confirmation
firebase deploy --confirm
```

### Pre-deployment Checklist
- [ ] All tests passing (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] No TypeScript errors (`npm run type-check`)
- [ ] Code formatted (`npm run format`)
- [ ] Git branch up to date

---

## 🐛 Common Issues & Solutions

### Node.js Version Issues
```bash
# Check Node version
node --version

# Use Node Version Manager if needed
nvm install 18
nvm use 18
```

### Firebase Connection Issues
```bash
# Re-authenticate
firebase logout
firebase login

# Check project status
firebase projects:list
firebase use bob20250810
```

### Package Installation Issues
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Alternative: use yarn
yarn install
```

### TypeScript Errors
```bash
# Check TypeScript configuration
npx tsc --noEmit

# Restart TypeScript service in VS Code
Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

---

## 📚 Learning Resources

### React & TypeScript
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [React Bootstrap Components](https://react-bootstrap.github.io/)

### Firebase
- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Guide](https://firebase.google.com/docs/firestore)
- [Firebase Auth Guide](https://firebase.google.com/docs/auth)

### Project-Specific
- [`Business Analyst AI/`](../Business%20Analyst%20AI/) - Requirements and design
- [`epics-stories.md`](epics-stories.md) - Feature specifications
- [`schema.md`](schema.md) - Database structure
- [`tests.md`](tests.md) - Testing guidelines

---

## 🤝 Getting Help

### Documentation
1. Check [`README.md`](README.md) for project overview
2. Review [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidelines
3. Read [`defects.md`](defects.md) for known issues

### Communication
- **Issues**: Create GitHub issues for bugs or feature requests
- **Questions**: Use GitHub Discussions for general questions
- **Documentation**: Update relevant documentation files

### Code Review
- All changes require pull request review
- Follow the templates in [`templates/`](templates/)
- Reference related issues and documentation

---

## ✅ Verification Checklist

### Environment Setup Complete
- [ ] Repository cloned and dependencies installed
- [ ] Firebase CLI configured and authenticated
- [ ] Development server starts successfully (`npm start`)
- [ ] Build process completes without errors (`npm run build`)
- [ ] Tests run successfully (`npm test`)

### Ready for Development
- [ ] IDE configured with recommended extensions
- [ ] Git workflow understood and tested
- [ ] Project structure and conventions reviewed
- [ ] Documentation bookmarked and accessible
- [ ] First test change committed successfully

---

**Setup Status**: Ready for development ✅  
**Next Steps**: Review [`CONTRIBUTING.md`](CONTRIBUTING.md) and start with a small issue  
**Support**: Create a GitHub issue if you encounter problems  

---

**Sources:**
- Developer AI: GETTING_STARTED.md (empty), PROJECT_STATUS.md
- Live deployment: BOB_v2.1.5_DEPLOYMENT_COMPLETE.md
- Repository structure: Current project analysis
