#!/bin/bash
# BOB v3.5.5 - Comprehensive Goals CRUD Testing with Test Users
# This script creates test users and runs headless CRUD testing

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_DIR="./test-results"
LOG_FILE="$LOG_DIR/comprehensive_test_${TIMESTAMP}.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
    
    case $level in
        "ERROR")
            echo -e "${RED}❌ ${message}${NC}"
            ;;
        "SUCCESS")
            echo -e "${GREEN}✅ ${message}${NC}"
            ;;
        "WARNING")
            echo -e "${YELLOW}⚠️ ${message}${NC}"
            ;;
        "INFO")
            echo -e "${BLUE}ℹ️ ${message}${NC}"
            ;;
        *)
            echo -e "${message}"
            ;;
    esac
}

# Function to check prerequisites
check_prerequisites() {
    log "INFO" "Checking prerequisites..."
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        log "ERROR" "Python 3 is required but not installed"
        return 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log "ERROR" "Node.js is required but not installed"
        return 1
    fi
    
    # Check if we're in the BOB directory
    if [ ! -f "package.json" ] || [ ! -d "react-app" ]; then
        log "ERROR" "This script must be run from the BOB project root directory"
        return 1
    fi
    
    log "SUCCESS" "Prerequisites check passed"
    return 0
}

# Function to install Python dependencies
install_python_deps() {
    log "INFO" "Installing Python dependencies..."
    
    # Create requirements file if it doesn't exist
    if [ ! -f "requirements-testing.txt" ]; then
        cat > requirements-testing.txt << EOF
selenium>=4.15.0
webdriver-manager>=4.0.0
EOF
    fi
    
    # Install dependencies
    if pip3 install -r requirements-testing.txt; then
        log "SUCCESS" "Python dependencies installed"
        return 0
    else
        log "ERROR" "Failed to install Python dependencies"
        return 1
    fi
}

# Function to install Node.js dependencies
install_node_deps() {
    log "INFO" "Installing Node.js dependencies..."
    
    # Check if firebase-admin is installed
    if ! node -e "require('firebase-admin')" 2>/dev/null; then
        log "INFO" "Installing firebase-admin..."
        if npm install firebase-admin; then
            log "SUCCESS" "firebase-admin installed"
        else
            log "ERROR" "Failed to install firebase-admin"
            return 1
        fi
    fi
    
    log "SUCCESS" "Node.js dependencies ready"
    return 0
}

# Function to create test directory structure
setup_test_environment() {
    log "INFO" "Setting up test environment..."
    
    # Create directories
    mkdir -p "$LOG_DIR"
    mkdir -p "$LOG_DIR/screenshots"
    mkdir -p "$LOG_DIR/reports"
    mkdir -p "$LOG_DIR/test-data"
    
    # Set permissions
    chmod 755 "$LOG_DIR"
    chmod 755 "$LOG_DIR/screenshots"
    chmod 755 "$LOG_DIR/reports"
    chmod 755 "$LOG_DIR/test-data"
    
    log "SUCCESS" "Test environment setup complete"
    return 0
}

# Function to create test users
create_test_users() {
    log "INFO" "Creating test users via Firebase Admin SDK..."
    
    # Run the test user creation script
    if node create-test-users-enhanced.js create; then
        log "SUCCESS" "Test users created successfully"
        
        # Check if tokens file was created
        if [ -f "test-users-tokens.json" ]; then
            log "INFO" "Test user tokens generated: test-users-tokens.json"
        fi
        
        return 0
    else
        log "ERROR" "Failed to create test users"
        return 1
    fi
}

# Function to run headless CRUD testing
run_crud_testing() {
    log "INFO" "Starting headless CRUD testing..."
    
    # Check if Python test script exists
    if [ -f "simple_goals_crud_tester.py" ]; then
        local test_script="simple_goals_crud_tester.py"
    elif [ -f "bob_goals_crud_tester.py" ]; then
        local test_script="bob_goals_crud_tester.py"
    else
        log "ERROR" "CRUD testing script not found"
        return 1
    fi
    
    # Make script executable
    chmod +x "$test_script"
    
    # Run headless testing
    log "INFO" "Running Firefox headless testing with $test_script..."
    if python3 "$test_script"; then
        log "SUCCESS" "CRUD testing completed successfully"
        return 0
    else
        log "WARNING" "CRUD testing completed with some issues"
        return 1
    fi
}

# Function to run visible testing (for debugging)
run_visible_testing() {
    log "INFO" "Starting visible CRUD testing for debugging..."
    
    if [ -f "simple_goals_crud_tester.py" ]; then
        local test_script="simple_goals_crud_tester.py"
    elif [ -f "bob_goals_crud_tester.py" ]; then
        local test_script="bob_goals_crud_tester.py"
    else
        log "ERROR" "CRUD testing script not found"
        return 1
    fi
    
    # Run visible testing
    log "INFO" "Running Firefox visible testing with $test_script..."
    python3 "$test_script" --visible
    
    log "INFO" "Visible testing completed"
    return 0
}

# Function to cleanup test users
cleanup_test_users() {
    log "INFO" "Cleaning up test users..."
    
    if node create-test-users-enhanced.js cleanup; then
        log "SUCCESS" "Test users cleaned up successfully"
        
        # Also remove local token files
        if [ -f "test-users-tokens.json" ]; then
            rm -f "test-users-tokens.json"
            log "INFO" "Removed test user tokens file"
        fi
        
        if ls test-users-report-*.json 1> /dev/null 2>&1; then
            rm -f test-users-report-*.json
            log "INFO" "Removed test user report files"
        fi
        
        return 0
    else
        log "WARNING" "Test user cleanup had some issues"
        log "INFO" "You may need to manually cleanup users in Firebase Console"
        return 1
    fi
}

# Function to generate comprehensive report
generate_comprehensive_report() {
    log "INFO" "Generating comprehensive test report..."
    
    local report_file="$LOG_DIR/BOB_Comprehensive_Test_Report_${TIMESTAMP}.md"
    
    cat > "$report_file" << EOF
# BOB v3.5.5 - Comprehensive Goals CRUD Test Report

**Generated:** $(date '+%Y-%m-%d %H:%M:%S')  
**Test Session ID:** ${TIMESTAMP}  
**Environment:** Headless Browser Testing  

## Executive Summary

This report covers comprehensive testing of BOB's Goals CRUD functionality using automated test users and headless browser automation.

### Test Components
1. **Test User Creation** - Firebase Admin SDK
2. **Headless Browser Testing** - Selenium with Firefox
3. **Goals CRUD Operations** - Create, Read, Update, Delete
4. **Authentication Testing** - Side-door authentication for automation

## Test Environment Details

- **Base URL:** https://bob20250810.web.app
- **Browser:** Firefox (Headless)
- **Test Users:** AI Test Agent, Automation User, CRUD Test User
- **Test Framework:** Selenium WebDriver with Python
- **Authentication:** Side-door authentication with test tokens

## Test Results

### Test User Creation
EOF

    # Add test user creation results if available
    if [ -f "test-users-report-"*.json ]; then
        local latest_report=$(ls -t test-users-report-*.json | head -1)
        echo "- **Report File:** $latest_report" >> "$report_file"
        
        # Extract statistics from JSON report
        local created_count=$(cat "$latest_report" | grep -o '"created_users":[0-9]*' | cut -d':' -f2)
        local error_count=$(cat "$latest_report" | grep -o '"errors":\[[^]]*\]' | grep -o ',' | wc -l)
        
        cat >> "$report_file" << EOF
- **Users Created:** ${created_count:-"Unknown"}
- **Errors:** ${error_count:-"0"}
EOF
    fi

    cat >> "$report_file" << EOF

### CRUD Testing Results
EOF

    # Add CRUD testing results if available
    if ls BOB_Goals_Test_Report_*.md 1> /dev/null 2>&1; then
        local latest_crud_report=$(ls -t BOB_Goals_Test_Report_*.md | head -1)
        echo "- **CRUD Report:** $latest_crud_report" >> "$report_file"
        
        # Extract key metrics from CRUD report
        if [ -f "$latest_crud_report" ]; then
            local total_tests=$(grep "Total Tests:" "$latest_crud_report" | grep -o '[0-9]*' | head -1)
            local passed_tests=$(grep "Passed:" "$latest_crud_report" | grep -o '[0-9]*' | head -1)
            local failed_tests=$(grep "Failed:" "$latest_crud_report" | grep -o '[0-9]*' | head -1)
            
            cat >> "$report_file" << EOF
- **Total Tests:** ${total_tests:-"Unknown"}
- **Passed:** ${passed_tests:-"Unknown"}
- **Failed:** ${failed_tests:-"Unknown"}
EOF
        fi
    fi

    cat >> "$report_file" << EOF

## Test Artifacts

### Generated Files
- **Main Log:** $LOG_FILE
- **Screenshots:** $LOG_DIR/screenshots/
- **Test Data:** $LOG_DIR/test-data/
- **User Tokens:** test-users-tokens.json (if created)

### Commands Used
\`\`\`bash
# Create test users
node create-test-users-enhanced.js create

# Run headless testing
python3 bob_goals_crud_tester.py

# Cleanup (optional)
node create-test-users-enhanced.js cleanup
\`\`\`

## Next Steps

1. **Review Failed Tests:** Check screenshots and logs for any failed test cases
2. **Validate Test Coverage:** Ensure all CRUD operations are properly tested
3. **Performance Analysis:** Review test execution times and identify bottlenecks
4. **Cleanup:** Remove test users and data when testing is complete

## Test Script Information

- **Test Script Version:** v3.5.5
- **Python Testing:** bob_goals_crud_tester.py
- **User Creation:** create-test-users-enhanced.js
- **Comprehensive Runner:** $(basename "$0")

**Report Generated:** $(date '+%Y-%m-%d %H:%M:%S')
EOF

    log "SUCCESS" "Comprehensive report generated: $report_file"
    return 0
}

# Function to display usage
show_usage() {
    cat << EOF
BOB v3.5.5 - Comprehensive Goals CRUD Testing Script

USAGE:
    $0 [COMMAND] [OPTIONS]

COMMANDS:
    full        Run complete testing suite (create users + CRUD testing)
    users       Create test users only
    test        Run CRUD testing only (requires existing test users)
    visible     Run CRUD testing in visible mode (for debugging)
    cleanup     Remove all test users and data
    list        List existing test users
    help        Show this help message

OPTIONS:
    --no-cleanup    Don't cleanup test users after testing (for debugging)
    --skip-deps     Skip dependency installation
    --verbose       Enable verbose logging

EXAMPLES:
    $0 full                    # Complete testing suite
    $0 users                   # Create test users only
    $0 test                    # Run CRUD tests only
    $0 visible                 # Run tests in visible browser mode
    $0 cleanup                 # Remove all test data
    $0 list                    # List existing test users

FILES CREATED:
    - test-results/            # Test outputs and reports
    - test-users-tokens.json   # Authentication tokens for test users
    - BOB_Goals_Test_Report_*  # CRUD testing reports
    - test-users-report-*      # User creation reports
EOF
}

# Main execution function
main() {
    local command="${1:-full}"
    local skip_deps=false
    local no_cleanup=false
    local verbose=false
    
    # Parse options
    shift
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-deps)
                skip_deps=true
                shift
                ;;
            --no-cleanup)
                no_cleanup=true
                shift
                ;;
            --verbose)
                verbose=true
                shift
                ;;
            *)
                log "ERROR" "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Set verbose mode
    if [ "$verbose" = true ]; then
        set -x
    fi
    
    log "INFO" "BOB v3.5.5 - Comprehensive Goals CRUD Testing"
    log "INFO" "Command: $command"
    log "INFO" "Timestamp: $TIMESTAMP"
    log "INFO" "Log file: $LOG_FILE"
    
    # Setup test environment
    setup_test_environment
    
    case $command in
        "full")
            log "INFO" "Running complete testing suite..."
            
            # Check prerequisites
            check_prerequisites || exit 1
            
            # Install dependencies
            if [ "$skip_deps" = false ]; then
                install_python_deps || exit 1
                install_node_deps || exit 1
            fi
            
            # Create test users
            create_test_users || exit 1
            
            # Run CRUD testing
            crud_success=0
            run_crud_testing || crud_success=1
            
            # Generate comprehensive report
            generate_comprehensive_report
            
            # Cleanup test users (unless disabled)
            if [ "$no_cleanup" = false ]; then
                log "INFO" "Cleaning up test users..."
                cleanup_test_users || log "WARNING" "Cleanup had some issues but continuing"
            else
                log "INFO" "Skipping cleanup (--no-cleanup specified)"
                log "WARNING" "Remember to manually cleanup test users: ./comprehensive-goals-crud-testing.sh cleanup"
            fi
            
            if [ $crud_success -eq 0 ]; then
                log "SUCCESS" "Complete testing suite finished successfully"
                exit 0
            else
                log "WARNING" "Testing suite completed with some issues"
                exit 1
            fi
            ;;
            
        "users")
            log "INFO" "Creating test users only..."
            check_prerequisites || exit 1
            
            if [ "$skip_deps" = false ]; then
                install_node_deps || exit 1
            fi
            
            create_test_users || exit 1
            log "SUCCESS" "Test user creation completed"
            ;;
            
        "test")
            log "INFO" "Running CRUD testing only..."
            check_prerequisites || exit 1
            
            if [ "$skip_deps" = false ]; then
                install_python_deps || exit 1
            fi
            
            run_crud_testing
            generate_comprehensive_report
            ;;
            
        "visible")
            log "INFO" "Running visible CRUD testing..."
            check_prerequisites || exit 1
            
            if [ "$skip_deps" = false ]; then
                install_python_deps || exit 1
            fi
            
            run_visible_testing
            ;;
            
        "cleanup")
            log "INFO" "Cleaning up test users and data..."
            cleanup_test_users
            
            # Remove generated files
            rm -f test-users-tokens.json
            rm -f test-users-report-*.json
            rm -f BOB_Goals_Test_Report_*.md
            
            log "SUCCESS" "Cleanup completed"
            ;;
            
        "list")
            log "INFO" "Listing existing test users..."
            node create-test-users-enhanced.js list
            ;;
            
        "help"|"-h"|"--help")
            show_usage
            exit 0
            ;;
            
        *)
            log "ERROR" "Unknown command: $command"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
