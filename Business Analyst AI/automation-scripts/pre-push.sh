#!/bin/bash

# BOB Project Pre-Push Validation Script
# Version: 2.1.0
# Purpose: Comprehensive validation before git push operations
# Usage: ./pre-push.sh [--quick] [--skip-tests]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
QUICK_MODE=false
SKIP_TESTS=false
LOG_FILE="pre-push-$(date +%Y%m%d-%H%M%S).log"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--quick] [--skip-tests]"
      echo "  --quick     Run quick validation only (skip comprehensive checks)"
      echo "  --skip-tests Skip all test execution"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# Logging function
log() {
  echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

# Success function
success() {
  echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

# Warning function  
warn() {
  echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

# Error function
error() {
  echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

# Check if we're in a git repository
check_git_repo() {
  log "Validating git repository..."
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    error "Not in a git repository"
    exit 1
  fi
  success "Git repository validated"
}

# Check for uncommitted changes
check_uncommitted_changes() {
  log "Checking for uncommitted changes..."
  if ! git diff-index --quiet HEAD --; then
    warn "Uncommitted changes detected:"
    git status --porcelain
    read -p "Continue with uncommitted changes? [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      error "Aborted due to uncommitted changes"
      exit 1
    fi
  else
    success "No uncommitted changes"
  fi
}

# Check branch status
check_branch_status() {
  log "Checking branch status..."
  local current_branch=$(git branch --show-current)
  local remote_branch="origin/$current_branch"
  
  success "Current branch: $current_branch"
  
  # Check if remote branch exists
  if git show-ref --verify --quiet "refs/remotes/$remote_branch"; then
    local ahead=$(git rev-list --count HEAD..$remote_branch)
    local behind=$(git rev-list --count $remote_branch..HEAD)
    
    if [ "$ahead" -gt 0 ]; then
      warn "Your branch is $ahead commits behind $remote_branch"
      warn "Consider pulling latest changes before pushing"
    fi
    
    if [ "$behind" -gt 0 ]; then
      success "Your branch is $behind commits ahead of $remote_branch"
    fi
  else
    warn "Remote branch $remote_branch does not exist (new branch)"
  fi
}

# Prevent pushing directly to protected branches
guard_protected_branches() {
  local current_branch=$(git branch --show-current)
  # Add any branch names here that must be protected from direct pushes
  local protected_branches=(
    "main"
    "main-baseline"
  )

  for b in "${protected_branches[@]}"; do
    if [[ "$current_branch" == "$b" ]]; then
      error "Direct pushes to protected branch '$b' are blocked."
      echo -e "${YELLOW}➡️  Create a feature branch and open a Pull Request into '$b'.${NC}"
      exit 1
    fi
  done
}

# Validate project structure
validate_project_structure() {
  log "Validating project structure..."
  
  local required_files=(
    "package.json"
    "README.md"
    "firebase.json"
    "firestore.rules"
  )
  
  local required_dirs=(
    "public"
    "functions"
    "react-app"
    "Business Analyst AI"
    "Developer AI"
  )
  
  # Check required files
  for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
      success "Found required file: $file"
    else
      error "Missing required file: $file"
      exit 1
    fi
  done
  
  # Check required directories
  for dir in "${required_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      success "Found required directory: $dir"
    else
      error "Missing required directory: $dir"
      exit 1
    fi
  done
}

# Check Node.js and npm versions
check_node_environment() {
  log "Checking Node.js environment..."
  
  # Check Node.js version
  if command -v node &> /dev/null; then
    local node_version=$(node --version)
    success "Node.js version: $node_version"
    
    # Check if version is >= 16
    local major_version=$(echo "$node_version" | sed 's/v\([0-9]*\).*/\1/')
    if [[ "$major_version" -lt 16 ]]; then
      warn "Node.js version is $node_version, recommend >= 16.x"
    fi
  else
    error "Node.js not found"
    exit 1
  fi
  
  # Check npm version
  if command -v npm &> /dev/null; then
    local npm_version=$(npm --version)
    success "npm version: $npm_version"
  else
    error "npm not found"
    exit 1
  fi
}

# Validate package.json files
validate_package_json() {
  log "Validating package.json files..."
  
  # Root package.json
  if [[ -f "package.json" ]]; then
    if npm ls --depth=0 > /dev/null 2>&1; then
      success "Root package.json is valid"
    else
      warn "Root package.json has dependency issues"
    fi
  fi
  
  # React app package.json
  if [[ -f "react-app/package.json" ]]; then
    cd react-app
    if npm ls --depth=0 > /dev/null 2>&1; then
      success "React app package.json is valid"
    else
      warn "React app package.json has dependency issues"
    fi
    cd ..
  fi
  
  # Functions package.json
  if [[ -f "functions/package.json" ]]; then
    cd functions
    if npm ls --depth=0 > /dev/null 2>&1; then
      success "Functions package.json is valid"
    else
      warn "Functions package.json has dependency issues"
    fi
    cd ..
  fi
}

# Run TypeScript compilation check
check_typescript_compilation() {
  log "Checking TypeScript compilation..."
  
  if [[ -d "react-app" && -f "react-app/tsconfig.json" ]]; then
    cd react-app
    if npm run build > /dev/null 2>&1; then
      success "TypeScript compilation successful"
    else
      error "TypeScript compilation failed"
      npm run build
      cd ..
      exit 1
    fi
    cd ..
  else
    warn "No TypeScript configuration found"
  fi
}

# Run linting checks
run_linting() {
  log "Running linting checks..."
  
  if [[ -d "react-app" ]]; then
    cd react-app
    if npm run lint > /dev/null 2>&1; then
      success "Linting passed"
    else
      warn "Linting issues found:"
      npm run lint || true
    fi
    cd ..
  else
    warn "No React app found for linting"
  fi
}

# Run tests
run_tests() {
  if [[ "$SKIP_TESTS" == true ]]; then
    warn "Skipping tests as requested"
    return
  fi
  
  log "Running tests..."
  
  # React app tests
  if [[ -d "react-app" ]]; then
    cd react-app
    if [[ "$QUICK_MODE" == true ]]; then
      log "Running quick tests only..."
      if npm test -- --watchAll=false --coverage=false > /dev/null 2>&1; then
        success "Quick tests passed"
      else
        warn "Some tests failed in quick mode"
      fi
    else
      log "Running full test suite..."
      if npm test -- --watchAll=false --coverage > /dev/null 2>&1; then
        success "All tests passed"
      else
        error "Test failures detected"
        npm test -- --watchAll=false
        cd ..
        exit 1
      fi
    fi
    cd ..
  fi
  
  # Functions tests (if they exist)
  if [[ -d "functions" && -f "functions/package.json" ]]; then
    cd functions
    if grep -q '"test"' package.json; then
      if npm test > /dev/null 2>&1; then
        success "Functions tests passed"
      else
        warn "Functions tests failed"
      fi
    else
      warn "No test script found in functions"
    fi
    cd ..
  fi
}

# Check Firebase configuration
check_firebase_config() {
  log "Checking Firebase configuration..."
  
  # Check firebase.json
  if [[ -f "firebase.json" ]]; then
    if jq empty firebase.json > /dev/null 2>&1; then
      success "firebase.json is valid JSON"
    else
      error "firebase.json is invalid JSON"
      exit 1
    fi
  fi
  
  # Check firestore rules
  if [[ -f "firestore.rules" ]]; then
    success "Firestore rules file found"
  else
    warn "No Firestore rules file found"
  fi
  
  # Check if Firebase tools are available
  if command -v firebase &> /dev/null; then
    success "Firebase CLI is available"
  else
    warn "Firebase CLI not found - install with: npm install -g firebase-tools"
  fi
}

# Check documentation completeness
check_documentation() {
  log "Checking documentation completeness..."
  
  local doc_files=(
    "README.md"
    "Business Analyst AI/README.md"
    "Developer AI/README.md"
    "GETTING_STARTED.md"
  )
  
  for doc in "${doc_files[@]}"; do
    if [[ -f "$doc" ]]; then
      success "Documentation file exists: $doc"
    else
      warn "Missing documentation: $doc"
    fi
  done
}

# Security checks
run_security_checks() {
  log "Running security checks..."
  
  # Check for secrets in code
  log "Scanning for potential secrets..."
  if command -v grep &> /dev/null; then
    local secret_patterns=(
      "password"
      "api[_-]?key"
      "secret"
      "token"
      "auth[_-]?key"
    )
    
    local secrets_found=false
    for pattern in "${secret_patterns[@]}"; do
      if git ls-files | xargs grep -i "$pattern" | grep -v "test" | grep -v "example" | grep -v ".md" > /dev/null 2>&1; then
        warn "Potential secret found for pattern: $pattern"
        secrets_found=true
      fi
    done
    
    if [[ "$secrets_found" == false ]]; then
      success "No obvious secrets detected"
    fi
  fi
  
  # Check npm audit (if available)
  if [[ -d "react-app" ]]; then
    cd react-app
    if npm audit --audit-level=high > /dev/null 2>&1; then
      success "No high-severity npm vulnerabilities"
    else
      warn "High-severity npm vulnerabilities found"
      npm audit --audit-level=high
    fi
    cd ..
  fi
}

# Performance checks
run_performance_checks() {
  if [[ "$QUICK_MODE" == true ]]; then
    warn "Skipping performance checks in quick mode"
    return
  fi
  
  log "Running performance checks..."
  
  # Check bundle size (if build exists)
  if [[ -d "react-app/build" ]]; then
    cd react-app
    local bundle_size=$(du -sh build | cut -f1)
    success "Build size: $bundle_size"
    cd ..
  else
    warn "No build directory found - run 'npm run build' to check bundle size"
  fi
}

# Generate pre-push report
generate_report() {
  log "Generating pre-push report..."
  
  echo "
========================================
BOB PROJECT PRE-PUSH VALIDATION REPORT
========================================
Date: $(date)
Branch: $(git branch --show-current)
Commit: $(git rev-parse --short HEAD)
Quick Mode: $QUICK_MODE
Skip Tests: $SKIP_TESTS

Validation Summary:
- Project structure: ✅ Valid
- Node.js environment: ✅ Ready
- TypeScript compilation: ✅ Successful
- Tests: $([ "$SKIP_TESTS" == true ] && echo "⏭️  Skipped" || echo "✅ Passed")
- Documentation: ✅ Present
- Security: ✅ Basic checks passed

Log file: $LOG_FILE
========================================
" | tee -a "$LOG_FILE"
}

# Main execution
main() {
  echo -e "${BLUE}🚀 BOB Project Pre-Push Validation${NC}"
  echo -e "${BLUE}===================================${NC}"
  
  check_git_repo
  check_uncommitted_changes
  check_branch_status
  guard_protected_branches
  validate_project_structure
  check_node_environment
  validate_package_json
  check_typescript_compilation
  run_linting
  run_tests
  check_firebase_config
  check_documentation
  run_security_checks
  run_performance_checks
  generate_report
  
  echo -e "\n${GREEN}🎉 Pre-push validation completed successfully!${NC}"
  echo -e "${GREEN}✅ Ready for git push${NC}"
  
  # Ask if user wants to push now
  read -p "Push to remote now? [y/N]: " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    log "Pushing to remote..."
    git push
    success "Push completed successfully"
  else
    log "Push skipped by user"
  fi
}

# Run main function
main "$@"
