#!/bin/bash

# BOB Project Comprehensive Backup Script
# Version: 2.1.0
# Purpose: Create complete backups of BOB project with multiple storage options
# Usage: ./backup.sh [--quick] [--remote-only] [--local-only] [--tag <tag>]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKUP_DIR="$HOME/BOB-Backups"
PROJECT_DIR=$(pwd)
PROJECT_NAME="bob"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_NAME="${PROJECT_NAME}-backup-${TIMESTAMP}"
QUICK_MODE=false
REMOTE_ONLY=false
LOCAL_ONLY=false
CUSTOM_TAG=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --remote-only)
      REMOTE_ONLY=true
      shift
      ;;
    --local-only)
      LOCAL_ONLY=true
      shift
      ;;
    --tag)
      CUSTOM_TAG="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --quick       Quick backup (exclude node_modules, build artifacts)"
      echo "  --remote-only Only create remote git backup and tags"
      echo "  --local-only  Only create local file backup"
      echo "  --tag <tag>   Custom tag name for git backup"
      echo "  -h, --help    Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# Logging functions
log() {
  echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
  echo -e "${GREEN}✅ $1${NC}"
}

warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
  echo -e "${RED}❌ $1${NC}"
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

# Get project information
get_project_info() {
  log "Gathering project information..."
  
  PROJECT_NAME=$(basename "$PROJECT_DIR")
  CURRENT_BRANCH=$(git branch --show-current)
  CURRENT_COMMIT=$(git rev-parse --short HEAD)
  COMMIT_MESSAGE=$(git log -1 --pretty=format:"%s")
  
  success "Project: $PROJECT_NAME"
  success "Branch: $CURRENT_BRANCH"
  success "Commit: $CURRENT_COMMIT"
  success "Message: $COMMIT_MESSAGE"
}

# Create backup directory structure
setup_backup_directory() {
  if [[ "$LOCAL_ONLY" == true || "$REMOTE_ONLY" == false ]]; then
    log "Setting up backup directory structure..."
    
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$BACKUP_DIR/archives"
    mkdir -p "$BACKUP_DIR/logs"
    mkdir -p "$BACKUP_DIR/metadata"
    
    success "Backup directory ready: $BACKUP_DIR"
  fi
}

# Create file exclusion list
create_exclusion_list() {
  log "Creating file exclusion list..."
  
  local exclusion_file="/tmp/backup-exclusions-$$"
  
  # Always exclude these
  cat > "$exclusion_file" << EOF
.git
.DS_Store
*.log
.env
.env.local
.env.development.local
.env.test.local
.env.production.local
node_modules/.cache
.npm
.eslintcache
*.tsbuildinfo
coverage/
EOF

  # Additional exclusions for quick mode
  if [[ "$QUICK_MODE" == true ]]; then
    cat >> "$exclusion_file" << EOF
node_modules
build
dist
.next
.nuxt
public/build
react-app/build
functions/lib
*.zip
*.tar.gz
*.tar.bz2
EOF
  fi
  
  echo "$exclusion_file"
}

# Create local file backup
create_local_backup() {
  if [[ "$REMOTE_ONLY" == true ]]; then
    warn "Skipping local backup (remote-only mode)"
    return
  fi
  
  log "Creating local file backup..."
  
  local exclusion_file=$(create_exclusion_list)
  local backup_path="$BACKUP_DIR/archives/${BACKUP_NAME}.tar.gz"
  
  # Create compressed archive
  tar --exclude-from="$exclusion_file" \
      -czf "$backup_path" \
      -C "$(dirname "$PROJECT_DIR")" \
      "$(basename "$PROJECT_DIR")"
  
  # Clean up exclusion file
  rm "$exclusion_file"
  
  local backup_size=$(du -h "$backup_path" | cut -f1)
  success "Local backup created: $backup_path ($backup_size)"
  
  # Create metadata file
  create_backup_metadata "$backup_path"
}

# Create backup metadata
create_backup_metadata() {
  local backup_path="$1"
  local metadata_file="$BACKUP_DIR/metadata/${BACKUP_NAME}.json"
  
  log "Creating backup metadata..."
  
  cat > "$metadata_file" << EOF
{
  "backup_name": "$BACKUP_NAME",
  "timestamp": "$TIMESTAMP",
  "project_name": "$PROJECT_NAME",
  "project_dir": "$PROJECT_DIR",
  "backup_path": "$backup_path",
  "backup_size": "$(du -h "$backup_path" | cut -f1)",
  "git_info": {
    "branch": "$CURRENT_BRANCH",
    "commit": "$CURRENT_COMMIT",
    "commit_message": "$COMMIT_MESSAGE",
    "remote_url": "$(git config --get remote.origin.url || echo 'none')"
  },
  "backup_options": {
    "quick_mode": $QUICK_MODE,
    "remote_only": $REMOTE_ONLY,
    "local_only": $LOCAL_ONLY,
    "custom_tag": "$CUSTOM_TAG"
  },
  "system_info": {
    "hostname": "$(hostname)",
    "user": "$(whoami)",
    "os": "$(uname -s)",
    "arch": "$(uname -m)"
  }
}
EOF
  
  success "Metadata created: $metadata_file"
}

# Create git backup with tags
create_git_backup() {
  if [[ "$LOCAL_ONLY" == true ]]; then
    warn "Skipping git backup (local-only mode)"
    return
  fi
  
  log "Creating git backup..."
  
  # Ensure all changes are committed
  if ! git diff-index --quiet HEAD --; then
    warn "Uncommitted changes detected"
    read -p "Commit changes before backup? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      git add .
      git commit -m "Auto-commit before backup - $TIMESTAMP"
      success "Changes committed"
    else
      warn "Proceeding with uncommitted changes"
    fi
  fi
  
  # Create git tag
  local tag_name
  if [[ -n "$CUSTOM_TAG" ]]; then
    tag_name="$CUSTOM_TAG"
  else
    tag_name="backup-$TIMESTAMP"
  fi
  
  if git tag -a "$tag_name" -m "Backup created on $TIMESTAMP from commit $CURRENT_COMMIT"; then
    success "Git tag created: $tag_name"
  else
    warn "Failed to create git tag (may already exist)"
  fi
  
  # Push to remote (if remote exists)
  if git config --get remote.origin.url > /dev/null 2>&1; then
    log "Pushing to remote repository..."
    
    if git push origin "$CURRENT_BRANCH"; then
      success "Branch pushed to remote"
    else
      warn "Failed to push branch to remote"
    fi
    
    if git push origin "$tag_name"; then
      success "Tag pushed to remote"
    else
      warn "Failed to push tag to remote"
    fi
  else
    warn "No remote repository configured"
  fi
}

# Create Firebase backup (if Firebase is configured)
create_firebase_backup() {
  if [[ "$LOCAL_ONLY" == true ]]; then
    warn "Skipping Firebase backup (local-only mode)"
    return
  fi
  
  log "Checking for Firebase configuration..."
  
  if [[ -f "firebase.json" ]] && command -v firebase &> /dev/null; then
    log "Creating Firebase configuration backup..."
    
    local firebase_backup_dir="$BACKUP_DIR/firebase-$TIMESTAMP"
    mkdir -p "$firebase_backup_dir"
    
    # Backup Firebase configuration files
    cp firebase.json "$firebase_backup_dir/" 2>/dev/null || true
    cp firestore.rules "$firebase_backup_dir/" 2>/dev/null || true
    cp storage.rules "$firebase_backup_dir/" 2>/dev/null || true
    cp firestore.indexes.json "$firebase_backup_dir/" 2>/dev/null || true
    
    # Export Firestore data (if possible)
    if firebase projects:list > /dev/null 2>&1; then
      log "Attempting Firestore data export..."
      # Note: This requires proper Firebase CLI setup and permissions
      # firebase firestore:delete --all-collections --yes > /dev/null 2>&1 || warn "Could not export Firestore data"
      warn "Firestore data export requires manual setup - skipping"
    fi
    
    success "Firebase configuration backed up to: $firebase_backup_dir"
  else
    warn "Firebase not configured or CLI not available"
  fi
}

# Verify backup integrity
verify_backup() {
  if [[ "$REMOTE_ONLY" == true ]]; then
    log "Verifying git backup..."
    if git tag -l | grep -q "backup-$TIMESTAMP\|$CUSTOM_TAG"; then
      success "Git tag verification passed"
    else
      error "Git tag verification failed"
      return 1
    fi
    return 0
  fi
  
  log "Verifying backup integrity..."
  
  local backup_path="$BACKUP_DIR/archives/${BACKUP_NAME}.tar.gz"
  
  if [[ -f "$backup_path" ]]; then
    # Test archive integrity
    if tar -tzf "$backup_path" > /dev/null 2>&1; then
      success "Archive integrity verification passed"
    else
      error "Archive integrity verification failed"
      return 1
    fi
    
    # Check metadata file
    local metadata_file="$BACKUP_DIR/metadata/${BACKUP_NAME}.json"
    if [[ -f "$metadata_file" ]] && jq empty "$metadata_file" > /dev/null 2>&1; then
      success "Metadata verification passed"
    else
      warn "Metadata verification failed or incomplete"
    fi
  else
    error "Backup file not found: $backup_path"
    return 1
  fi
}

# Clean old backups
cleanup_old_backups() {
  if [[ "$REMOTE_ONLY" == true ]]; then
    warn "Skipping cleanup (remote-only mode)"
    return
  fi
  
  log "Cleaning up old backups..."
  
  # Keep last 10 backup archives
  local archive_count=$(ls -1 "$BACKUP_DIR/archives" 2>/dev/null | wc -l)
  if [[ $archive_count -gt 10 ]]; then
    log "Found $archive_count archives, keeping newest 10..."
    cd "$BACKUP_DIR/archives"
    ls -t | tail -n +11 | xargs rm -f
    success "Old archives cleaned up"
  else
    success "Archive count ($archive_count) within limits"
  fi
  
  # Clean metadata files older than 30 days
  if [[ -d "$BACKUP_DIR/metadata" ]]; then
    find "$BACKUP_DIR/metadata" -name "*.json" -mtime +30 -delete 2>/dev/null || true
    success "Old metadata cleaned up"
  fi
  
  # Clean log files older than 7 days
  if [[ -d "$BACKUP_DIR/logs" ]]; then
    find "$BACKUP_DIR/logs" -name "*.log" -mtime +7 -delete 2>/dev/null || true
    success "Old logs cleaned up"
  fi
}

# Generate backup report
generate_backup_report() {
  log "Generating backup report..."
  
  local report_file="$BACKUP_DIR/logs/backup-report-$TIMESTAMP.log"
  
  cat > "$report_file" << EOF
========================================
BOB PROJECT BACKUP REPORT
========================================
Date: $(date)
Backup Name: $BACKUP_NAME
Project: $PROJECT_NAME ($PROJECT_DIR)

Git Information:
- Branch: $CURRENT_BRANCH
- Commit: $CURRENT_COMMIT
- Message: $COMMIT_MESSAGE

Backup Configuration:
- Quick Mode: $QUICK_MODE
- Remote Only: $REMOTE_ONLY
- Local Only: $LOCAL_ONLY
- Custom Tag: ${CUSTOM_TAG:-"none"}

Backup Results:
EOF

  if [[ "$REMOTE_ONLY" == false ]]; then
    local backup_path="$BACKUP_DIR/archives/${BACKUP_NAME}.tar.gz"
    if [[ -f "$backup_path" ]]; then
      local backup_size=$(du -h "$backup_path" | cut -f1)
      echo "- Local Backup: ✅ Success ($backup_size)" >> "$report_file"
      echo "  Path: $backup_path" >> "$report_file"
    else
      echo "- Local Backup: ❌ Failed" >> "$report_file"
    fi
  else
    echo "- Local Backup: ⏭️  Skipped" >> "$report_file"
  fi
  
  if [[ "$LOCAL_ONLY" == false ]]; then
    if git tag -l | grep -q "backup-$TIMESTAMP\|$CUSTOM_TAG"; then
      echo "- Git Backup: ✅ Success" >> "$report_file"
      echo "  Tag: ${CUSTOM_TAG:-backup-$TIMESTAMP}" >> "$report_file"
    else
      echo "- Git Backup: ❌ Failed" >> "$report_file"
    fi
  else
    echo "- Git Backup: ⏭️  Skipped" >> "$report_file"
  fi
  
  cat >> "$report_file" << EOF

Backup Directory: $BACKUP_DIR
Report Generated: $(date)
========================================
EOF
  
  success "Backup report created: $report_file"
  
  # Display summary
  echo -e "\n${BLUE}📊 BACKUP SUMMARY${NC}"
  echo -e "${BLUE}=================${NC}"
  cat "$report_file"
}

# Main execution function
main() {
  echo -e "${BLUE}💾 BOB Project Backup System${NC}"
  echo -e "${BLUE}============================${NC}"
  
  check_git_repo
  get_project_info
  setup_backup_directory
  create_local_backup
  create_git_backup
  create_firebase_backup
  verify_backup
  cleanup_old_backups
  generate_backup_report
  
  echo -e "\n${GREEN}🎉 Backup process completed successfully!${NC}"
  
  if [[ "$REMOTE_ONLY" == false ]]; then
    echo -e "${GREEN}📁 Backup location: $BACKUP_DIR${NC}"
  fi
  
  if [[ "$LOCAL_ONLY" == false ]]; then
    echo -e "${GREEN}🏷️  Git tag: ${CUSTOM_TAG:-backup-$TIMESTAMP}${NC}"
  fi
}

# Error handling
trap 'error "Backup process interrupted"; exit 1' INT TERM

# Run main function
main "$@"
