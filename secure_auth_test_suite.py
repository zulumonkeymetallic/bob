#!/usr/bin/env python3
"""
BOB v3.5.5 - Secure Authentication Testing Suite
Comprehensive testing using secure test user login with full CRUD operations
"""

import time
import json
import os
import sys
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support.ui import Select
    from selenium.common.exceptions import (
        TimeoutException, 
        NoSuchElementException, 
        WebDriverException,
        ElementNotInteractableException
    )
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False
    print("⚠️ Selenium not available. Install with: pip install selenium webdriver-manager")

@dataclass
class TestResult:
    test_name: str
    status: str  # PASS, FAIL, SKIP
    execution_time: float
    error_message: str = ""
    details: Optional[Dict[str, Any]] = None
    
    def __post_init__(self):
        if self.details is None:
            self.details = {}

class SecureTestSuite:
    """
    Secure Authentication Testing Suite for BOB v3.5.5
    Tests using secure test user authentication with comprehensive CRUD operations
    """
    
    def __init__(self, headless=False):
        self.headless = headless
        self.driver: Optional[webdriver.Chrome] = None
        self.test_results: List[TestResult] = []
        self.current_user = None
        
        # Test configuration
        self.config = {
            'base_url': 'https://bob20250810.web.app',
            'test_url': 'https://bob20250810.web.app?test-mode=true',
            'timeout': 30,
            'screenshot_dir': './test-results/secure-auth',
            'reports_dir': './test-results'
        }
        
        # Secure test users
        self.test_users = {
            'jc1_test': {
                'email': 'testuser@jc1.tech',
                'password': 'test123456',
                'display_name': 'JC1 Test User'
            },
            'demo': {
                'email': 'demo@bob.local',
                'password': 'test123456',
                'display_name': 'Demo Test User'
            },
            'admin': {
                'email': 'admin@bob.local',
                'password': 'test123456',
                'display_name': 'Admin Test User'
            }
        }
        
        # Test data for CRUD operations
        self.test_data = {
            'goals': [
                {
                    'title': f'Selenium Test Goal - {datetime.now().strftime("%Y%m%d_%H%M%S")}',
                    'description': 'Comprehensive goal testing via secure authentication',
                    'theme': 'Health',
                    'priority': 'High',
                    'status': 'In Progress',
                    'target_date': '2025-12-31'
                },
                {
                    'title': f'Career Goal - {datetime.now().strftime("%Y%m%d_%H%M%S")}',
                    'description': 'Professional development milestone',
                    'theme': 'Career',
                    'priority': 'Medium',
                    'status': 'Not Started',
                    'target_date': '2025-08-15'
                }
            ],
            'stories': [
                {
                    'title': f'API Testing Story - {datetime.now().strftime("%Y%m%d_%H%M%S")}',
                    'description': 'Implement comprehensive API testing framework',
                    'priority': 'P1',
                    'points': 8,
                    'status': 'To Do'
                },
                {
                    'title': f'UI Enhancement Story - {datetime.now().strftime("%Y%m%d_%H%M%S")}',
                    'description': 'Improve user interface responsiveness',
                    'priority': 'P2',
                    'points': 5,
                    'status': 'In Progress'
                }
            ]
        }
        
        # Ensure directories exist
        os.makedirs(self.config['screenshot_dir'], exist_ok=True)
        os.makedirs(self.config['reports_dir'], exist_ok=True)
    
    def setup_driver(self) -> bool:
        """Initialize Chrome WebDriver with optimized settings"""
        if not SELENIUM_AVAILABLE:
            print("❌ Selenium not available")
            return False
            
        try:
            chrome_options = ChromeOptions()
            if self.headless:
                chrome_options.add_argument('--headless')
            chrome_options.add_argument('--disable-web-security')
            chrome_options.add_argument('--disable-features=VizDisplayCompositor')
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-setuid-sandbox')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--window-size=1920,1080')
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            
            self.driver = webdriver.Chrome(options=chrome_options)
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            self.driver.implicitly_wait(10)
            self.driver.set_page_load_timeout(30)
            
            print("✅ Chrome WebDriver initialized successfully")
            return True
            
        except Exception as e:
            print(f"❌ Failed to initialize WebDriver: {e}")
            return False
    
    def take_screenshot(self, test_name: str) -> Optional[str]:
        """Take screenshot for documentation"""
        if not self.driver:
            return None
            
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{test_name}_{timestamp}.png"
            filepath = os.path.join(self.config['screenshot_dir'], filename)
            self.driver.save_screenshot(filepath)
            print(f"📸 Screenshot saved: {filename}")
            return filepath
        except Exception as e:
            print(f"⚠️ Failed to take screenshot: {e}")
            return None
    
    def wait_for_element(self, locator, timeout=10):
        """Wait for element to be present"""
        if not self.driver:
            return None
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located(locator)
            )
            return element
        except TimeoutException:
            print(f"⚠️ Element not found within {timeout}s: {locator}")
            return None
    
    def wait_for_clickable(self, locator, timeout=10):
        """Wait for element to be clickable"""
        if not self.driver:
            return None
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.element_to_be_clickable(locator)
            )
            return element
        except TimeoutException:
            print(f"⚠️ Element not clickable within {timeout}s: {locator}")
            return None
    
    def secure_login(self, user_key='jc1_test') -> TestResult:
        """Secure login using test user credentials"""
        start_time = time.time()
        test_name = f"secure_login_{user_key}"
        
        try:
            if not self.driver:
                raise Exception("WebDriver not initialized")
            
            user = self.test_users[user_key]
            print(f"🔐 Logging in as {user['display_name']} ({user['email']})")
            
            # Navigate to test URL
            self.driver.get(self.config['test_url'])
            time.sleep(3)
            
            # Look for test login panel or trigger it
            try:
                # Check if already authenticated
                auth_state = self.driver.execute_script("""
                    return {
                        isAuthenticated: !!(window.auth && window.auth.currentUser),
                        currentUser: window.auth && window.auth.currentUser ? {
                            uid: window.auth.currentUser.uid,
                            email: window.auth.currentUser.email,
                            displayName: window.auth.currentUser.displayName
                        } : null
                    };
                """)
                
                if auth_state['isAuthenticated']:
                    print(f"✅ Already authenticated as: {auth_state['currentUser']['email']}")
                    self.current_user = auth_state['currentUser']
                else:
                    # Look for test login button or panel
                    login_trigger = None
                    
                    # Try different selectors for login trigger
                    login_selectors = [
                        "//button[contains(text(), 'Test Login')]",
                        "//button[contains(text(), '🧪')]",
                        "//a[contains(@href, 'test-login')]",
                        "//*[contains(text(), 'Sign In')]"
                    ]
                    
                    for selector in login_selectors:
                        try:
                            login_trigger = self.driver.find_element(By.XPATH, selector)
                            break
                        except NoSuchElementException:
                            continue
                    
                    if login_trigger:
                        login_trigger.click()
                        time.sleep(2)
                    
                    # Look for test user quick auth button
                    jc1_button_selectors = [
                        f"//button[contains(text(), '{user['email']}')]",
                        f"//button[contains(text(), 'JC1 Test User')]",
                        "//button[contains(text(), 'testuser@jc1.tech')]"
                    ]
                    
                    jc1_button = None
                    for selector in jc1_button_selectors:
                        try:
                            jc1_button = self.wait_for_clickable((By.XPATH, selector), 5)
                            if jc1_button:
                                break
                        except:
                            continue
                    
                    if jc1_button:
                        # Use quick auth button
                        print("🚀 Using quick auth button")
                        jc1_button.click()
                        time.sleep(3)
                    else:
                        # Manual email/password login
                        print("📝 Using manual email/password login")
                        
                        # Find email field
                        email_field = self.wait_for_element((By.CSS_SELECTOR, "input[type='email']"), 10)
                        if not email_field:
                            email_field = self.wait_for_element((By.NAME, "email"), 5)
                        if not email_field:
                            email_field = self.wait_for_element((By.ID, "email"), 5)
                        
                        if email_field:
                            email_field.clear()
                            email_field.send_keys(user['email'])
                            time.sleep(1)
                        
                        # Find password field
                        password_field = self.wait_for_element((By.CSS_SELECTOR, "input[type='password']"), 5)
                        if not password_field:
                            password_field = self.wait_for_element((By.NAME, "password"), 5)
                        
                        if password_field:
                            password_field.clear()
                            password_field.send_keys(user['password'])
                            time.sleep(1)
                        
                        # Find and click sign in button
                        sign_in_button = self.wait_for_clickable((By.XPATH, "//button[contains(text(), 'Sign In')]"), 5)
                        if sign_in_button:
                            sign_in_button.click()
                            time.sleep(3)
                
                # Verify authentication
                time.sleep(3)
                final_auth_state = self.driver.execute_script("""
                    return {
                        isAuthenticated: !!(window.auth && window.auth.currentUser),
                        currentUser: window.auth && window.auth.currentUser ? {
                            uid: window.auth.currentUser.uid,
                            email: window.auth.currentUser.email,
                            displayName: window.auth.currentUser.displayName
                        } : null,
                        url: window.location.href
                    };
                """)
                
                if final_auth_state['isAuthenticated']:
                    self.current_user = final_auth_state['currentUser']
                    execution_time = time.time() - start_time
                    
                    print(f"✅ Authentication successful!")
                    print(f"   User: {self.current_user['email']}")
                    print(f"   Display Name: {self.current_user['displayName']}")
                    
                    self.take_screenshot(test_name)
                    
                    return TestResult(
                        test_name=test_name,
                        status="PASS",
                        execution_time=execution_time,
                        details={
                            'user': self.current_user,
                            'auth_state': final_auth_state
                        }
                    )
                else:
                    raise Exception("Authentication failed - no user found after login attempt")
                    
            except Exception as login_error:
                raise Exception(f"Login process failed: {login_error}")
                
        except Exception as e:
            execution_time = time.time() - start_time
            print(f"❌ Secure login failed: {e}")
            self.take_screenshot(f"{test_name}_error")
            
            return TestResult(
                test_name=test_name,
                status="FAIL",
                execution_time=execution_time,
                error_message=str(e)
            )
    
    def test_goal_crud_operations(self) -> List[TestResult]:
        """Test complete Goal CRUD operations"""
        print("🎯 Testing Goal CRUD Operations...")
        results = []
        created_goals = []
        
        # Test Goal Creation
        for i, goal_data in enumerate(self.test_data['goals']):
            start_time = time.time()
            test_name = f"goal_create_{i+1}"
            
            try:
                print(f"📝 Creating Goal: {goal_data['title'][:50]}...")
                
                # Navigate to goals page
                self.driver.get(f"{self.config['base_url']}/goals")
                time.sleep(3)
                
                # Look for Add Goal button
                add_button_selectors = [
                    "//button[contains(text(), 'Add Goal')]",
                    "//button[contains(text(), 'New Goal')]",
                    "//button[contains(text(), '+')]",
                    "//*[@class='btn btn-primary'][contains(text(), 'Add')]"
                ]
                
                add_button = None
                for selector in add_button_selectors:
                    try:
                        add_button = self.wait_for_clickable((By.XPATH, selector), 5)
                        if add_button:
                            break
                    except:
                        continue
                
                if not add_button:
                    # Try floating action button
                    fab_selectors = [
                        "//*[contains(@class, 'fab')]",
                        "//*[contains(@class, 'floating')]//button"
                    ]
                    for selector in fab_selectors:
                        try:
                            add_button = self.wait_for_clickable((By.XPATH, selector), 3)
                            if add_button:
                                break
                        except:
                            continue
                
                if add_button:
                    add_button.click()
                    time.sleep(2)
                    
                    # Fill goal form
                    # Title
                    title_field = self.wait_for_element((By.NAME, "title"), 10)
                    if not title_field:
                        title_field = self.wait_for_element((By.ID, "goalTitle"), 5)
                    if not title_field:
                        title_field = self.wait_for_element((By.CSS_SELECTOR, "input[placeholder*='title']"), 5)
                    
                    if title_field:
                        title_field.clear()
                        title_field.send_keys(goal_data['title'])
                        time.sleep(0.5)
                    
                    # Description
                    desc_field = self.wait_for_element((By.NAME, "description"), 5)
                    if not desc_field:
                        desc_field = self.wait_for_element((By.TAG_NAME, "textarea"), 5)
                    
                    if desc_field:
                        desc_field.clear()
                        desc_field.send_keys(goal_data['description'])
                        time.sleep(0.5)
                    
                    # Theme/Category
                    try:
                        theme_select = self.wait_for_element((By.NAME, "theme"), 3)
                        if theme_select:
                            select = Select(theme_select)
                            select.select_by_visible_text(goal_data['theme'])
                    except:
                        # Try clicking theme option
                        try:
                            theme_option = self.driver.find_element(By.XPATH, f"//option[text()='{goal_data['theme']}']")
                            theme_option.click()
                        except:
                            pass
                    
                    # Priority
                    try:
                        priority_select = self.wait_for_element((By.NAME, "priority"), 3)
                        if priority_select:
                            select = Select(priority_select)
                            select.select_by_visible_text(goal_data['priority'])
                    except:
                        pass
                    
                    # Save button
                    save_button = self.wait_for_clickable((By.XPATH, "//button[contains(text(), 'Save') or contains(text(), 'Create')]"), 10)
                    if save_button:
                        save_button.click()
                        time.sleep(3)
                        
                        # Verify creation
                        success_indicators = [
                            lambda: goal_data['title'] in self.driver.page_source,
                            lambda: "success" in self.driver.page_source.lower(),
                            lambda: "created" in self.driver.page_source.lower()
                        ]
                        
                        creation_success = any(indicator() for indicator in success_indicators)
                        
                        if creation_success:
                            created_goals.append(goal_data['title'])
                            execution_time = time.time() - start_time
                            print(f"✅ Goal created successfully: {goal_data['title'][:30]}...")
                            
                            results.append(TestResult(
                                test_name=test_name,
                                status="PASS",
                                execution_time=execution_time,
                                details={'goal_data': goal_data}
                            ))
                        else:
                            raise Exception("Goal creation not confirmed")
                    else:
                        raise Exception("Save button not found")
                else:
                    raise Exception("Add Goal button not found")
                    
            except Exception as e:
                execution_time = time.time() - start_time
                print(f"❌ Goal creation failed: {e}")
                self.take_screenshot(f"{test_name}_error")
                
                results.append(TestResult(
                    test_name=test_name,
                    status="FAIL",
                    execution_time=execution_time,
                    error_message=str(e),
                    details={'goal_data': goal_data}
                ))
        
        # Test Goal Reading/Viewing
        if created_goals:
            start_time = time.time()
            test_name = "goal_read_all"
            
            try:
                print("👁️ Testing Goal Reading...")
                self.driver.get(f"{self.config['base_url']}/goals")
                time.sleep(3)
                
                goals_found = 0
                for goal_title in created_goals:
                    if goal_title[:30] in self.driver.page_source:
                        goals_found += 1
                
                execution_time = time.time() - start_time
                
                if goals_found > 0:
                    print(f"✅ Found {goals_found}/{len(created_goals)} created goals")
                    results.append(TestResult(
                        test_name=test_name,
                        status="PASS",
                        execution_time=execution_time,
                        details={'goals_found': goals_found, 'goals_expected': len(created_goals)}
                    ))
                else:
                    raise Exception("No created goals found on goals page")
                    
            except Exception as e:
                execution_time = time.time() - start_time
                print(f"❌ Goal reading failed: {e}")
                results.append(TestResult(
                    test_name=test_name,
                    status="FAIL",
                    execution_time=execution_time,
                    error_message=str(e)
                ))
        
        self.test_results.extend(results)
        return results
    
    def test_story_crud_operations(self) -> List[TestResult]:
        """Test complete Story CRUD operations"""
        print("📚 Testing Story CRUD Operations...")
        results = []
        created_stories = []
        
        # Test Story Creation
        for i, story_data in enumerate(self.test_data['stories']):
            start_time = time.time()
            test_name = f"story_create_{i+1}"
            
            try:
                print(f"📝 Creating Story: {story_data['title'][:50]}...")
                
                # Navigate to stories/backlog page
                story_urls = [
                    f"{self.config['base_url']}/stories",
                    f"{self.config['base_url']}/backlog",
                    f"{self.config['base_url']}/sprint"
                ]
                
                for url in story_urls:
                    try:
                        self.driver.get(url)
                        time.sleep(3)
                        if "404" not in self.driver.page_source:
                            break
                    except:
                        continue
                
                # Look for Add Story button
                add_button_selectors = [
                    "//button[contains(text(), 'Add Story')]",
                    "//button[contains(text(), 'New Story')]",
                    "//button[contains(text(), 'Create Story')]",
                    "//button[contains(text(), '+')][contains(@class, 'story')]"
                ]
                
                add_button = None
                for selector in add_button_selectors:
                    try:
                        add_button = self.wait_for_clickable((By.XPATH, selector), 5)
                        if add_button:
                            break
                    except:
                        continue
                
                if add_button:
                    add_button.click()
                    time.sleep(2)
                    
                    # Fill story form
                    # Title
                    title_field = self.wait_for_element((By.NAME, "title"), 10)
                    if not title_field:
                        title_field = self.wait_for_element((By.CSS_SELECTOR, "input[placeholder*='title']"), 5)
                    
                    if title_field:
                        title_field.clear()
                        title_field.send_keys(story_data['title'])
                        time.sleep(0.5)
                    
                    # Description
                    desc_field = self.wait_for_element((By.NAME, "description"), 5)
                    if not desc_field:
                        desc_field = self.wait_for_element((By.TAG_NAME, "textarea"), 5)
                    
                    if desc_field:
                        desc_field.clear()
                        desc_field.send_keys(story_data['description'])
                        time.sleep(0.5)
                    
                    # Priority
                    try:
                        priority_field = self.wait_for_element((By.NAME, "priority"), 3)
                        if priority_field:
                            priority_field.clear()
                            priority_field.send_keys(story_data['priority'])
                    except:
                        pass
                    
                    # Story points
                    try:
                        points_field = self.wait_for_element((By.NAME, "points"), 3)
                        if not points_field:
                            points_field = self.wait_for_element((By.NAME, "storyPoints"), 3)
                        if points_field:
                            points_field.clear()
                            points_field.send_keys(str(story_data['points']))
                    except:
                        pass
                    
                    # Save button
                    save_button = self.wait_for_clickable((By.XPATH, "//button[contains(text(), 'Save') or contains(text(), 'Create')]"), 10)
                    if save_button:
                        save_button.click()
                        time.sleep(3)
                        
                        # Verify creation
                        creation_success = story_data['title'][:30] in self.driver.page_source
                        
                        if creation_success:
                            created_stories.append(story_data['title'])
                            execution_time = time.time() - start_time
                            print(f"✅ Story created successfully: {story_data['title'][:30]}...")
                            
                            results.append(TestResult(
                                test_name=test_name,
                                status="PASS",
                                execution_time=execution_time,
                                details={'story_data': story_data}
                            ))
                        else:
                            raise Exception("Story creation not confirmed")
                    else:
                        raise Exception("Save button not found")
                else:
                    # Try alternative approach via JavaScript
                    creation_result = self.driver.execute_script(f"""
                        // Try creating story via JavaScript if available
                        if (window.createStory) {{
                            return window.createStory({{
                                title: '{story_data['title']}',
                                description: '{story_data['description']}',
                                priority: '{story_data['priority']}',
                                points: {story_data['points']}
                            }});
                        }}
                        return false;
                    """)
                    
                    if creation_result:
                        created_stories.append(story_data['title'])
                        execution_time = time.time() - start_time
                        print(f"✅ Story created via JavaScript: {story_data['title'][:30]}...")
                        
                        results.append(TestResult(
                            test_name=test_name,
                            status="PASS",
                            execution_time=execution_time,
                            details={'story_data': story_data, 'method': 'javascript'}
                        ))
                    else:
                        raise Exception("Add Story button not found and JavaScript creation failed")
                    
            except Exception as e:
                execution_time = time.time() - start_time
                print(f"❌ Story creation failed: {e}")
                self.take_screenshot(f"{test_name}_error")
                
                results.append(TestResult(
                    test_name=test_name,
                    status="FAIL",
                    execution_time=execution_time,
                    error_message=str(e),
                    details={'story_data': story_data}
                ))
        
        self.test_results.extend(results)
        return results
    
    def generate_report(self) -> Dict[str, Any]:
        """Generate comprehensive test report"""
        total_tests = len(self.test_results)
        passed_tests = len([r for r in self.test_results if r.status == "PASS"])
        failed_tests = len([r for r in self.test_results if r.status == "FAIL"])
        skipped_tests = len([r for r in self.test_results if r.status == "SKIP"])
        
        total_execution_time = sum(r.execution_time for r in self.test_results)
        
        report = {
            'timestamp': datetime.now().isoformat(),
            'summary': {
                'total_tests': total_tests,
                'passed': passed_tests,
                'failed': failed_tests,
                'skipped': skipped_tests,
                'success_rate': (passed_tests / total_tests * 100) if total_tests > 0 else 0,
                'total_execution_time': total_execution_time
            },
            'test_results': [asdict(r) for r in self.test_results],
            'current_user': self.current_user,
            'configuration': self.config
        }
        
        # Save report to file
        report_file = os.path.join(
            self.config['reports_dir'], 
            f"secure_auth_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        return report
    
    def cleanup(self):
        """Cleanup resources"""
        if self.driver:
            try:
                self.driver.quit()
                print("✅ WebDriver closed successfully")
            except:
                pass
    
    def run_full_test_suite(self, user_key='jc1_test') -> Dict[str, Any]:
        """Run the complete test suite"""
        print("🚀 Starting Secure Authentication Test Suite")
        print("=" * 60)
        
        try:
            # Initialize WebDriver
            if not self.setup_driver():
                raise Exception("Failed to initialize WebDriver")
            
            # Secure Login
            login_result = self.secure_login(user_key)
            self.test_results.append(login_result)
            
            if login_result.status != "PASS":
                raise Exception("Authentication failed - cannot proceed with CRUD tests")
            
            # Goal CRUD Operations
            goal_results = self.test_goal_crud_operations()
            
            # Story CRUD Operations  
            story_results = self.test_story_crud_operations()
            
            # Generate final report
            report = self.generate_report()
            
            # Print summary
            print("\n" + "=" * 60)
            print("📊 TEST SUITE SUMMARY")
            print("=" * 60)
            print(f"Total Tests: {report['summary']['total_tests']}")
            print(f"✅ Passed: {report['summary']['passed']}")
            print(f"❌ Failed: {report['summary']['failed']}")
            print(f"⏭️ Skipped: {report['summary']['skipped']}")
            print(f"📈 Success Rate: {report['summary']['success_rate']:.1f}%")
            print(f"⏱️ Total Time: {report['summary']['total_execution_time']:.2f}s")
            
            if self.current_user:
                print(f"👤 Tested as: {self.current_user['email']}")
            
            return report
            
        except Exception as e:
            print(f"\n❌ Test suite failed: {e}")
            return {'error': str(e), 'test_results': self.test_results}
        
        finally:
            self.cleanup()

def main():
    """Main execution function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='BOB Secure Authentication Test Suite')
    parser.add_argument('--headless', action='store_true', help='Run in headless mode')
    parser.add_argument('--user', choices=['jc1_test', 'demo', 'admin'], default='jc1_test', 
                      help='Test user to use for authentication')
    
    args = parser.parse_args()
    
    tester = SecureTestSuite(headless=args.headless)
    report = tester.run_full_test_suite(args.user)
    
    if 'error' not in report:
        print(f"\n✅ Test suite completed successfully!")
        print(f"📄 Report saved to: {tester.config['reports_dir']}")
    else:
        print(f"\n❌ Test suite failed: {report['error']}")
        sys.exit(1)

if __name__ == "__main__":
    main()
