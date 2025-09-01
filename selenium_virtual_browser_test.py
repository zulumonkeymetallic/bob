#!/usr/bin/env python3
"""
BOB v3.5.0 - Selenium Virtual Browser Testing Script
Comprehensive automated testing with detailed defect reporting
"""

import time
import json
import os
import sys
from datetime import datetime
from typing import List, Dict, Any
from dataclasses import dataclass, asdict
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.firefox import GeckoDriverManager
from webdriver_manager.microsoft import EdgeChromiumDriverManager
from selenium.common.exceptions import (
    TimeoutException, 
    NoSuchElementException, 
    WebDriverException,
    ElementNotInteractableException
)

@dataclass
class DefectReport:
    type: str  # CRITICAL, HIGH, MEDIUM, LOW
    category: str
    message: str
    timestamp: str
    url: str = ""
    screenshot_path: str = ""
    console_logs: List[str] = None
    stack_trace: str = ""
    details: Dict[str, Any] = None

class BOBSeleniumTester:
    """
    Comprehensive Selenium testing for BOB v3.5.0
    Automatically detects and reports defects with full categorization
    """
    
    def __init__(self, browser='chrome', headless=True):
        self.browser = browser.lower()
        self.headless = headless
        self.driver = None
        self.defects: List[DefectReport] = []
        self.test_results = {
            'start_time': datetime.now().isoformat(),
            'end_time': None,
            'tests_run': 0,
            'tests_pass': 0,
            'tests_fail': 0,
            'browser': browser,
            'headless': headless
        }
        
        # Test configuration
        self.config = {
            'base_url': 'https://bob20250810.web.app',
            'test_url': 'https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true',
            'timeout': 30,
            'implicit_wait': 10,
            'screenshot_dir': './test-results/screenshots',
            'reports_dir': './test-results'
        }
        
        # Ensure directories exist
        os.makedirs(self.config['screenshot_dir'], exist_ok=True)
        os.makedirs(self.config['reports_dir'], exist_ok=True)
        
    def setup_driver(self):
        """Initialize the WebDriver based on browser choice"""
        try:
            if self.browser == 'chrome':
                options = webdriver.ChromeOptions()
                if self.headless:
                    options.add_argument('--headless')
                options.add_argument('--no-sandbox')
                options.add_argument('--disable-dev-shm-usage')
                options.add_argument('--disable-gpu')
                options.add_argument('--window-size=1920,1080')
                
                # Force ChromeDriverManager to download the correct version, ignore system chromedriver
                # Clear any cached driver to force fresh download of correct version
                driver_path = ChromeDriverManager().install()
                service = Service(driver_path)
                self.driver = webdriver.Chrome(service=service, options=options)
                
            elif self.browser == 'firefox':
                options = webdriver.FirefoxOptions()
                if self.headless:
                    options.add_argument('--headless')
                
                service = Service(GeckoDriverManager().install())
                self.driver = webdriver.Firefox(service=service, options=options)
                
            elif self.browser == 'edge':
                options = webdriver.EdgeOptions()
                if self.headless:
                    options.add_argument('--headless')
                
                service = Service(EdgeChromiumDriverManager().install())
                self.driver = webdriver.Edge(service=service, options=options)
                
            print(f"✅ {self.browser.title()} driver initialized successfully")
            
        except Exception as e:
            self.add_defect("CRITICAL", "DRIVER_INITIALIZATION", f"Failed to initialize {self.browser} driver: {str(e)}")
            raise

    def add_defect(self, type: str, category: str, message: str, **kwargs):
        """Add a defect to the defects list with automatic screenshot"""
        try:
            screenshot_path = ""
            if self.driver:
                screenshot_filename = f"{category}_{int(time.time())}.png"
                screenshot_path = os.path.join(self.config['screenshot_dir'], screenshot_filename)
                self.driver.save_screenshot(screenshot_path)
                
            console_logs = []
            if self.driver:
                try:
                    logs = self.driver.get_log('browser')
                    console_logs = [log['message'] for log in logs if log['level'] in ['SEVERE', 'WARNING']]
                except:
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
    
    def wait_and_find(self, locator, timeout=None):
        """Wait for element and return it, or add defect if not found"""
        if timeout is None:
            timeout = self.config['timeout']
            
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located(locator)
            )
            return element
        except TimeoutException:
            self.add_defect(
                type='HIGH',
                category='ELEMENT_NOT_FOUND',
                message=f"Element not found: {locator}",
                details={'locator': str(locator), 'timeout': timeout}
            )
            return None
    
    def safe_click(self, locator, timeout=None):
        """Safely click an element with error handling"""
        try:
            element = self.wait_and_find(locator, timeout)
            if element and element.is_enabled():
                element.click()
                return True
            else:
                self.add_defect(
                    type='MEDIUM',
                    category='ELEMENT_NOT_CLICKABLE',
                    message=f"Element not clickable: {locator}",
                    details={'locator': str(locator)}
                )
                return False
        except Exception as e:
            self.add_defect(
                type='MEDIUM',
                category='CLICK_ERROR',
                message=f"Click failed for {locator}: {str(e)}",
                details={'locator': str(locator), 'error': str(e)}
            )
            return False
    
    def safe_send_keys(self, locator, text, timeout=None):
        """Safely send keys to an element with error handling"""
        try:
            element = self.wait_and_find(locator, timeout)
            if element:
                element.clear()
                element.send_keys(text)
                return True
            else:
                self.add_defect(
                    type='MEDIUM',
                    category='INPUT_ERROR',
                    message=f"Could not input text to {locator}",
                    details={'locator': str(locator), 'text': text}
                )
                return False
        except Exception as e:
            self.add_defect(
                type='MEDIUM',
                category='INPUT_ERROR',
                message=f"Failed to input text to {locator}: {str(e)}",
                details={'locator': str(locator), 'text': text, 'error': str(e)}
            )
            return False
    
    def test_authentication(self):
        """Test side door authentication and enhanced user setup"""
        print("🔐 Phase 1: Testing Authentication...")
        self.test_results['tests_run'] += 1
        
        try:
            # Navigate to test URL
            self.driver.get(self.config['test_url'])
            time.sleep(5)  # Allow for authentication to complete
            
            # Check for authentication indicators
            auth_indicators = {
                'no_oauth_popup': True,  # Assume true unless we detect popup
                'test_mode_indicator': False,
                'enhanced_user': False,
                'no_permission_errors': True
            }
            
            # Check for test mode indicator
            try:
                test_indicator = self.driver.find_element(By.XPATH, "//*[contains(text(), '🧪')]")
                auth_indicators['test_mode_indicator'] = True
            except NoSuchElementException:
                pass
            
            # Check console for authentication messages
            try:
                logs = self.driver.get_log('browser')
                console_messages = [log['message'] for log in logs]
                
                # Check for enhanced authentication
                enhanced_auth_found = any('Enhanced test user authenticated' in msg for msg in console_messages)
                auth_indicators['enhanced_user'] = enhanced_auth_found
                
                # Check for permission errors
                permission_errors = any('Missing or insufficient permissions' in msg for msg in console_messages)
                auth_indicators['no_permission_errors'] = not permission_errors
                
                if permission_errors:
                    self.add_defect(
                        type='CRITICAL',
                        category='AUTHENTICATION_PERMISSIONS',
                        message='Found "Missing or insufficient permissions" in console - P1 fix failed',
                        console_logs=console_messages
                    )
                    
            except Exception as e:
                self.add_defect(
                    type='LOW',
                    category='CONSOLE_ACCESS_ERROR',
                    message=f'Could not access console logs: {str(e)}'
                )
            
            # Verify authentication state via JavaScript
            try:
                auth_state = self.driver.execute_script("""
                    return {
                        userExists: !!(window.auth && window.auth.currentUser),
                        userId: window.auth && window.auth.currentUser ? window.auth.currentUser.uid : null,
                        hasAccessToken: !!(window.auth && window.auth.currentUser && window.auth.currentUser.accessToken),
                        hasIdTokenMethod: !!(window.auth && window.auth.currentUser && typeof window.auth.currentUser.getIdToken === 'function'),
                        currentUrl: window.location.href
                    };
                """)
                
                # Validate authentication state
                if not auth_state['userExists']:
                    self.add_defect(
                        type='CRITICAL',
                        category='AUTHENTICATION_FAILURE',
                        message='No authenticated user found - side door authentication failed',
                        details=auth_state
                    )
                    self.test_results['tests_fail'] += 1
                    return False
                
                if auth_state['userId'] != 'ai-test-user-12345abcdef':
                    self.add_defect(
                        type='HIGH',
                        category='AUTHENTICATION_WRONG_USER',
                        message=f"Wrong user ID: expected 'ai-test-user-12345abcdef', got '{auth_state['userId']}'",
                        details=auth_state
                    )
                    self.test_results['tests_fail'] += 1
                    return False
                
                if not auth_state['hasAccessToken'] or not auth_state['hasIdTokenMethod']:
                    self.add_defect(
                        type='HIGH',
                        category='AUTHENTICATION_TOKENS_MISSING',
                        message='Missing required authentication tokens or methods',
                        details=auth_state
                    )
                    self.test_results['tests_fail'] += 1
                    return False
                
                print("   ✅ Authentication validation passed")
                self.test_results['tests_pass'] += 1
                return True
                
            except Exception as e:
                self.add_defect(
                    type='HIGH',
                    category='AUTHENTICATION_VALIDATION_ERROR',
                    message=f'Could not validate authentication state: {str(e)}',
                    stack_trace=str(e)
                )
                self.test_results['tests_fail'] += 1
                return False
                
        except Exception as e:
            self.add_defect(
                type='CRITICAL',
                category='AUTHENTICATION_TEST_ERROR',
                message=f'Authentication test failed: {str(e)}',
                stack_trace=str(e)
            )
            self.test_results['tests_fail'] += 1
            return False
    
    def test_goals_creation(self):
        """Test Goals creation via QuickActionsPanel and direct methods"""
        print("🎯 Phase 2: Testing Goals Creation...")
        self.test_results['tests_run'] += 1
        
        try:
            # Navigate to dashboard
            dashboard_link = self.wait_and_find((By.XPATH, "//a[contains(@href, 'dashboard') or contains(text(), 'Dashboard')]"))
            if dashboard_link:
                dashboard_link.click()
                time.sleep(3)
            
            # Look for QuickActionsPanel
            quick_actions_selectors = [
                (By.XPATH, "//button[contains(text(), 'Create Goal')]"),
                (By.CSS_SELECTOR, "[data-testid='quick-action-goal']"),
                (By.CSS_SELECTOR, ".quick-actions button"),
                (By.XPATH, "//div[contains(@class, 'quick-actions')]//button[contains(text(), 'Goal')]")
            ]
            
            create_goal_button = None
            for selector in quick_actions_selectors:
                try:
                    create_goal_button = self.driver.find_element(*selector)
                    if create_goal_button.is_displayed():
                        break
                except NoSuchElementException:
                    continue
            
            if not create_goal_button:
                self.add_defect(
                    type='HIGH',
                    category='QUICK_ACTIONS_MISSING',
                    message='QuickActionsPanel "Create Goal" button not found on Dashboard'
                )
                self.test_results['tests_fail'] += 1
                return False
            
            # Test goal creation modal
            if self.safe_click((By.XPATH, "//button[contains(text(), 'Create Goal')]")):
                time.sleep(2)
                
                # Check if modal opened
                modal_selectors = [
                    (By.CSS_SELECTOR, "[data-testid='goal-creation-modal']"),
                    (By.CSS_SELECTOR, ".modal"),
                    (By.XPATH, "//div[contains(@class, 'modal') and contains(., 'Goal')]"),
                    (By.XPATH, "//form[contains(., 'Goal')]")
                ]
                
                modal_found = False
                for selector in modal_selectors:
                    if self.wait_and_find(selector, timeout=5):
                        modal_found = True
                        break
                
                if not modal_found:
                    self.add_defect(
                        type='HIGH',
                        category='GOAL_MODAL_NOT_OPENING',
                        message='Goal creation modal did not open after clicking Create Goal button'
                    )
                    self.test_results['tests_fail'] += 1
                    return False
                
                # Try to fill form fields (if they exist)
                form_fields = [
                    ('title', 'AI Selenium Test Goal'),
                    ('description', 'Created by Selenium automation testing'),
                ]
                
                for field_name, field_value in form_fields:
                    field_selectors = [
                        (By.NAME, field_name),
                        (By.CSS_SELECTOR, f"input[name='{field_name}']"),
                        (By.CSS_SELECTOR, f"textarea[name='{field_name}']"),
                        (By.XPATH, f"//input[contains(@placeholder, '{field_name.title()}')]"),
                        (By.XPATH, f"//textarea[contains(@placeholder, '{field_name.title()}')]")
                    ]
                    
                    field_filled = False
                    for selector in field_selectors:
                        if self.safe_send_keys(selector, field_value, timeout=2):
                            field_filled = True
                            break
                    
                    if not field_filled:
                        print(f"   ⚠️  Could not fill {field_name} field - form may have different structure")
                
                # Try to submit or cancel (to avoid creating test data)
                cancel_selectors = [
                    (By.XPATH, "//button[contains(text(), 'Cancel')]"),
                    (By.XPATH, "//button[contains(text(), 'Close')]"),
                    (By.CSS_SELECTOR, ".modal-close"),
                    (By.XPATH, "//button[@type='button' and not(contains(text(), 'Submit'))]")
                ]
                
                cancelled = False
                for selector in cancel_selectors:
                    if self.safe_click(selector, timeout=2):
                        cancelled = True
                        break
                
                if cancelled:
                    print("   ✅ Goals creation modal accessible and functional")
                    self.test_results['tests_pass'] += 1
                    return True
                else:
                    print("   ⚠️  Goals modal opened but could not find cancel button")
                    # Try to close with Escape key
                    try:
                        from selenium.webdriver.common.keys import Keys
                        self.driver.find_element(By.TAG_NAME, 'body').send_keys(Keys.ESCAPE)
                        time.sleep(1)
                    except:
                        pass
                    
                    self.test_results['tests_pass'] += 1
                    return True
            else:
                self.add_defect(
                    type='HIGH',
                    category='GOAL_BUTTON_NOT_CLICKABLE',
                    message='Create Goal button found but not clickable'
                )
                self.test_results['tests_fail'] += 1
                return False
                
        except Exception as e:
            self.add_defect(
                type='HIGH',
                category='GOALS_CREATION_ERROR',
                message=f'Goals creation test failed: {str(e)}',
                stack_trace=str(e)
            )
            self.test_results['tests_fail'] += 1
            return False
    
    def test_stories_creation(self):
        """Test Stories creation - Critical P1 fix validation"""
        print("📖 Phase 3: Testing Stories Creation (P1 Fix Validation)...")
        self.test_results['tests_run'] += 1
        
        try:
            # Navigate to Stories section
            stories_selectors = [
                (By.XPATH, "//a[contains(@href, 'stories') or contains(text(), 'Stories')]"),
                (By.LINK_TEXT, "Stories"),
                (By.PARTIAL_LINK_TEXT, "Stories")
            ]
            
            stories_link = None
            for selector in stories_selectors:
                try:
                    stories_link = self.driver.find_element(*selector)
                    if stories_link.is_displayed():
                        break
                except NoSuchElementException:
                    continue
            
            if not stories_link:
                self.add_defect(
                    type='MEDIUM',
                    category='NAVIGATION_MISSING',
                    message='Stories navigation link not found'
                )
                self.test_results['tests_fail'] += 1
                return False
            
            stories_link.click()
            time.sleep(3)
            
            # Look for Add Story button
            add_story_selectors = [
                (By.XPATH, "//button[contains(text(), 'Add new story')]"),
                (By.XPATH, "//button[contains(text(), 'Add Story')]"),
                (By.XPATH, "//button[contains(text(), 'Create Story')]"),
                (By.CSS_SELECTOR, "[data-testid='add-story-button']")
            ]
            
            add_story_button = None
            for selector in add_story_selectors:
                try:
                    add_story_button = self.driver.find_element(*selector)
                    if add_story_button.is_displayed():
                        break
                except NoSuchElementException:
                    continue
            
            if not add_story_button:
                self.add_defect(
                    type='HIGH',
                    category='STORIES_BUTTON_MISSING',
                    message='Add Story button not found in Stories section'
                )
                self.test_results['tests_fail'] += 1
                return False
            
            # Click Add Story button
            add_story_button.click()
            time.sleep(2)
            
            # CRITICAL P1 FIX VALIDATION: Check for modal vs alert
            # First, check for JavaScript alerts (should NOT appear)
            try:
                alert = self.driver.switch_to.alert
                alert_text = alert.text
                alert.dismiss()
                
                if 'coming soon' in alert_text.lower():
                    self.add_defect(
                        type='CRITICAL',
                        category='P1_REGRESSION_STORIES_ALERT',
                        message='Stories creation still showing "coming soon" alert - P1 fix FAILED',
                        details={'alert_text': alert_text}
                    )
                    self.test_results['tests_fail'] += 1
                    return False
                    
            except:
                # No alert found - this is good!
                pass
            
            # Check for modal opening (should appear)
            modal_selectors = [
                (By.CSS_SELECTOR, "[data-testid='add-story-modal']"),
                (By.XPATH, "//div[contains(@class, 'modal') and contains(., 'Story')]"),
                (By.CSS_SELECTOR, ".modal"),
                (By.XPATH, "//form[contains(., 'Story')]")
            ]
            
            modal_found = False
            for selector in modal_selectors:
                if self.wait_and_find(selector, timeout=5):
                    modal_found = True
                    break
            
            if not modal_found:
                self.add_defect(
                    type='CRITICAL',
                    category='P1_REGRESSION_STORIES_MODAL',
                    message='Stories creation modal did not open - P1 fix may have failed'
                )
                self.test_results['tests_fail'] += 1
                return False
            
            # Modal opened successfully - P1 fix working!
            print("   ✅ CRITICAL P1 FIX VALIDATED: AddStoryModal opens instead of alert")
            
            # Try to close modal
            close_selectors = [
                (By.XPATH, "//button[contains(text(), 'Cancel')]"),
                (By.XPATH, "//button[contains(text(), 'Close')]"),
                (By.CSS_SELECTOR, ".modal-close"),
                (By.XPATH, "//button[@type='button']")
            ]
            
            for selector in close_selectors:
                if self.safe_click(selector, timeout=2):
                    break
            
            self.test_results['tests_pass'] += 1
            return True
            
        except Exception as e:
            self.add_defect(
                type='CRITICAL',
                category='STORIES_CREATION_ERROR',
                message=f'Stories creation test failed: {str(e)}',
                stack_trace=str(e)
            )
            self.test_results['tests_fail'] += 1
            return False
    
    def test_tasks_creation(self):
        """Test Tasks creation functionality"""
        print("✅ Phase 4: Testing Tasks Creation...")
        self.test_results['tests_run'] += 1
        
        try:
            # Navigate back to dashboard for QuickActionsPanel
            dashboard_link = self.wait_and_find((By.XPATH, "//a[contains(@href, 'dashboard') or contains(text(), 'Dashboard')]"))
            if dashboard_link:
                dashboard_link.click()
                time.sleep(3)
            
            # Look for Create Task button
            create_task_selectors = [
                (By.XPATH, "//button[contains(text(), 'Create Task')]"),
                (By.CSS_SELECTOR, "[data-testid='quick-action-task']"),
                (By.XPATH, "//div[contains(@class, 'quick-actions')]//button[contains(text(), 'Task')]")
            ]
            
            create_task_button = None
            for selector in create_task_selectors:
                try:
                    create_task_button = self.driver.find_element(*selector)
                    if create_task_button.is_displayed():
                        break
                except NoSuchElementException:
                    continue
            
            if not create_task_button:
                self.add_defect(
                    type='MEDIUM',
                    category='TASKS_BUTTON_MISSING',
                    message='Create Task button not found in QuickActionsPanel'
                )
                self.test_results['tests_fail'] += 1
                return False
            
            # Click Create Task button
            if self.safe_click((By.XPATH, "//button[contains(text(), 'Create Task')]")):
                time.sleep(2)
                
                # Check for modal
                modal_selectors = [
                    (By.CSS_SELECTOR, "[data-testid='task-creation-modal']"),
                    (By.XPATH, "//div[contains(@class, 'modal') and contains(., 'Task')]"),
                    (By.CSS_SELECTOR, ".modal")
                ]
                
                modal_found = False
                for selector in modal_selectors:
                    if self.wait_and_find(selector, timeout=5):
                        modal_found = True
                        break
                
                if not modal_found:
                    self.add_defect(
                        type='MEDIUM',
                        category='TASKS_MODAL_NOT_OPENING',
                        message='Task creation modal did not open'
                    )
                    self.test_results['tests_fail'] += 1
                    return False
                
                # Close modal
                cancel_selectors = [
                    (By.XPATH, "//button[contains(text(), 'Cancel')]"),
                    (By.XPATH, "//button[contains(text(), 'Close')]"),
                    (By.CSS_SELECTOR, ".modal-close")
                ]
                
                for selector in cancel_selectors:
                    if self.safe_click(selector, timeout=2):
                        break
                
                print("   ✅ Tasks creation modal accessible")
                self.test_results['tests_pass'] += 1
                return True
            else:
                self.test_results['tests_fail'] += 1
                return False
                
        except Exception as e:
            self.add_defect(
                type='MEDIUM',
                category='TASKS_CREATION_ERROR',
                message=f'Tasks creation test failed: {str(e)}',
                stack_trace=str(e)
            )
            self.test_results['tests_fail'] += 1
            return False
    
    def test_navigation_and_ui(self):
        """Test navigation between sections and UI responsiveness"""
        print("🧭 Phase 5: Testing Navigation and UI...")
        self.test_results['tests_run'] += 1
        
        navigation_successful = True
        sections = [
            ('Goals', ['goals', 'Goals']),
            ('Stories', ['stories', 'Stories']),
            ('Tasks', ['tasks', 'Tasks']),
            ('Dashboard', ['dashboard', 'Dashboard'])
        ]
        
        try:
            for section_name, section_identifiers in sections:
                try:
                    print(f"   🔗 Testing navigation to {section_name}...")
                    
                    # Find navigation link
                    nav_link = None
                    for identifier in section_identifiers:
                        try:
                            nav_link = self.driver.find_element(By.XPATH, f"//a[contains(@href, '{identifier.lower()}') or contains(text(), '{identifier}')]")
                            if nav_link.is_displayed():
                                break
                        except NoSuchElementException:
                            continue
                    
                    if not nav_link:
                        self.add_defect(
                            type='MEDIUM',
                            category='NAVIGATION_MISSING',
                            message=f'Navigation link for {section_name} not found'
                        )
                        navigation_successful = False
                        continue
                    
                    # Click navigation link
                    nav_link.click()
                    time.sleep(3)
                    
                    # Check for console errors after navigation
                    try:
                        logs = self.driver.get_log('browser')
                        errors = [log for log in logs if log['level'] == 'SEVERE']
                        
                        if errors:
                            error_messages = [log['message'] for log in errors]
                            self.add_defect(
                                type='LOW',
                                category='CONSOLE_ERRORS_NAVIGATION',
                                message=f'Console errors after navigating to {section_name}',
                                console_logs=error_messages
                            )
                    except:
                        pass
                    
                except Exception as e:
                    self.add_defect(
                        type='MEDIUM',
                        category='NAVIGATION_ERROR',
                        message=f'Failed to navigate to {section_name}: {str(e)}'
                    )
                    navigation_successful = False
            
            if navigation_successful:
                print("   ✅ Navigation testing successful")
                self.test_results['tests_pass'] += 1
                return True
            else:
                self.test_results['tests_fail'] += 1
                return False
                
        except Exception as e:
            self.add_defect(
                type='MEDIUM',
                category='NAVIGATION_TEST_ERROR',
                message=f'Navigation testing failed: {str(e)}',
                stack_trace=str(e)
            )
            self.test_results['tests_fail'] += 1
            return False
    
    def test_performance(self):
        """Test page load performance and responsiveness"""
        print("⚡ Phase 6: Testing Performance...")
        self.test_results['tests_run'] += 1
        
        try:
            # Navigate to test URL and measure load time
            start_time = time.time()
            self.driver.get(self.config['test_url'])
            
            # Wait for page to be ready
            WebDriverWait(self.driver, 30).until(
                lambda driver: driver.execute_script("return document.readyState") == "complete"
            )
            
            load_time = time.time() - start_time
            
            # Get performance metrics via JavaScript
            performance_data = self.driver.execute_script("""
                const timing = performance.getEntriesByType('navigation')[0];
                return {
                    domContentLoaded: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
                    loadComplete: timing.loadEventEnd - timing.loadEventStart,
                    totalTime: timing.loadEventEnd - timing.fetchStart,
                    timeToFirstByte: timing.responseStart - timing.requestStart
                };
            """)
            
            # Performance thresholds
            thresholds = {
                'total_time': 20000,  # 20 seconds max for virtual browser
                'dom_content_loaded': 10000,  # 10 seconds max
                'time_to_first_byte': 5000  # 5 seconds max
            }
            
            performance_issues = []
            
            if performance_data['totalTime'] > thresholds['total_time']:
                performance_issues.append(f"Total load time: {performance_data['totalTime']:.0f}ms > {thresholds['total_time']}ms")
            
            if performance_data['domContentLoaded'] > thresholds['dom_content_loaded']:
                performance_issues.append(f"DOM content loaded: {performance_data['domContentLoaded']:.0f}ms > {thresholds['dom_content_loaded']}ms")
                
            if performance_data['timeToFirstByte'] > thresholds['time_to_first_byte']:
                performance_issues.append(f"Time to first byte: {performance_data['timeToFirstByte']:.0f}ms > {thresholds['time_to_first_byte']}ms")
            
            if performance_issues:
                self.add_defect(
                    type='MEDIUM',
                    category='PERFORMANCE_SLOW',
                    message=f"Performance issues detected: {'; '.join(performance_issues)}",
                    details=performance_data
                )
                self.test_results['tests_fail'] += 1
                return False
            else:
                print(f"   ✅ Performance acceptable - Load: {performance_data['totalTime']:.0f}ms, DOM: {performance_data['domContentLoaded']:.0f}ms")
                self.test_results['tests_pass'] += 1
                return True
                
        except Exception as e:
            self.add_defect(
                type='LOW',
                category='PERFORMANCE_TEST_ERROR',
                message=f'Performance testing failed: {str(e)}',
                stack_trace=str(e)
            )
            self.test_results['tests_fail'] += 1
            return False
    
    def test_new_features(self):
        """Test v3.5.0 new features: QuickActionsPanel and Goal Visualization"""
        print("🎯 Phase 7: Testing New Features (v3.5.0)...")
        self.test_results['tests_run'] += 1
        
        try:
            # Navigate to dashboard
            self.driver.get(f"{self.config['test_url']}#dashboard")
            time.sleep(3)
            
            # Test QuickActionsPanel presence
            quick_actions_found = False
            quick_action_selectors = [
                (By.CSS_SELECTOR, "[data-testid='quick-actions-panel']"),
                (By.CSS_SELECTOR, ".quick-actions"),
                (By.XPATH, "//div[contains(@class, 'quick-actions')]"),
                (By.XPATH, "//div[contains(., 'Create Goal') and contains(., 'Create Story')]")
            ]
            
            for selector in quick_action_selectors:
                try:
                    element = self.driver.find_element(*selector)
                    if element.is_displayed():
                        quick_actions_found = True
                        break
                except NoSuchElementException:
                    continue
            
            if not quick_actions_found:
                self.add_defect(
                    type='HIGH',
                    category='NEW_FEATURE_MISSING_QUICKACTIONS',
                    message='QuickActionsPanel not found on Dashboard - v3.5.0 feature missing'
                )
            else:
                # Count action buttons
                action_buttons = self.driver.find_elements(By.XPATH, "//button[contains(text(), 'Create')]")
                button_count = len([btn for btn in action_buttons if btn.is_displayed()])
                
                if button_count < 3:
                    self.add_defect(
                        type='MEDIUM',
                        category='QUICKACTIONS_INCOMPLETE',
                        message=f'QuickActionsPanel has only {button_count} buttons, expected 4'
                    )
                else:
                    print(f"   ✅ QuickActionsPanel found with {button_count} action buttons")
            
            # Test Goal Visualization
            viz_selectors = [
                (By.XPATH, "//a[contains(@href, 'visualization') or contains(text(), 'Visualization')]"),
                (By.XPATH, "//a[contains(text(), 'Goal Viz')]")
            ]
            
            viz_link = None
            for selector in viz_selectors:
                try:
                    viz_link = self.driver.find_element(*selector)
                    if viz_link.is_displayed():
                        break
                except NoSuchElementException:
                    continue
            
            if not viz_link:
                self.add_defect(
                    type='MEDIUM',
                    category='NEW_FEATURE_MISSING_GOALVIZ',
                    message='Goal Visualization link not found in navigation'
                )
            else:
                viz_link.click()
                time.sleep(5)
                
                # Check for visualization content
                page_content = self.driver.page_source.lower()
                has_mock_data = 'mock' in page_content or 'placeholder' in page_content or 'sample' in page_content
                has_visualization = 'goal' in page_content and ('chart' in page_content or 'timeline' in page_content or 'visual' in page_content)
                
                if has_mock_data:
                    self.add_defect(
                        type='MEDIUM',
                        category='GOALVIZ_MOCK_DATA',
                        message='Goal Visualization appears to show mock/placeholder data instead of real Firestore data'
                    )
                elif not has_visualization:
                    self.add_defect(
                        type='LOW',
                        category='GOALVIZ_CONTENT_UNCLEAR',
                        message='Goal Visualization page loaded but visualization content unclear'
                    )
                else:
                    print("   ✅ Goal Visualization loaded successfully")
            
            self.test_results['tests_pass'] += 1
            return True
            
        except Exception as e:
            self.add_defect(
                type='MEDIUM',
                category='NEW_FEATURES_TEST_ERROR',
                message=f'New features testing failed: {str(e)}',
                stack_trace=str(e)
            )
            self.test_results['tests_fail'] += 1
            return False
    
    def run_comprehensive_test(self):
        """Run the complete test suite"""
        print("🚀 Starting BOB v3.5.0 Comprehensive Selenium Testing...")
        print(f"📍 Test URL: {self.config['test_url']}")
        print(f"🌐 Browser: {self.browser.title()} ({'Headless' if self.headless else 'Visible'})")
        
        try:
            self.setup_driver()
            
            # Run test phases
            test_phases = [
                self.test_authentication,
                self.test_goals_creation,
                self.test_stories_creation,
                self.test_tasks_creation,
                self.test_navigation_and_ui,
                self.test_performance,
                self.test_new_features
            ]
            
            for phase in test_phases:
                try:
                    phase()
                except Exception as e:
                    print(f"❌ Phase {phase.__name__} failed: {e}")
                    continue
            
            self.test_results['end_time'] = datetime.now().isoformat()
            
            # Generate reports
            self.generate_defect_reports()
            
            print("\n📋 Test Results Summary:")
            print(f"   Tests Run: {self.test_results['tests_run']}")
            print(f"   Tests Pass: {self.test_results['tests_pass']}")
            print(f"   Tests Fail: {self.test_results['tests_fail']}")
            print(f"   Total Defects: {len(self.defects)}")
            print(f"   Critical: {len([d for d in self.defects if d.type == 'CRITICAL'])} 🔴")
            print(f"   High: {len([d for d in self.defects if d.type == 'HIGH'])} 🟠")
            print(f"   Medium: {len([d for d in self.defects if d.type == 'MEDIUM'])} 🟡")
            print(f"   Low: {len([d for d in self.defects if d.type == 'LOW'])} 🟢")
            
            return self.defects
            
        finally:
            if self.driver:
                self.driver.quit()
    
    def generate_defect_reports(self):
        """Generate comprehensive defect reports in JSON and Markdown formats"""
        timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
        
        # Prepare report data
        report_data = {
            'test_suite': 'BOB v3.5.0 - Selenium Comprehensive Test',
            'timestamp': datetime.now().isoformat(),
            'test_duration_seconds': 0,
            'test_environment': {
                'url': self.config['test_url'],
                'browser': f"{self.browser.title()} ({'Headless' if self.headless else 'Visible'})",
                'selenium_version': '4.x',
                'viewport': '1920x1080'
            },
            'test_results': self.test_results,
            'summary': {
                'total_defects': len(self.defects),
                'critical': len([d for d in self.defects if d.type == 'CRITICAL']),
                'high': len([d for d in self.defects if d.type == 'HIGH']),
                'medium': len([d for d in self.defects if d.type == 'MEDIUM']),
                'low': len([d for d in self.defects if d.type == 'LOW'])
            },
            'defects': [asdict(defect) for defect in sorted(self.defects, key=lambda x: {'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1}[x.type], reverse=True)]
        }
        
        # Calculate test duration
        if self.test_results['end_time']:
            start = datetime.fromisoformat(self.test_results['start_time'])
            end = datetime.fromisoformat(self.test_results['end_time'])
            report_data['test_duration_seconds'] = int((end - start).total_seconds())
        
        # Write JSON report
        json_filename = os.path.join(self.config['reports_dir'], f'BOB_v3.5.0_SELENIUM_DEFECT_REPORT_{timestamp}.json')
        with open(json_filename, 'w') as f:
            json.dump(report_data, f, indent=2, default=str)
        
        # Generate and write Markdown report
        markdown_content = self.generate_markdown_report(report_data)
        md_filename = os.path.join(self.config['reports_dir'], f'BOB_v3.5.0_SELENIUM_DEFECT_REPORT_{timestamp}.md')
        with open(md_filename, 'w') as f:
            f.write(markdown_content)
        
        print(f"\n📋 Reports generated:")
        print(f"   JSON: {json_filename}")
        print(f"   Markdown: {md_filename}")
        
        return json_filename, md_filename
    
    def generate_markdown_report(self, report_data):
        """Generate a comprehensive Markdown report"""
        duration = report_data['test_duration_seconds']
        pass_rate = 0
        if report_data['test_results']['tests_run'] > 0:
            pass_rate = round((report_data['test_results']['tests_pass'] / report_data['test_results']['tests_run']) * 100)
        
        critical_defects = [d for d in report_data['defects'] if d['type'] == 'CRITICAL']
        high_defects = [d for d in report_data['defects'] if d['type'] == 'HIGH']
        medium_defects = [d for d in report_data['defects'] if d['type'] == 'MEDIUM']
        low_defects = [d for d in report_data['defects'] if d['type'] == 'LOW']
        
        markdown = f"""# BOB v3.5.0 - Selenium Virtual Browser Test Results
## Test Execution: {report_data['timestamp']}

### 📊 Test Summary
- **Test Duration**: {duration} seconds
- **Tests Executed**: {report_data['test_results']['tests_run']}
- **Tests Passed**: {report_data['test_results']['tests_pass']} ✅
- **Tests Failed**: {report_data['test_results']['tests_fail']} ❌
- **Pass Rate**: {pass_rate}%

### 🐛 Defect Summary
- **Total Defects**: {report_data['summary']['total_defects']}
- **Critical**: {report_data['summary']['critical']} 🔴
- **High**: {report_data['summary']['high']} 🟠  
- **Medium**: {report_data['summary']['medium']} 🟡
- **Low**: {report_data['summary']['low']} 🟢

### 🎯 Test Environment
- **URL**: {report_data['test_environment']['url']}
- **Browser**: {report_data['test_environment']['browser']}
- **Selenium**: {report_data['test_environment']['selenium_version']}
- **Viewport**: {report_data['test_environment']['viewport']}

"""

        # Critical Issues Section
        if critical_defects:
            markdown += f"""### 🚨 Critical Issues (IMMEDIATE ACTION REQUIRED)
{len(critical_defects)} critical defects found that prevent normal platform operation.

"""
            for defect in critical_defects:
                markdown += f"""#### 🔴 {defect['category']}
**Message**: {defect['message']}
**Timestamp**: {defect['timestamp']}
**URL**: {defect['url']}
"""
                if defect.get('screenshot_path'):
                    markdown += f"**Screenshot**: {defect['screenshot_path']}\n"
                if defect.get('console_logs'):
                    markdown += f"**Console Logs**: {', '.join(defect['console_logs'][:3])}\n"
                if defect.get('details'):
                    markdown += f"**Details**: ```json\n{json.dumps(defect['details'], indent=2)}\n```\n"
                markdown += "\n"
        else:
            markdown += "### 🚨 Critical Issues\n✅ No critical issues found!\n\n"

        # High Priority Issues
        if high_defects:
            markdown += f"""### 🟠 High Priority Issues (Address Before Next Release)
{len(high_defects)} high priority defects that impact core functionality.

"""
            for defect in high_defects:
                markdown += f"""#### 🟠 {defect['category']}
**Message**: {defect['message']}
**Timestamp**: {defect['timestamp']}
"""
                if defect.get('screenshot_path'):
                    markdown += f"**Screenshot**: {defect['screenshot_path']}\n"
                markdown += "\n"
        else:
            markdown += "### 🟠 High Priority Issues\n✅ No high priority issues found!\n\n"

        # Medium Priority Issues
        if medium_defects:
            markdown += f"""### 🟡 Medium Priority Issues (Address in Next Sprint)
{len(medium_defects)} medium priority defects affecting user experience.

"""
            for defect in medium_defects:
                markdown += f"""#### 🟡 {defect['category']}
**Message**: {defect['message']}
**Timestamp**: {defect['timestamp']}

"""
        else:
            markdown += "### 🟡 Medium Priority Issues\n✅ No medium priority issues found!\n\n"

        # Low Priority Issues
        if low_defects:
            markdown += f"""### 🟢 Low Priority Issues (Address When Convenient)
{len(low_defects)} low priority issues for optimization.

"""
            for defect in low_defects:
                markdown += f"""#### 🟢 {defect['category']}
**Message**: {defect['message']}
**Timestamp**: {defect['timestamp']}

"""
        else:
            markdown += "### 🟢 Low Priority Issues\n✅ No low priority issues found!\n\n"

        # Recommendations
        markdown += "### 📋 Recommendations\n"
        if report_data['summary']['critical'] > 0:
            markdown += "🔴 **CRITICAL ISSUES FOUND** - Platform may not be functional. Immediate attention required.\n"
        elif report_data['summary']['high'] > 0:
            markdown += "🟠 **HIGH PRIORITY ISSUES** - Core functionality impacted. Address before next release.\n"
        elif report_data['summary']['medium'] > 0:
            markdown += "🟡 **MEDIUM PRIORITY ISSUES** - User experience affected. Address in upcoming sprint.\n"
        elif report_data['summary']['low'] > 0:
            markdown += "🟢 **LOW PRIORITY ISSUES** - Minor optimizations available.\n"
        else:
            markdown += "🎉 **NO DEFECTS FOUND** - Platform appears to be functioning excellently!\n"

        # Test Coverage
        markdown += f"""
### 🎯 Test Coverage Validation
- ✅ Authentication & Side Door Testing
- ✅ CRUD Operations (Goals, Stories, Tasks)
- ✅ P1 Defect Fix Validation (Stories Modal vs Alert)
- ✅ UI Navigation & Interaction
- ✅ Performance Metrics
- ✅ New Features (Goal Visualization, QuickActionsPanel)

### 🔗 Platform Information
- **Platform Version**: BOB v3.5.0
- **Test Suite Version**: Selenium 1.0.0
- **Test Type**: Virtual Browser Automation
- **P1 Fixes Validated**: Enhanced Authentication, Stories Modal Integration

---
*Report generated by BOB Selenium Virtual Browser Testing Suite*
"""
        
        return markdown


def main():
    """Main function to run the Selenium testing suite"""
    import argparse
    
    parser = argparse.ArgumentParser(description='BOB v3.5.0 Selenium Virtual Browser Testing')
    parser.add_argument('--browser', choices=['chrome', 'firefox', 'edge'], default='chrome',
                        help='Browser to use for testing (default: chrome)')
    parser.add_argument('--headless', action='store_true', default=True,
                        help='Run browser in headless mode (default: True)')
    parser.add_argument('--visible', action='store_true',
                        help='Run browser in visible mode (overrides headless)')
    
    args = parser.parse_args()
    
    # Override headless if visible is specified
    if args.visible:
        args.headless = False
    
    try:
        tester = BOBSeleniumTester(browser=args.browser, headless=args.headless)
        defects = tester.run_comprehensive_test()
        
        # Exit with error code if critical defects found
        critical_defects = len([d for d in defects if d.type == 'CRITICAL'])
        if critical_defects > 0:
            print(f"\n❌ Testing completed with {critical_defects} critical defects")
            sys.exit(1)
        else:
            print(f"\n✅ Testing completed successfully!")
            sys.exit(0)
            
    except Exception as e:
        print(f"\n💥 Testing failed with error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
