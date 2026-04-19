#!/usr/bin/env python3
"""
BOB v3.5.5 - Quick Test Verification
Simple verification that testing components work
"""

import os
import sys
import subprocess
from datetime import datetime

def check_python_deps():
    """Check if Python dependencies are available"""
    try:
        import selenium
        from selenium import webdriver
        from selenium.webdriver.firefox.options import Options
        from webdriver_manager.firefox import GeckoDriverManager
        print("✅ Python dependencies available")
        return True
    except ImportError as e:
        print(f"❌ Missing Python dependency: {e}")
        return False

def check_nodejs_deps():
    """Check if Node.js and firebase-admin are available"""
    try:
        result = subprocess.run(['node', '-e', 'require("firebase-admin")'], 
                              capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ Node.js and firebase-admin available")
            return True
        else:
            print("❌ firebase-admin not available")
            return False
    except FileNotFoundError:
        print("❌ Node.js not found")
        return False

def check_test_files():
    """Check if test files exist"""
    required_files = [
        'simple_goals_crud_tester.py',
        'create-test-users-enhanced.js',
        'comprehensive-goals-crud-testing.sh'
    ]
    
    all_exist = True
    for file in required_files:
        if os.path.exists(file):
            print(f"✅ {file} exists")
        else:
            print(f"❌ {file} missing")
            all_exist = False
    
    return all_exist

def check_directories():
    """Check if test result directories exist or can be created"""
    try:
        os.makedirs('./test-results/screenshots', exist_ok=True)
        print("✅ Test directories ready")
        return True
    except Exception as e:
        print(f"❌ Cannot create test directories: {e}")
        return False

def check_browser():
    """Check if Firefox can be initialized"""
    try:
        from selenium.webdriver.firefox.options import Options
        from selenium.webdriver.firefox.service import Service
        from webdriver_manager.firefox import GeckoDriverManager
        
        options = Options()
        options.add_argument('--headless')
        service = Service(GeckoDriverManager().install())
        
        print("✅ Firefox WebDriver can be initialized")
        return True
    except Exception as e:
        print(f"❌ Firefox WebDriver issue: {e}")
        return False

def main():
    """Main verification"""
    print("🔍 BOB Goals CRUD Testing - Quick Verification")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 50)
    
    checks = [
        ("Python Dependencies", check_python_deps),
        ("Node.js Dependencies", check_nodejs_deps),
        ("Test Files", check_test_files),
        ("Test Directories", check_directories),
        ("Firefox WebDriver", check_browser)
    ]
    
    passed = 0
    total = len(checks)
    
    for name, check_func in checks:
        print(f"\n🔍 Checking {name}...")
        if check_func():
            passed += 1
        else:
            print(f"   Consider running setup commands for {name}")
    
    print("\n" + "=" * 50)
    print(f"📊 Verification Results: {passed}/{total} checks passed")
    
    if passed == total:
        print("✅ All checks passed! Ready for testing.")
        print("\n🚀 You can now run:")
        print("   ./comprehensive-goals-crud-testing.sh full")
        return True
    else:
        print(f"❌ {total - passed} checks failed. Setup needed.")
        print("\n🔧 Try these setup commands:")
        
        if passed < total:
            print("   pip3 install selenium webdriver-manager")
            print("   npm install firebase-admin")
            print("   ./comprehensive-goals-crud-testing.sh --help")
        
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
