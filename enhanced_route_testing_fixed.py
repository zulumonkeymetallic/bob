#!/usr/bin/env python3
"""
BOB v3.5.5 - Enhanced Goal CRUD Testing with Test User Creation
Comprehensive headless testing for all aspects of goals management
"""

import time
import json
import os
import sys
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass, asdict, field
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.firefox.service import Service as FirefoxService
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.firefox import GeckoDriverManager
from selenium.common.exceptions import (
    TimeoutException, 
    NoSuchElementException, 
    WebDriverException,
    ElementNotInteractableException
)

@dataclass
class TestUser:
    """Test user configuration"""
    uid: str
    email: str
    display_name: str
    auth_token: str = ""
    persona: str = "personal"

@dataclass
class GoalTestData:
    """Goal test data structure"""
    title: str
    description: str
    theme: str
    size: str
    confidence: int
    time_to_master_hours: int
    target_date: str
    status: str = "Not Started"
    persona: str = "personal"

@dataclass
class TestResult:
    """Test result tracking"""
    test_name: str
    status: str  # PASS, FAIL, SKIP
    duration: float
    error_message: str = ""
    screenshot_path: str = ""
    details: Optional[Dict[str, Any]] = field(default_factory=dict)

@dataclass
class DefectReport:
    """Defect reporting structure"""
    type: str  # CRITICAL, HIGH, MEDIUM, LOW
    category: str
    message: str
    timestamp: str
    url: str = ""
    screenshot_path: str = ""
    console_logs: Optional[List[str]] = field(default_factory=list)
    stack_trace: str = ""
    details: Optional[Dict[str, Any]] = field(default_factory=dict)

class BOBGoalsCRUDTester:
    """
    Comprehensive CRUD testing for BOB Goals with headless automation
    """
    
    def __init__(self, browser='firefox', headless=True):
        self.browser = browser.lower()
        self.headless = headless
        self.driver: Optional[Union[webdriver.Firefox, webdriver.Chrome]] = None
        self.test_results: List[TestResult] = []
        self.defects: List[DefectReport] = []
        self.created_goals: List[str] = []  # Track created goal IDs for cleanup
        
        # Test configuration
        self.config = {
            'base_url': 'https://bob20250810.web.app',
            'timeout': 30,
            'implicit_wait': 10,
            'screenshot_dir': './test-results/screenshots',
            'reports_dir': './test-results',
            'test_data_dir': './test-results/test-data'
        }
        
        # Test users configuration
        self.test_users = [
            TestUser(
                uid='ai-test-user-12345abcdef',
                email='ai-test-agent@bob.local',
                display_name='AI Test Agent',
                auth_token='ai-agent-token'
            ),
            TestUser(
                uid='automation-test-67890ghijk',
                email='automation@bob.local',
                display_name='Test Automation',
                auth_token='automation-token'
            ),
            TestUser(
                uid='crud-test-98765fedcba',
                email='crud-test@bob.local',
                display_name='CRUD Test User',
                auth_token='crud-test-token'
            )
        ]
        
        # Comprehensive test goals data
        self.test_goals_data = [
            GoalTestData(
                title="Automated Test Goal - Create Operation",
                description="Testing goal creation through automation",
                theme="Growth",
                size="M",
                confidence=8,
                time_to_master_hours=40,
                target_date=(datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
                status="Not Started"
            ),
            GoalTestData(
                title="Automated Test Goal - Update Operation",
                description="Testing goal updates and modifications",
                theme="Health",
                size="L",
                confidence=7,
                time_to_master_hours=80,
                target_date=(datetime.now() + timedelta(days=60)).strftime("%Y-%m-%d"),
                status="In Progress"
            ),
            GoalTestData(
                title="Automated Test Goal - Delete Operation",
                description="Testing goal deletion functionality",
                theme="Learning",
                size="S",
                confidence=6,
                time_to_master_hours=20,
                target_date=(datetime.now() + timedelta(days=15)).strftime("%Y-%m-%d"),
                status="Completed"
            ),
            GoalTestData(
                title="Automated Test Goal - Complex Data",
                description="Testing goal with complex data structures and special characters: éñüíç@#$%",
                theme="Career",
                size="XL",
                confidence=9,
                time_to_master_hours=160,
                target_date=(datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d"),
                status="Paused"
            )
        ]
        
        # Ensure directories exist
        for dir_path in [self.config['screenshot_dir'], self.config['reports_dir'], self.config['test_data_dir']]:
            os.makedirs(dir_path, exist_ok=True)
    
    def setup_driver(self):
        """Initialize WebDriver with headless configuration"""
        try:
            if self.browser == 'firefox':
                options = FirefoxOptions()
                if self.headless:
                    options.add_argument('--headless')
                options.add_argument('--no-sandbox')
                options.add_argument('--disable-dev-shm-usage')
                options.add_argument('--window-size=1920,1080')
                
                service = FirefoxService(GeckoDriverManager().install())
                self.driver = webdriver.Firefox(service=service, options=options)
                
            elif self.browser == 'chrome':
                options = ChromeOptions()
                if self.headless:
                    options.add_argument('--headless')
                options.add_argument('--no-sandbox')
                options.add_argument('--disable-dev-shm-usage')
                options.add_argument('--disable-gpu')
                options.add_argument('--window-size=1920,1080')
                
                service = ChromeService(ChromeDriverManager().install())
                self.driver = webdriver.Chrome(service=service, options=options)
            
            if self.driver:
                self.driver.implicitly_wait(self.config['implicit_wait'])
            print(f"✅ {self.browser.title()} driver initialized successfully (headless: {self.headless})")
            
        except Exception as e:
            self.add_defect("CRITICAL", "DRIVER_INITIALIZATION", f"Failed to initialize {self.browser} driver: {str(e)}")
            raise

    def add_defect(self, type: str, category: str, message: str, **kwargs):
        """Add defect with automatic screenshot capture"""
        try:
            screenshot_path = ""
            if self.driver:
                screenshot_filename = f"{category}_{int(time.time())}.png"
                screenshot_path = os.path.join(self.config['screenshot_dir'], screenshot_filename)
                self.driver.save_screenshot(screenshot_path)
                
            console_logs = []
            if self.driver:
                try:
                    # Note: get_log might not be available in all browsers
                    if hasattr(self.driver, 'get_log'):
                        logs = self.driver.get_log('browser')
                        console_logs = [log['message'] for log in logs if log['level'] in ['SEVERE', 'WARNING']]
                except Exception:
                    pass
                    
            defect = DefectReport(
                type=type,
                category=category,
                message=message,
                timestamp=datetime.now().isoformat(),
                url=self.driver.current_url if self.driver else "",
                screenshot_path=screenshot_path,
                console_logs=console_logs,
                **kwargs
            )
            
            self.defects.append(defect)
            print(f"🐛 {type} DEFECT: {category} - {message}")
            
        except Exception as e:
            print(f"❌ Error recording defect: {e}")

    def add_test_result(self, test_name: str, status: str, duration: float, error_message: str = ""):
        """Add test result to tracking"""
        screenshot_path = ""
        if self.driver and status == "FAIL":
            screenshot_filename = f"test_{test_name.replace(' ', '_')}_{int(time.time())}.png"
            screenshot_path = os.path.join(self.config['screenshot_dir'], screenshot_filename)
            self.driver.save_screenshot(screenshot_path)
        
        result = TestResult(
            test_name=test_name,
            status=status,
            duration=duration,
            error_message=error_message,
            screenshot_path=screenshot_path
        )
        self.test_results.append(result)
        print(f"📝 TEST {status}: {test_name} ({duration:.2f}s)")

    def authenticate_with_test_user(self, test_user: TestUser) -> bool:
        """Authenticate using side-door authentication"""
        try:
            print(f"🔐 Authenticating with test user: {test_user.email}")
            
            # Navigate to test login URL
            test_url = f"{self.config['base_url']}?test-login={test_user.auth_token}&test-mode=true"
            self.driver.get(test_url)
            
            # Wait for authentication to complete
            WebDriverWait(self.driver, 30).until(
                lambda driver: "test-mode=true" in driver.current_url or 
                              driver.find_elements(By.CSS_SELECTOR, "[data-testid='user-info'], .user-display, .sidebar")
            )
            
            # Verify authentication success
            time.sleep(3)  # Allow auth state to propagate
            
            # Check for user interface elements
            auth_indicators = [
                "[data-testid='user-info']",
                ".user-display",
                ".sidebar-user",
                ".auth-user-name",
                ".user-menu",
                "[data-testid='sidebar']"
            ]
            
            authenticated = False
            for selector in auth_indicators:
                if self.driver.find_elements(By.CSS_SELECTOR, selector):
                    authenticated = True
                    break
            
            if authenticated:
                print(f"✅ Successfully authenticated as {test_user.display_name}")
                return True
            else:
                self.add_defect("HIGH", "AUTHENTICATION_FAILED", f"Could not verify authentication for {test_user.email}")
                return False
                
        except Exception as e:
            self.add_defect("CRITICAL", "AUTHENTICATION_ERROR", f"Authentication failed for {test_user.email}: {str(e)}")
            return False

    def navigate_to_goals_page(self) -> bool:
        """Navigate to goals management page"""
        try:
            print("📍 Navigating to Goals page...")
            goals_url = f"{self.config['base_url']}/goals"
            self.driver.get(goals_url)
            
            # Wait for goals page to load
            WebDriverWait(self.driver, 20).until(
                EC.any_of(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='goals-table']")),
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".goals-container")),
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".card-view-container")),
                    EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='add-goal-btn']")),
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".btn-primary"))
                )
            )
            
            print("✅ Successfully navigated to Goals page")
            return True
            
        except TimeoutException:
            self.add_defect("HIGH", "PAGE_NAVIGATION_FAILED", "Could not navigate to Goals page - page elements not found")
            return False
        except Exception as e:
            self.add_defect("HIGH", "PAGE_NAVIGATION_ERROR", f"Error navigating to Goals page: {str(e)}")
            return False

    def test_goal_creation(self, goal_data: GoalTestData) -> bool:
        """Test goal creation through UI"""
        start_time = time.time()
        test_name = f"Goal Creation - {goal_data.title}"
        
        try:
            print(f"🎯 Testing goal creation: {goal_data.title}")
            
            # Find and click Add Goal button
            add_goal_selectors = [
                "[data-testid='add-goal-btn']",
                ".btn-primary:contains('Add Goal')",
                ".btn:contains('Add Goal')",
                ".btn:contains('Create Goal')",
                "button:contains('Add Goal')",
                "[data-testid='create-goal-button']"
            ]
            
            add_button = None
            for selector in add_goal_selectors:
                try:
                    if "contains" in selector:
                        # Use XPath for text-based selectors
                        xpath_selector = f"//button[contains(text(), 'Add Goal') or contains(text(), 'Create Goal')]"
                        elements = self.driver.find_elements(By.XPATH, xpath_selector)
                        if elements:
                            add_button = elements[0]
                            break
                    else:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                        if elements:
                            add_button = elements[0]
                            break
                except:
                    continue
            
            if not add_button:
                self.add_defect("HIGH", "UI_ELEMENT_MISSING", "Add Goal button not found")
                self.add_test_result(test_name, "FAIL", time.time() - start_time, "Add Goal button not found")
                return False
            
            # Click the Add Goal button
            self.driver.execute_script("arguments[0].scrollIntoView(true);", add_button)
            time.sleep(1)
            add_button.click()
            
            # Wait for modal or form to appear
            WebDriverWait(self.driver, 10).until(
                EC.any_of(
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".modal")),
                    EC.presence_of_element_located((By.CSS_SELECTOR, "[data-testid='goal-form']")),
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".goal-creation-form")),
                    EC.presence_of_element_located((By.CSS_SELECTOR, "input[name='title'], input[id*='title']"))
                )
            )
            
            # Fill out goal form
            self.fill_goal_form(goal_data)
            
            # Submit the form
            submit_selectors = [
                "button[type='submit']",
                ".btn-primary:contains('Create')",
                ".btn:contains('Save')",
                "[data-testid='submit-goal']",
                "button:contains('Create Goal')"
            ]
            
            submitted = False
            for selector in submit_selectors:
                try:
                    if "contains" in selector:
                        xpath_selector = f"//button[contains(text(), 'Create') or contains(text(), 'Save')]"
                        elements = self.driver.find_elements(By.XPATH, xpath_selector)
                        if elements:
                            elements[0].click()
                            submitted = True
                            break
                    else:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                        if elements:
                            elements[0].click()
                            submitted = True
                            break
                except:
                    continue
            
            if not submitted:
                self.add_defect("HIGH", "FORM_SUBMISSION_FAILED", "Could not find or click submit button")
                self.add_test_result(test_name, "FAIL", time.time() - start_time, "Submit button not found")
                return False
            
            # Wait for goal to appear in list
            time.sleep(3)
            
            # Verify goal creation
            goal_created = self.verify_goal_in_list(goal_data.title)
            
            if goal_created:
                print(f"✅ Goal created successfully: {goal_data.title}")
                self.add_test_result(test_name, "PASS", time.time() - start_time)
                return True
            else:
                self.add_defect("HIGH", "GOAL_CREATION_VERIFICATION_FAILED", f"Goal not found in list after creation: {goal_data.title}")
                self.add_test_result(test_name, "FAIL", time.time() - start_time, "Goal not found after creation")
                return False
                
        except Exception as e:
            self.add_defect("HIGH", "GOAL_CREATION_ERROR", f"Error during goal creation: {str(e)}")
            self.add_test_result(test_name, "FAIL", time.time() - start_time, str(e))
            return False

    def fill_goal_form(self, goal_data: GoalTestData):
        """Fill out the goal creation form"""
        print(f"📝 Filling goal form with data: {goal_data.title}")
        
        # Title field
        title_selectors = ["input[name='title']", "#title", "input[id*='title']", ".form-control[placeholder*='title']"]
        self.fill_field(title_selectors, goal_data.title, "Title")
        
        # Description field
        desc_selectors = ["textarea[name='description']", "#description", "textarea[id*='description']", ".form-control[placeholder*='description']"]
        self.fill_field(desc_selectors, goal_data.description, "Description")
        
        # Theme selection
        theme_selectors = ["select[name='theme']", "#theme", "select[id*='theme']"]
        self.select_dropdown(theme_selectors, goal_data.theme, "Theme")
        
        # Size selection
        size_selectors = ["select[name='size']", "#size", "select[id*='size']"]
        self.select_dropdown(size_selectors, goal_data.size, "Size")
        
        # Confidence level
        confidence_selectors = ["input[name='confidence']", "#confidence", "input[id*='confidence']", "input[type='range']"]
        self.fill_field(confidence_selectors, str(goal_data.confidence), "Confidence")
        
        # Time to master hours
        hours_selectors = ["input[name='timeToMasterHours']", "#timeToMasterHours", "input[id*='hours']"]
        self.fill_field(hours_selectors, str(goal_data.time_to_master_hours), "Time to Master Hours")
        
        # Target date
        date_selectors = ["input[name='targetDate']", "#targetDate", "input[type='date']", "input[id*='date']"]
        self.fill_field(date_selectors, goal_data.target_date, "Target Date")

    def fill_field(self, selectors: List[str], value: str, field_name: str):
        """Fill a form field using multiple selector strategies"""
        for selector in selectors:
            try:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    element = elements[0]
                    element.clear()
                    element.send_keys(value)
                    print(f"  ✅ Filled {field_name}: {value}")
                    return True
            except Exception as e:
                continue
        
        print(f"  ⚠️ Could not fill {field_name} field")
        return False

    def select_dropdown(self, selectors: List[str], value: str, field_name: str):
        """Select dropdown option using multiple selector strategies"""
        for selector in selectors:
            try:
                elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    select = Select(elements[0])
                    try:
                        select.select_by_visible_text(value)
                        print(f"  ✅ Selected {field_name}: {value}")
                        return True
                    except:
                        select.select_by_value(value)
                        print(f"  ✅ Selected {field_name}: {value}")
                        return True
            except Exception as e:
                continue
        
        print(f"  ⚠️ Could not select {field_name} dropdown")
        return False

    def verify_goal_in_list(self, goal_title: str) -> bool:
        """Verify goal appears in the goals list"""
        try:
            # Wait a moment for the list to update
            time.sleep(2)
            
            # Look for the goal in various list formats
            goal_selectors = [
                f"//td[contains(text(), '{goal_title}')]",
                f"//div[contains(text(), '{goal_title}')]",
                f"//span[contains(text(), '{goal_title}')]",
                f"//*[contains(@class, 'goal')]//*[contains(text(), '{goal_title}')]",
                f"//*[contains(@data-testid, 'goal')]//*[contains(text(), '{goal_title}')]"
            ]
            
            for selector in goal_selectors:
                try:
                    elements = self.driver.find_elements(By.XPATH, selector)
                    if elements:
                        print(f"  ✅ Goal found in list: {goal_title}")
                        return True
                except:
                    continue
            
            print(f"  ❌ Goal not found in list: {goal_title}")
            return False
            
        except Exception as e:
            print(f"  ❌ Error verifying goal in list: {str(e)}")
            return False

    def test_goal_update(self, goal_title: str, updates: Dict[str, str]) -> bool:
        """Test goal update functionality"""
        start_time = time.time()
        test_name = f"Goal Update - {goal_title}"
        
        try:
            print(f"✏️ Testing goal update: {goal_title}")
            
            # Find and click on the goal to edit
            goal_found = self.find_and_click_goal(goal_title)
            if not goal_found:
                self.add_test_result(test_name, "FAIL", time.time() - start_time, "Goal not found for editing")
                return False
            
            # Look for edit button or modal
            edit_selectors = [
                "button:contains('Edit')",
                ".btn-edit",
                "[data-testid='edit-goal']",
                ".fa-edit",
                ".edit-icon"
            ]
            
            # Apply updates
            for field, value in updates.items():
                if field == "title":
                    self.fill_field(["input[name='title']", "#title"], value, "Title")
                elif field == "description":
                    self.fill_field(["textarea[name='description']", "#description"], value, "Description")
                elif field == "status":
                    self.select_dropdown(["select[name='status']", "#status"], value, "Status")
            
            # Save changes
            save_selectors = [
                "button:contains('Save')",
                "button[type='submit']",
                ".btn-primary:contains('Update')"
            ]
            
            saved = False
            for selector in save_selectors:
                try:
                    if "contains" in selector:
                        xpath_selector = f"//button[contains(text(), 'Save') or contains(text(), 'Update')]"
                        elements = self.driver.find_elements(By.XPATH, xpath_selector)
                        if elements:
                            elements[0].click()
                            saved = True
                            break
                    else:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                        if elements:
                            elements[0].click()
                            saved = True
                            break
                except:
                    continue
            
            if saved:
                time.sleep(2)
                print(f"✅ Goal updated successfully: {goal_title}")
                self.add_test_result(test_name, "PASS", time.time() - start_time)
                return True
            else:
                self.add_defect("MEDIUM", "GOAL_UPDATE_SAVE_FAILED", "Could not save goal updates")
                self.add_test_result(test_name, "FAIL", time.time() - start_time, "Could not save updates")
                return False
                
        except Exception as e:
            self.add_defect("HIGH", "GOAL_UPDATE_ERROR", f"Error during goal update: {str(e)}")
            self.add_test_result(test_name, "FAIL", time.time() - start_time, str(e))
            return False

    def find_and_click_goal(self, goal_title: str) -> bool:
        """Find and click on a goal in the list"""
        try:
            # Look for goal in table/card view
            goal_selectors = [
                f"//tr[contains(., '{goal_title}')]",
                f"//div[contains(@class, 'card') and contains(., '{goal_title}')]",
                f"//*[contains(text(), '{goal_title}')]"
            ]
            
            for selector in goal_selectors:
                try:
                    elements = self.driver.find_elements(By.XPATH, selector)
                    if elements:
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", elements[0])
                        time.sleep(1)
                        elements[0].click()
                        return True
                except:
                    continue
            
            return False
            
        except Exception as e:
            print(f"Error finding goal: {str(e)}")
            return False

    def test_goal_deletion(self, goal_title: str) -> bool:
        """Test goal deletion functionality"""
        start_time = time.time()
        test_name = f"Goal Deletion - {goal_title}"
        
        try:
            print(f"🗑️ Testing goal deletion: {goal_title}")
            
            # Find the goal
            goal_found = self.find_and_click_goal(goal_title)
            if not goal_found:
                self.add_test_result(test_name, "FAIL", time.time() - start_time, "Goal not found for deletion")
                return False
            
            # Look for delete button
            delete_selectors = [
                "button:contains('Delete')",
                ".btn-delete",
                "[data-testid='delete-goal']",
                ".fa-trash",
                ".delete-icon"
            ]
            
            deleted = False
            for selector in delete_selectors:
                try:
                    if "contains" in selector:
                        xpath_selector = f"//button[contains(text(), 'Delete')]"
                        elements = self.driver.find_elements(By.XPATH, xpath_selector)
                        if elements:
                            elements[0].click()
                            
                            # Handle confirmation dialog
                            time.sleep(1)
                            confirm_selectors = [
                                "button:contains('Confirm')",
                                "button:contains('Yes')",
                                "button:contains('Delete')",
                                ".btn-danger"
                            ]
                            
                            for confirm_selector in confirm_selectors:
                                try:
                                    if "contains" in confirm_selector:
                                        confirm_xpath = f"//button[contains(text(), 'Confirm') or contains(text(), 'Yes') or contains(text(), 'Delete')]"
                                        confirm_elements = self.driver.find_elements(By.XPATH, confirm_xpath)
                                        if confirm_elements:
                                            confirm_elements[0].click()
                                            deleted = True
                                            break
                                    else:
                                        confirm_elements = self.driver.find_elements(By.CSS_SELECTOR, confirm_selector)
                                        if confirm_elements:
                                            confirm_elements[0].click()
                                            deleted = True
                                            break
                                except:
                                    continue
                            
                            if deleted:
                                break
                except:
                    continue
            
            if deleted:
                time.sleep(2)
                
                # Verify goal is no longer in list
                goal_still_exists = self.verify_goal_in_list(goal_title)
                if not goal_still_exists:
                    print(f"✅ Goal deleted successfully: {goal_title}")
                    self.add_test_result(test_name, "PASS", time.time() - start_time)
                    return True
                else:
                    self.add_defect("HIGH", "GOAL_DELETION_VERIFICATION_FAILED", f"Goal still exists after deletion: {goal_title}")
                    self.add_test_result(test_name, "FAIL", time.time() - start_time, "Goal still exists after deletion")
                    return False
            else:
                self.add_defect("MEDIUM", "GOAL_DELETION_BUTTON_NOT_FOUND", "Could not find or click delete button")
                self.add_test_result(test_name, "FAIL", time.time() - start_time, "Delete button not found")
                return False
                
        except Exception as e:
            self.add_defect("HIGH", "GOAL_DELETION_ERROR", f"Error during goal deletion: {str(e)}")
            self.add_test_result(test_name, "FAIL", time.time() - start_time, str(e))
            return False

    def run_comprehensive_crud_tests(self):
        """Run all CRUD tests for goals"""
        print("🚀 Starting comprehensive Goals CRUD testing...")
        
        # Test with each user
        for test_user in self.test_users:
            print(f"\n👤 Testing with user: {test_user.display_name}")
            
            # Authenticate
            if not self.authenticate_with_test_user(test_user):
                continue
            
            # Navigate to goals page
            if not self.navigate_to_goals_page():
                continue
            
            # Test Create operations
            print("\n📝 Testing CREATE operations...")
            created_goals = []
            for goal_data in self.test_goals_data:
                if self.test_goal_creation(goal_data):
                    created_goals.append(goal_data.title)
            
            # Test Update operations
            print("\n✏️ Testing UPDATE operations...")
            if created_goals:
                updates = {
                    "description": "Updated description through automation",
                    "status": "In Progress"
                }
                self.test_goal_update(created_goals[0], updates)
            
            # Test Read operations (implicit in other tests)
            print("\n👁️ READ operations tested implicitly through verification steps")
            
            # Test Delete operations
            print("\n🗑️ Testing DELETE operations...")
            for goal_title in created_goals[1:]:  # Keep first goal for update testing
                self.test_goal_deletion(goal_title)

    def generate_comprehensive_report(self):
        """Generate detailed test report"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_file = os.path.join(self.config['reports_dir'], f"BOB_Goals_CRUD_Test_Report_{timestamp}.md")
        
        # Calculate statistics
        total_tests = len(self.test_results)
        passed_tests = len([r for r in self.test_results if r.status == "PASS"])
        failed_tests = len([r for r in self.test_results if r.status == "FAIL"])
        
        total_defects = len(self.defects)
        critical_defects = len([d for d in self.defects if d.type == "CRITICAL"])
        high_defects = len([d for d in self.defects if d.type == "HIGH"])
        
        with open(report_file, 'w') as f:
            f.write(f"""# BOB Goals CRUD Testing Report
**Generated:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}  
**Browser:** {self.browser.title()} (Headless: {self.headless})  
**Test Users:** {len(self.test_users)} test users  

## Executive Summary

### Test Results
- **Total Tests:** {total_tests}
- **Passed:** {passed_tests} ({(passed_tests/total_tests*100):.1f}% if total_tests else 0)
- **Failed:** {failed_tests} ({(failed_tests/total_tests*100):.1f}% if total_tests else 0)

### Defect Summary
- **Total Defects:** {total_defects}
- **Critical:** {critical_defects} 🔴
- **High:** {high_defects} 🟠
- **Medium:** {len([d for d in self.defects if d.type == "MEDIUM"])} 🟡
- **Low:** {len([d for d in self.defects if d.type == "LOW"])} 🟢

## Test Results Detail

### ✅ Passed Tests
""")
            
            for result in [r for r in self.test_results if r.status == "PASS"]:
                f.write(f"- **{result.test_name}** - {result.duration:.2f}s\n")
            
            f.write("\n### ❌ Failed Tests\n")
            for result in [r for r in self.test_results if r.status == "FAIL"]:
                f.write(f"- **{result.test_name}** - {result.duration:.2f}s - {result.error_message}\n")
            
            f.write("\n## Defects Detail\n")
            for defect in self.defects:
                severity_emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢"}
                f.write(f"### {severity_emoji.get(defect.type, '🔵')} {defect.type} - {defect.category}\n")
                f.write(f"**Message:** {defect.message}\n")
                f.write(f"**URL:** {defect.url}\n")
                f.write(f"**Timestamp:** {defect.timestamp}\n")
                if defect.screenshot_path:
                    f.write(f"**Screenshot:** {defect.screenshot_path}\n")
                f.write("\n")
            
            f.write(f"""
## Test Environment
- **Base URL:** {self.config['base_url']}
- **Browser:** {self.browser.title()}
- **Headless Mode:** {self.headless}
- **Timeout Settings:** {self.config['timeout']}s

## Test Data Used
- **Test Users:** {len(self.test_users)}
- **Test Goals:** {len(self.test_goals_data)}

## Recommendations
""")
            
            if critical_defects > 0:
                f.write("🚨 **CRITICAL ISSUES FOUND** - Immediate attention required\n")
            if high_defects > 0:
                f.write("⚠️ **HIGH PRIORITY ISSUES** - Should be addressed before release\n")
            if passed_tests == total_tests:
                f.write("✅ **ALL TESTS PASSED** - Goals CRUD functionality working correctly\n")
            
            f.write(f"\n**Report Generated:** {datetime.now().isoformat()}\n")
        
        print(f"📄 Comprehensive report generated: {report_file}")
        
        # Also generate JSON data for programmatic access
        json_data = {
            "timestamp": datetime.now().isoformat(),
            "browser": self.browser,
            "headless": self.headless,
            "statistics": {
                "total_tests": total_tests,
                "passed_tests": passed_tests,
                "failed_tests": failed_tests,
                "total_defects": total_defects,
                "critical_defects": critical_defects,
                "high_defects": high_defects
            },
            "test_results": [asdict(r) for r in self.test_results],
            "defects": [asdict(d) for d in self.defects]
        }
        
        json_file = os.path.join(self.config['reports_dir'], f"BOB_Goals_CRUD_Test_Data_{timestamp}.json")
        with open(json_file, 'w') as f:
            json.dump(json_data, f, indent=2, default=str)
        
        return report_file

    def cleanup(self):
        """Cleanup resources"""
        if self.driver:
            try:
                self.driver.quit()
                print("✅ Browser driver cleaned up")
            except:
                pass

    def run(self):
        """Main test execution"""
        try:
            print("🧪 BOB Goals CRUD Testing Suite v3.5.5")
            print(f"🌐 Browser: {self.browser.title()} (Headless: {self.headless})")
            print(f"🎯 Target: {self.config['base_url']}")
            
            # Setup
            self.setup_driver()
            
            # Run comprehensive tests
            self.run_comprehensive_crud_tests()
            
            # Generate report
            report_file = self.generate_comprehensive_report()
            
            print(f"\n📊 Testing completed!")
            print(f"📄 Report: {report_file}")
            print(f"🖼️ Screenshots: {self.config['screenshot_dir']}")
            
            return len([r for r in self.test_results if r.status == "FAIL"]) == 0
            
        except Exception as e:
            print(f"❌ Fatal error during testing: {e}")
            self.add_defect("CRITICAL", "TESTING_FRAMEWORK_ERROR", f"Fatal testing error: {str(e)}")
            return False
        finally:
            self.cleanup()

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description="BOB Goals CRUD Testing Suite")
    parser.add_argument("--browser", choices=["firefox", "chrome"], default="firefox", help="Browser to use")
    parser.add_argument("--headless", action="store_true", default=True, help="Run in headless mode")
    parser.add_argument("--visible", action="store_true", help="Run in visible mode (opposite of headless)")
    
    args = parser.parse_args()
    
    # Handle visible flag
    headless = args.headless and not args.visible
    
    # Run tests
    tester = BOBGoalsCRUDTester(browser=args.browser, headless=headless)
    success = tester.run()
    
    exit_code = 0 if success else 1
    sys.exit(exit_code)

if __name__ == "__main__":
    main()
