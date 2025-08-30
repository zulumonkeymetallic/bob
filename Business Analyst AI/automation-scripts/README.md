# BOB Project Automation Scripts

This directory contains automation scripts for the BOB Productivity Platform project management and quality assurance.

## 📁 Script Overview

| Script | Purpose | Usage | Status |
|--------|---------|-------|--------|
| `pre-push.sh` | Pre-push validation and checks | `./pre-push.sh [--quick] [--skip-tests]` | ✅ Ready |
| `backup.sh` | Comprehensive project backup | `./backup.sh [--quick] [--remote-only] [--tag <name>]` | ✅ Ready |
| `e2e.sh` | End-to-end testing suite | `./e2e.sh [--headless] [--quick] [--browser <name>]` | 🔄 Framework |
| `verify-epics.sh` | Epic completion verification | `./verify-epics.sh [--epic <id>] [--all] [--report]` | ✅ Ready |

## 🚀 Quick Start

```bash
# Make all scripts executable
chmod +x automation-scripts/*.sh

# Run pre-push validation
./automation-scripts/pre-push.sh

# Create project backup
./automation-scripts/backup.sh --tag "milestone-v2.1.5"

# Verify epic completion
./automation-scripts/verify-epics.sh --all --report

# Run E2E tests
./automation-scripts/e2e.sh --quick --headless
```

## 📋 Detailed Script Documentation

### 🔍 pre-push.sh - Pre-Push Validation

**Purpose:** Comprehensive validation before git push operations

**Features:**
- Git repository validation
- Project structure verification
- TypeScript compilation check
- Linting and code quality
- Test execution
- Security scanning
- Performance checks
- Documentation validation

**Usage Examples:**
```bash
# Full validation (default)
./pre-push.sh

# Quick validation (skip comprehensive checks)
./pre-push.sh --quick

# Skip all tests
./pre-push.sh --skip-tests

# Help
./pre-push.sh --help
```

**Exit Codes:**
- `0` - All validations passed
- `1` - Validation failures detected

### 💾 backup.sh - Project Backup

**Purpose:** Create comprehensive backups with multiple storage options

**Features:**
- Local file archive creation
- Git repository backup with tags
- Firebase configuration backup
- Metadata generation
- Automatic cleanup of old backups
- Backup integrity verification

**Usage Examples:**
```bash
# Full backup (local + git)
./backup.sh

# Quick backup (exclude node_modules, build artifacts)
./backup.sh --quick

# Git backup only
./backup.sh --remote-only

# Local backup only
./backup.sh --local-only

# Custom tag name
./backup.sh --tag "pre-deployment-backup"
```

**Backup Locations:**
- **Local Archives:** `~/BOB-Backups/archives/`
- **Metadata:** `~/BOB-Backups/metadata/`
- **Logs:** `~/BOB-Backups/logs/`
- **Git Tags:** `backup-YYYYMMDD-HHMMSS` or custom tag

### 🧪 e2e.sh - End-to-End Testing

**Purpose:** Comprehensive E2E testing for BOB platform

**Features:**
- Framework detection (Playwright/Cypress)
- Multiple test suites (smoke, quick, full)
- Cross-browser testing
- Environment configuration
- Test report generation
- Development server management

**Usage Examples:**
```bash
# Smoke tests (default)
./e2e.sh

# Quick test suite
./e2e.sh --quick

# Full test suite
./e2e.sh --full

# Headless mode
./e2e.sh --headless

# Specific browser
./e2e.sh --browser firefox

# Production environment
./e2e.sh --env production --url https://bob20250810.web.app
```

**Test Categories:**
- **Smoke:** Basic connectivity and loading
- **Quick:** Core functionality testing
- **Full:** Comprehensive feature testing

### 📊 verify-epics.sh - Epic Verification

**Purpose:** Verify epic completion and requirements traceability

**Features:**
- Individual epic verification
- Comprehensive epic analysis
- Requirements traceability checking
- Code pattern detection
- Implementation scoring
- Detailed reporting

**Usage Examples:**
```bash
# Verify all epics
./verify-epics.sh --all

# Verify specific epic
./verify-epics.sh --epic EPC-001

# Generate detailed report
./verify-epics.sh --all --report

# Strict mode (fail on any incomplete items)
./verify-epics.sh --all --strict
```

**Epic Coverage:**
- **EPC-001:** Core Task Management System
- **EPC-002:** Advanced User Interface & Experience
- **EPC-003:** Goals & Strategic Planning Management
- **EPC-004:** AI-Enhanced Productivity Features
- **EPC-005:** System Architecture & Infrastructure

## ⚙️ Configuration

### Environment Variables

```bash
# Set in ~/.bashrc or ~/.zshrc
export BOB_BACKUP_DIR="$HOME/BOB-Backups"
export BOB_TEST_TIMEOUT=30000
export BOB_DEFAULT_BROWSER="chrome"
```

### Project Dependencies

The scripts require these tools to be installed:

**Required:**
- Node.js (>=16.x)
- npm or yarn
- Git
- curl

**Optional:**
- Firebase CLI (`npm install -g firebase-tools`)
- jq (for JSON processing)
- Playwright or Cypress (for E2E testing)

### Installation Check

```bash
# Check all dependencies
./automation-scripts/pre-push.sh --quick
```

## 🔧 Integration with Development Workflow

### Git Hooks Integration

Add to `.git/hooks/pre-push`:
```bash
#!/bin/bash
exec ./automation-scripts/pre-push.sh --quick
```

### CI/CD Integration

GitHub Actions workflow example:
```yaml
- name: Run Pre-Push Validation
  run: ./automation-scripts/pre-push.sh --skip-tests

- name: Run E2E Tests
  run: ./automation-scripts/e2e.sh --headless --quick

- name: Verify Epic Completion
  run: ./automation-scripts/verify-epics.sh --all
```

### Daily Development Tasks

```bash
# Morning routine
./automation-scripts/verify-epics.sh --all

# Before committing
./automation-scripts/pre-push.sh

# Before deployment
./automation-scripts/backup.sh --tag "pre-deployment"
./automation-scripts/e2e.sh --full --headless
```

## 📊 Reporting and Logs

### Report Locations

- **Pre-Push Reports:** `pre-push-YYYYMMDD-HHMMSS.log`
- **Backup Reports:** `~/BOB-Backups/logs/backup-report-*.log`
- **E2E Reports:** `test-reports/e2e/e2e-report-*.html`
- **Epic Reports:** `verification-reports/epic-verification-report-*.html`

### Log Analysis

```bash
# View latest pre-push log
ls -t pre-push-*.log | head -1 | xargs cat

# View backup history
ls -la ~/BOB-Backups/logs/

# View epic verification results
ls -la verification-reports/
```

## 🛠️ Customization

### Adding New Checks

To add custom validation to `pre-push.sh`:

```bash
# Add function
custom_validation() {
  log "Running custom validation..."
  # Your validation logic here
  success "Custom validation passed"
}

# Add to main() function
custom_validation
```

### Extending E2E Tests

To add new test scenarios to `e2e.sh`:

```bash
# Add test function
test_new_feature() {
  log "Testing new feature..."
  # Your test implementation
  success "New feature test passed"
}

# Add to test suite
test_new_feature
```

### Custom Epic Verification

To add new epic checks to `verify-epics.sh`:

```bash
# Add epic verification function
verify_epc_006() {
  epic_header "EPC-006: New Epic Name"
  # Verification logic
}

# Add to main() function
verify_epc_006 && ((overall_passed++)); ((overall_total++))
```

## 🔒 Security Considerations

- Scripts validate input parameters
- No hardcoded secrets or credentials
- Backup files exclude sensitive data
- Git operations use existing authentication
- File permissions properly set (755 for executables)

## 🐛 Troubleshooting

### Common Issues

**Permission Denied:**
```bash
chmod +x automation-scripts/*.sh
```

**Development Server Not Running:**
```bash
cd react-app && npm start
```

**Firebase CLI Not Found:**
```bash
npm install -g firebase-tools
```

**Node Version Issues:**
```bash
nvm use 16  # or install Node.js 16+
```

### Debug Mode

Run scripts with debug output:
```bash
bash -x ./automation-scripts/pre-push.sh
```

## 📞 Support

For issues with automation scripts:
1. Check the generated log files
2. Verify all dependencies are installed
3. Ensure you're in the correct project directory
4. Review the specific script documentation above

## 🔄 Version History

- **v2.1.0** - Initial automation suite with comprehensive validation
- **v2.0.0** - Basic script framework
- **v1.0.0** - Manual process documentation

---

**Last Updated:** August 30, 2025  
**Maintainer:** BOB Development Team  
**License:** MIT (same as main project)
