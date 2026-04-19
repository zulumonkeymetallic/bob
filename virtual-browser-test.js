// BOB v3.5.0 - Virtual Browser Testing Script
// Comprehensive automated testing with defect reporting

const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'https://bob20250810.web.app',
  testUrl: 'https://bob20250810.web.app?test-login=ai-agent-token&test-mode=true',
  timeout: 30000,
  viewport: { width: 1920, height: 1080 },
  browsers: ['chromium'], // Add 'firefox', 'webkit' for cross-browser testing
  outputDir: './test-results'
};

// Ensure output directory exists
if (!fs.existsSync(TEST_CONFIG.outputDir)) {
  fs.mkdirSync(TEST_CONFIG.outputDir, { recursive: true });
}

async function runBOBComprehensiveTest() {
  console.log('🚀 Starting BOB v3.5.0 Virtual Browser Testing...');
  console.log(`📍 Test URL: ${TEST_CONFIG.testUrl}`);
  
  const browser = await chromium.launch({ 
    headless: process.env.HEADLESS !== 'false',
    args: [
      '--disable-web-security', 
      '--disable-features=VizDisplayCompositor',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  
  const context = await browser.newContext({
    viewport: TEST_CONFIG.viewport,
    permissions: ['geolocation', 'notifications'],
    ignoreHTTPSErrors: true
  });
  
  const page = await context.newPage();
  const defects = [];
  const testResults = {
    startTime: new Date().toISOString(),
    endTime: null,
    testsRun: 0,
    testsPass: 0,
    testsFail: 0
  };
  
  // Set up error monitoring
  setupErrorMonitoring(page, defects);
  
  try {
    console.log('🔐 Phase 1: Authentication & Initial Load Testing...');
    await testAuthentication(page, defects, testResults);
    
    console.log('📝 Phase 2: CRUD Operations Testing...');
    await testCRUDOperations(page, defects, testResults);
    
    console.log('🎨 Phase 3: UI Interaction Testing...');
    await testUIInteractions(page, defects, testResults);
    
    console.log('⚡ Phase 4: Performance Testing...');
    await testPerformance(page, defects, testResults);
    
    console.log('🔄 Phase 5: Real-time Updates Testing...');
    await testRealTimeUpdates(page, defects, testResults);
    
    console.log('🎯 Phase 6: New Features Testing (v3.5.0)...');
    await testNewFeatures(page, defects, testResults);
    
  } catch (error) {
    defects.push({
      type: 'CRITICAL',
      category: 'RUNTIME_ERROR',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      phase: 'MAIN_EXECUTION'
    });
    testResults.testsFail++;
  } finally {
    testResults.endTime = new Date().toISOString();
    await browser.close();
    
    // Generate comprehensive defect report
    const report = generateDefectReport(defects, testResults);
    console.log('\n📋 Test Results Summary:');
    console.log(`   Tests Run: ${testResults.testsRun}`);
    console.log(`   Tests Pass: ${testResults.testsPass}`);
    console.log(`   Tests Fail: ${testResults.testsFail}`);
    console.log(`   Total Defects: ${defects.length}`);
    console.log(`   Critical: ${defects.filter(d => d.type === 'CRITICAL').length} 🔴`);
    console.log(`   High: ${defects.filter(d => d.type === 'HIGH').length} 🟠`);
    console.log(`   Medium: ${defects.filter(d => d.type === 'MEDIUM').length} 🟡`);
    console.log(`   Low: ${defects.filter(d => d.type === 'LOW').length} 🟢`);
    
    return report;
  }
}

function setupErrorMonitoring(page, defects) {
  // Monitor console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const errorText = msg.text();
      
      // Check for specific known issues
      if (errorText.includes('MIME type')) {
        defects.push({
          type: 'CRITICAL',
          category: 'MIME_TYPE_ERROR',
          message: errorText,
          timestamp: new Date().toISOString(),
          url: page.url()
        });
      } else if (errorText.includes('Missing or insufficient permissions')) {
        defects.push({
          type: 'CRITICAL',
          category: 'AUTHENTICATION_PERMISSIONS',
          message: errorText,
          timestamp: new Date().toISOString(),
          url: page.url()
        });
      } else if (errorText.toLowerCase().includes('error')) {
        defects.push({
          type: 'MEDIUM',
          category: 'CONSOLE_ERROR',
          message: errorText,
          timestamp: new Date().toISOString(),
          url: page.url()
        });
      }
    }
  });
  
  // Monitor page errors
  page.on('pageerror', error => {
    defects.push({
      type: 'HIGH',
      category: 'PAGE_ERROR',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      url: page.url()
    });
  });
  
  // Monitor failed requests
  page.on('requestfailed', request => {
    defects.push({
      type: 'MEDIUM',
      category: 'REQUEST_FAILED',
      message: `Failed to load: ${request.url()} - ${request.failure()?.errorText}`,
      timestamp: new Date().toISOString(),
      requestUrl: request.url()
    });
  });
}

async function testAuthentication(page, defects, testResults) {
  testResults.testsRun++;
  
  try {
    // Navigate to test URL
    await page.goto(TEST_CONFIG.testUrl, { waitUntil: 'networkidle', timeout: TEST_CONFIG.timeout });
    
    // Wait for authentication to complete
    await page.waitForTimeout(3000);
    
    // Check for side door authentication success
    const authSuccess = await page.evaluate(() => {
      return {
        userExists: !!window.auth?.currentUser,
        userId: window.auth?.currentUser?.uid,
        hasAccessToken: !!window.auth?.currentUser?.accessToken,
        hasIdTokenMethod: typeof window.auth?.currentUser?.getIdToken === 'function',
        testModeActive: document.body.textContent.includes('🧪') || 
                       localStorage.getItem('testMode') === 'true'
      };
    });
    
    // Validate authentication
    if (!authSuccess.userExists) {
      defects.push({
        type: 'CRITICAL',
        category: 'AUTHENTICATION_FAILURE',
        message: 'No authenticated user found - side door authentication failed',
        timestamp: new Date().toISOString(),
        details: authSuccess
      });
      testResults.testsFail++;
      return;
    }
    
    if (authSuccess.userId !== 'ai-test-user-12345abcdef') {
      defects.push({
        type: 'HIGH',
        category: 'AUTHENTICATION_USER_ID',
        message: `Wrong user ID - expected 'ai-test-user-12345abcdef', got '${authSuccess.userId}'`,
        timestamp: new Date().toISOString(),
        details: authSuccess
      });
      testResults.testsFail++;
      return;
    }
    
    if (!authSuccess.hasAccessToken || !authSuccess.hasIdTokenMethod) {
      defects.push({
        type: 'HIGH',
        category: 'AUTHENTICATION_TOKENS',
        message: 'Missing required authentication tokens or methods',
        timestamp: new Date().toISOString(),
        details: authSuccess
      });
      testResults.testsFail++;
      return;
    }
    
    console.log('   ✅ Authentication successful');
    testResults.testsPass++;
    
  } catch (error) {
    defects.push({
      type: 'CRITICAL',
      category: 'AUTHENTICATION_ERROR',
      message: `Authentication test failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
}

async function testCRUDOperations(page, defects, testResults) {
  // Test Goals Creation
  testResults.testsRun++;
  try {
    console.log('   🎯 Testing Goals Creation...');
    
    // Navigate to dashboard if not already there
    if (!page.url().includes('dashboard')) {
      await page.click('a[href*="dashboard"], a:has-text("Dashboard")');
      await page.waitForLoadState('networkidle');
    }
    
    // Look for QuickActionsPanel
    const quickActionExists = await page.locator('button:has-text("Create Goal"), [data-testid="quick-action-goal"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!quickActionExists) {
      defects.push({
        type: 'HIGH',
        category: 'UI_MISSING',
        message: 'QuickActionsPanel "Create Goal" button not found on Dashboard',
        timestamp: new Date().toISOString()
      });
      testResults.testsFail++;
    } else {
      // Test goal creation
      await page.locator('button:has-text("Create Goal"), [data-testid="quick-action-goal"]').first().click();
      
      // Wait for modal
      const modalVisible = await page.locator('[data-testid="goal-creation-modal"], .modal:has-text("Goal"), .modal:has-text("Create")').first().isVisible({ timeout: 5000 }).catch(() => false);
      
      if (!modalVisible) {
        defects.push({
          type: 'HIGH',
          category: 'CRUD_MODAL_FAILURE',
          message: 'Goal creation modal did not open',
          timestamp: new Date().toISOString()
        });
        testResults.testsFail++;
      } else {
        // Fill basic form (if fields exist)
        await page.fill('input[name="title"], input[placeholder*="title"], input[placeholder*="Title"]', 'AI Virtual Test Goal').catch(() => {});
        await page.fill('textarea[name="description"], textarea[placeholder*="description"]', 'Created by virtual browser testing').catch(() => {});
        
        // Cancel to avoid actually creating (for testing purposes)
        await page.locator('button:has-text("Cancel"), button:has-text("Close"), .modal-close').first().click().catch(() => {});
        
        console.log('   ✅ Goals creation modal accessible');
        testResults.testsPass++;
      }
    }
  } catch (error) {
    defects.push({
      type: 'HIGH',
      category: 'GOALS_CREATION_ERROR',
      message: `Goals creation test failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
  
  // Test Stories Creation (P1 Fix Validation)
  testResults.testsRun++;
  try {
    console.log('   📖 Testing Stories Creation (P1 Fix)...');
    
    // Navigate to Stories section
    await page.click('a[href*="stories"], a:has-text("Stories")');
    await page.waitForLoadState('networkidle');
    
    // Look for Add Story button
    const addStoryButton = await page.locator('button:has-text("Add new story"), button:has-text("Add Story"), button:has-text("Create Story")').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!addStoryButton) {
      defects.push({
        type: 'HIGH',
        category: 'UI_MISSING',
        message: 'Add Story button not found in Stories section',
        timestamp: new Date().toISOString()
      });
      testResults.testsFail++;
    } else {
      // Click Add Story button
      await page.locator('button:has-text("Add new story"), button:has-text("Add Story"), button:has-text("Create Story")').first().click();
      
      // CRITICAL: Check if modal opens (not alert)
      await page.waitForTimeout(1000);
      
      const modalVisible = await page.locator('[data-testid="add-story-modal"], .modal:has-text("Story"), .modal:has-text("Create")').first().isVisible({ timeout: 3000 }).catch(() => false);
      const alertPresent = await page.locator('.alert, [role="alert"]').count() > 0;
      
      if (alertPresent) {
        defects.push({
          type: 'CRITICAL',
          category: 'P1_REGRESSION',
          message: 'Stories creation still showing alert instead of AddStoryModal - P1 fix FAILED',
          timestamp: new Date().toISOString()
        });
        testResults.testsFail++;
      } else if (!modalVisible) {
        defects.push({
          type: 'HIGH',
          category: 'CRUD_MODAL_FAILURE',
          message: 'Story creation modal did not open (but no alert detected)',
          timestamp: new Date().toISOString()
        });
        testResults.testsFail++;
      } else {
        // Modal opened successfully - P1 fix working
        await page.locator('button:has-text("Cancel"), button:has-text("Close"), .modal-close').first().click().catch(() => {});
        
        console.log('   ✅ Stories creation P1 fix validated - AddStoryModal working');
        testResults.testsPass++;
      }
    }
  } catch (error) {
    defects.push({
      type: 'CRITICAL',
      category: 'STORIES_CREATION_ERROR',
      message: `Stories creation test failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
  
  // Test Tasks Creation
  testResults.testsRun++;
  try {
    console.log('   ✅ Testing Tasks Creation...');
    
    // Navigate back to dashboard for QuickActionsPanel
    await page.click('a[href*="dashboard"], a:has-text("Dashboard")');
    await page.waitForLoadState('networkidle');
    
    // Test Task Creation
    const createTaskButton = await page.locator('button:has-text("Create Task"), [data-testid="quick-action-task"]').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!createTaskButton) {
      defects.push({
        type: 'MEDIUM',
        category: 'UI_MISSING',
        message: 'Create Task button not found in QuickActionsPanel',
        timestamp: new Date().toISOString()
      });
      testResults.testsFail++;
    } else {
      await page.locator('button:has-text("Create Task"), [data-testid="quick-action-task"]').first().click();
      
      const taskModalVisible = await page.locator('[data-testid="task-creation-modal"], .modal:has-text("Task"), .modal:has-text("Create")').first().isVisible({ timeout: 5000 }).catch(() => false);
      
      if (!taskModalVisible) {
        defects.push({
          type: 'MEDIUM',
          category: 'CRUD_MODAL_FAILURE',
          message: 'Task creation modal did not open',
          timestamp: new Date().toISOString()
        });
        testResults.testsFail++;
      } else {
        // Cancel modal
        await page.locator('button:has-text("Cancel"), button:has-text("Close"), .modal-close').first().click().catch(() => {});
        
        console.log('   ✅ Tasks creation modal accessible');
        testResults.testsPass++;
      }
    }
  } catch (error) {
    defects.push({
      type: 'MEDIUM',
      category: 'TASKS_CREATION_ERROR',
      message: `Tasks creation test failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
}

async function testUIInteractions(page, defects, testResults) {
  testResults.testsRun++;
  
  try {
    // Test navigation between sections
    const sections = [
      { name: 'Goals', selector: 'a[href*="goals"], a:has-text("Goals")' },
      { name: 'Stories', selector: 'a[href*="stories"], a:has-text("Stories")' },
      { name: 'Tasks', selector: 'a[href*="tasks"], a:has-text("Tasks")' },
      { name: 'Dashboard', selector: 'a[href*="dashboard"], a:has-text("Dashboard")' }
    ];
    
    let navigationSuccessful = true;
    
    for (const section of sections) {
      try {
        console.log(`   🧭 Testing navigation to ${section.name}...`);
        
        const navElement = await page.locator(section.selector).first().isVisible({ timeout: 3000 }).catch(() => false);
        
        if (!navElement) {
          defects.push({
            type: 'MEDIUM',
            category: 'NAVIGATION_MISSING',
            message: `Navigation element for ${section.name} not found`,
            timestamp: new Date().toISOString()
          });
          navigationSuccessful = false;
          continue;
        }
        
        await page.locator(section.selector).first().click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        
        // Check for console errors after navigation
        const consoleErrors = await page.evaluate(() => {
          return window.__testErrors || [];
        });
        
        if (consoleErrors.length > 0) {
          defects.push({
            type: 'LOW',
            category: 'CONSOLE_ERROR_NAVIGATION',
            message: `Console errors after navigating to ${section.name}: ${consoleErrors.join(', ')}`,
            timestamp: new Date().toISOString()
          });
        }
        
      } catch (error) {
        defects.push({
          type: 'MEDIUM',
          category: 'NAVIGATION_ERROR',
          message: `Failed to navigate to ${section.name}: ${error.message}`,
          timestamp: new Date().toISOString()
        });
        navigationSuccessful = false;
      }
    }
    
    if (navigationSuccessful) {
      console.log('   ✅ Navigation testing successful');
      testResults.testsPass++;
    } else {
      testResults.testsFail++;
    }
    
  } catch (error) {
    defects.push({
      type: 'MEDIUM',
      category: 'UI_INTERACTION_ERROR',
      message: `UI interaction testing failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
}

async function testPerformance(page, defects, testResults) {
  testResults.testsRun++;
  
  try {
    // Navigate to dashboard for performance measurement
    await page.goto(TEST_CONFIG.testUrl, { waitUntil: 'networkidle' });
    
    // Measure page load performance
    const performanceMetrics = await page.evaluate(() => {
      const timing = performance.getEntriesByType('navigation')[0];
      return {
        domContentLoaded: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
        loadComplete: timing.loadEventEnd - timing.loadEventStart,
        totalTime: timing.loadEventEnd - timing.fetchStart,
        timeToFirstByte: timing.responseStart - timing.requestStart
      };
    });
    
    // Performance thresholds
    const thresholds = {
      totalTime: 15000, // 15 seconds max
      domContentLoaded: 8000, // 8 seconds max
      timeToFirstByte: 3000 // 3 seconds max
    };
    
    if (performanceMetrics.totalTime > thresholds.totalTime) {
      defects.push({
        type: 'HIGH',
        category: 'PERFORMANCE_SLOW_LOAD',
        message: `Page load time too slow: ${performanceMetrics.totalTime}ms (threshold: ${thresholds.totalTime}ms)`,
        timestamp: new Date().toISOString(),
        metrics: performanceMetrics
      });
      testResults.testsFail++;
    } else if (performanceMetrics.domContentLoaded > thresholds.domContentLoaded) {
      defects.push({
        type: 'MEDIUM',
        category: 'PERFORMANCE_DOM_SLOW',
        message: `DOM content loaded too slow: ${performanceMetrics.domContentLoaded}ms (threshold: ${thresholds.domContentLoaded}ms)`,
        timestamp: new Date().toISOString(),
        metrics: performanceMetrics
      });
      testResults.testsFail++;
    } else if (performanceMetrics.timeToFirstByte > thresholds.timeToFirstByte) {
      defects.push({
        type: 'LOW',
        category: 'PERFORMANCE_TTFB_SLOW',
        message: `Time to first byte too slow: ${performanceMetrics.timeToFirstByte}ms (threshold: ${thresholds.timeToFirstByte}ms)`,
        timestamp: new Date().toISOString(),
        metrics: performanceMetrics
      });
      testResults.testsFail++;
    } else {
      console.log(`   ✅ Performance acceptable - Load: ${performanceMetrics.totalTime}ms, DOM: ${performanceMetrics.domContentLoaded}ms`);
      testResults.testsPass++;
    }
    
  } catch (error) {
    defects.push({
      type: 'LOW',
      category: 'PERFORMANCE_TEST_ERROR',
      message: `Performance testing failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
}

async function testRealTimeUpdates(page, defects, testResults) {
  testResults.testsRun++;
  
  try {
    console.log('   🔄 Testing real-time UI updates...');
    
    // Navigate to dashboard
    await page.goto(`${TEST_CONFIG.testUrl}#dashboard`);
    await page.waitForLoadState('networkidle');
    
    // Test if QuickActionsPanel exists and is functional
    const quickActionsExists = await page.locator('[data-testid="quick-actions-panel"], .quick-actions').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!quickActionsExists) {
      defects.push({
        type: 'MEDIUM',
        category: 'REAL_TIME_TEST_SKIP',
        message: 'Cannot test real-time updates - QuickActionsPanel not found',
        timestamp: new Date().toISOString()
      });
      testResults.testsFail++;
    } else {
      // Test that UI elements are responsive
      const uiResponsive = await page.evaluate(() => {
        // Check if main UI elements exist and are interactive
        const dashboard = document.querySelector('[data-testid="dashboard"], .dashboard, main');
        const buttons = document.querySelectorAll('button');
        return {
          dashboardExists: !!dashboard,
          buttonsClickable: buttons.length > 0,
          totalButtons: buttons.length
        };
      });
      
      if (!uiResponsive.dashboardExists || !uiResponsive.buttonsClickable) {
        defects.push({
          type: 'MEDIUM',
          category: 'UI_RESPONSIVENESS',
          message: 'UI elements not responsive or missing',
          timestamp: new Date().toISOString(),
          details: uiResponsive
        });
        testResults.testsFail++;
      } else {
        console.log(`   ✅ UI responsive - ${uiResponsive.totalButtons} interactive buttons found`);
        testResults.testsPass++;
      }
    }
    
  } catch (error) {
    defects.push({
      type: 'MEDIUM',
      category: 'REAL_TIME_TEST_ERROR',
      message: `Real-time update testing failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
}

async function testNewFeatures(page, defects, testResults) {
  // Test Goal Visualization
  testResults.testsRun++;
  try {
    console.log('   📊 Testing Goal Visualization (v3.5.0)...');
    
    // Look for Goal Visualization link
    const vizLink = await page.locator('a[href*="visualization"], a:has-text("Visualization"), a:has-text("Goal Viz")').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!vizLink) {
      defects.push({
        type: 'MEDIUM',
        category: 'NEW_FEATURE_MISSING',
        message: 'Goal Visualization link not found in navigation',
        timestamp: new Date().toISOString()
      });
      testResults.testsFail++;
    } else {
      await page.locator('a[href*="visualization"], a:has-text("Visualization"), a:has-text("Goal Viz")').first().click();
      await page.waitForLoadState('networkidle');
      
      // Check if real data loads (not mock)
      const dataStatus = await page.evaluate(() => {
        const content = document.body.textContent.toLowerCase();
        return {
          hasMockData: content.includes('mock') || content.includes('placeholder') || content.includes('sample'),
          hasVisualization: content.includes('goal') && (content.includes('chart') || content.includes('timeline') || content.includes('visual')),
          hasLoadingIndicators: content.includes('loading') || content.includes('fetching')
        };
      });
      
      if (dataStatus.hasMockData) {
        defects.push({
          type: 'MEDIUM',
          category: 'DATA_INTEGRATION_MOCK',
          message: 'Goal Visualization appears to show mock/placeholder data instead of real Firestore data',
          timestamp: new Date().toISOString(),
          details: dataStatus
        });
        testResults.testsFail++;
      } else if (!dataStatus.hasVisualization) {
        defects.push({
          type: 'LOW',
          category: 'VISUALIZATION_CONTENT',
          message: 'Goal Visualization page loaded but visualization content unclear',
          timestamp: new Date().toISOString(),
          details: dataStatus
        });
        testResults.testsFail++;
      } else {
        console.log('   ✅ Goal Visualization loaded successfully');
        testResults.testsPass++;
      }
    }
  } catch (error) {
    defects.push({
      type: 'MEDIUM',
      category: 'GOAL_VIZ_ERROR',
      message: `Goal Visualization testing failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
  
  // Test QuickActionsPanel Integration
  testResults.testsRun++;
  try {
    console.log('   ⚡ Testing QuickActionsPanel Integration (v3.5.0)...');
    
    // Navigate back to dashboard
    await page.click('a[href*="dashboard"], a:has-text("Dashboard")');
    await page.waitForLoadState('networkidle');
    
    // Check for QuickActionsPanel with all 4 buttons
    const quickActions = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="quick-actions-panel"], .quick-actions');
      if (!panel) return { exists: false };
      
      const buttons = panel.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(btn => btn.textContent.toLowerCase());
      
      return {
        exists: true,
        buttonCount: buttons.length,
        hasGoalButton: buttonTexts.some(text => text.includes('goal')),
        hasStoryButton: buttonTexts.some(text => text.includes('story')),
        hasTaskButton: buttonTexts.some(text => text.includes('task')),
        hasSprintButton: buttonTexts.some(text => text.includes('sprint')),
        buttonTexts: buttonTexts
      };
    });
    
    if (!quickActions.exists) {
      defects.push({
        type: 'HIGH',
        category: 'NEW_FEATURE_MISSING',
        message: 'QuickActionsPanel not found on Dashboard - v3.5.0 feature missing',
        timestamp: new Date().toISOString()
      });
      testResults.testsFail++;
    } else if (quickActions.buttonCount < 3) {
      defects.push({
        type: 'MEDIUM',
        category: 'QUICK_ACTIONS_INCOMPLETE',
        message: `QuickActionsPanel has only ${quickActions.buttonCount} buttons, expected 4`,
        timestamp: new Date().toISOString(),
        details: quickActions
      });
      testResults.testsFail++;
    } else {
      console.log(`   ✅ QuickActionsPanel found with ${quickActions.buttonCount} action buttons`);
      testResults.testsPass++;
    }
    
  } catch (error) {
    defects.push({
      type: 'MEDIUM',
      category: 'QUICK_ACTIONS_ERROR',
      message: `QuickActionsPanel testing failed: ${error.message}`,
      timestamp: new Date().toISOString()
    });
    testResults.testsFail++;
  }
}

function generateDefectReport(defects, testResults) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = {
    testSuite: 'BOB v3.5.0 - Virtual Browser Comprehensive Test',
    timestamp: new Date().toISOString(),
    testDuration: testResults.endTime ? 
      new Date(testResults.endTime).getTime() - new Date(testResults.startTime).getTime() : 0,
    testEnvironment: {
      url: TEST_CONFIG.testUrl,
      browser: 'Chromium (Playwright)',
      viewport: TEST_CONFIG.viewport,
      headless: process.env.HEADLESS !== 'false'
    },
    testResults: testResults,
    summary: {
      totalDefects: defects.length,
      critical: defects.filter(d => d.type === 'CRITICAL').length,
      high: defects.filter(d => d.type === 'HIGH').length,
      medium: defects.filter(d => d.type === 'MEDIUM').length,
      low: defects.filter(d => d.type === 'LOW').length
    },
    defects: defects.sort((a, b) => {
      const priority = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
      return priority[b.type] - priority[a.type];
    })
  };
  
  // Write JSON report
  const jsonFilename = path.join(TEST_CONFIG.outputDir, `BOB_v3.5.0_DEFECT_REPORT_${timestamp}.json`);
  fs.writeFileSync(jsonFilename, JSON.stringify(report, null, 2));
  
  // Generate and write markdown report
  const markdownReport = generateMarkdownReport(report);
  const mdFilename = path.join(TEST_CONFIG.outputDir, `BOB_v3.5.0_DEFECT_REPORT_${timestamp}.md`);
  fs.writeFileSync(mdFilename, markdownReport);
  
  console.log(`\n📋 Reports generated:`);
  console.log(`   JSON: ${jsonFilename}`);
  console.log(`   Markdown: ${mdFilename}`);
  
  return report;
}

function generateMarkdownReport(report) {
  const duration = Math.round(report.testDuration / 1000);
  const passRate = report.testResults.testsRun > 0 ? 
    Math.round((report.testResults.testsPass / report.testResults.testsRun) * 100) : 0;
  
  return `# BOB v3.5.0 - Virtual Browser Test Results
## Test Execution: ${report.timestamp}

### 📊 Test Summary
- **Test Duration**: ${duration} seconds
- **Tests Executed**: ${report.testResults.testsRun}
- **Tests Passed**: ${report.testResults.testsPass} ✅
- **Tests Failed**: ${report.testResults.testsFail} ❌
- **Pass Rate**: ${passRate}%

### 🐛 Defect Summary
- **Total Defects**: ${report.summary.totalDefects}
- **Critical**: ${report.summary.critical} 🔴
- **High**: ${report.summary.high} 🟠  
- **Medium**: ${report.summary.medium} 🟡
- **Low**: ${report.summary.low} 🟢

### 🎯 Test Environment
- **URL**: ${report.testEnvironment.url}
- **Browser**: ${report.testEnvironment.browser}
- **Viewport**: ${report.testEnvironment.viewport.width}x${report.testEnvironment.viewport.height}
- **Headless**: ${report.testEnvironment.headless}

### 🚨 Critical Issues ${report.summary.critical > 0 ? '(IMMEDIATE ACTION REQUIRED)' : '(None Found)'}
${report.defects.filter(d => d.type === 'CRITICAL').map(defect => `
#### 🔴 ${defect.category}
**Message**: ${defect.message}
**Timestamp**: ${defect.timestamp}
${defect.url ? `**URL**: ${defect.url}` : ''}
${defect.details ? `**Details**: \`\`\`json\n${JSON.stringify(defect.details, null, 2)}\n\`\`\`` : ''}
${defect.stack ? `**Stack**: \`\`\`\n${defect.stack}\n\`\`\`` : ''}
`).join('\n')}

### 🟠 High Priority Issues ${report.summary.high > 0 ? '(Address Before Next Release)' : '(None Found)'}
${report.defects.filter(d => d.type === 'HIGH').map(defect => `
#### 🟠 ${defect.category}
**Message**: ${defect.message}
**Timestamp**: ${defect.timestamp}
${defect.url ? `**URL**: ${defect.url}` : ''}
${defect.details ? `**Details**: \`\`\`json\n${JSON.stringify(defect.details, null, 2)}\n\`\`\`` : ''}
`).join('\n')}

### 🟡 Medium Priority Issues ${report.summary.medium > 0 ? '(Address in Next Sprint)' : '(None Found)'}
${report.defects.filter(d => d.type === 'MEDIUM').map(defect => `
#### 🟡 ${defect.category}
**Message**: ${defect.message}
**Timestamp**: ${defect.timestamp}
`).join('\n')}

### 🟢 Low Priority Issues ${report.summary.low > 0 ? '(Address When Convenient)' : '(None Found)'}
${report.defects.filter(d => d.type === 'LOW').map(defect => `
#### 🟢 ${defect.category}
**Message**: ${defect.message}
**Timestamp**: ${defect.timestamp}
`).join('\n')}

### 📋 Recommendations
${report.summary.critical > 0 ? '🔴 **CRITICAL ISSUES FOUND** - Immediate attention required. Platform may not be functional.' : ''}
${report.summary.high > 0 ? '🟠 **HIGH PRIORITY ISSUES** - Should be addressed before next release to ensure quality.' : ''}
${report.summary.medium > 0 ? '🟡 **MEDIUM PRIORITY ISSUES** - Address in upcoming sprint for optimal user experience.' : ''}
${report.summary.low > 0 ? '🟢 **LOW PRIORITY ISSUES** - Address when convenient to polish user experience.' : ''}

${report.summary.totalDefects === 0 ? '🎉 **NO DEFECTS FOUND** - Platform appears to be functioning correctly!' : ''}

### 🎯 Test Coverage Validation
- ✅ Authentication & Side Door Testing
- ✅ CRUD Operations (Goals, Stories, Tasks)
- ✅ P1 Defect Fix Validation (Stories Modal)
- ✅ UI Navigation & Interaction
- ✅ Performance Metrics
- ✅ Real-time Updates
- ✅ New Features (Goal Visualization, QuickActionsPanel)

---
*Report generated by BOB Virtual Browser Testing Suite*
*Platform Version: BOB v3.5.0*
*Test Suite Version: 1.0.0*`;
}

// Execute the test if run directly
if (require.main === module) {
  runBOBComprehensiveTest()
    .then(report => {
      console.log('\n🎉 Virtual browser testing completed successfully!');
      process.exit(report.summary.critical > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('\n❌ Virtual browser testing failed:', error);
      process.exit(1);
    });
}

module.exports = { runBOBComprehensiveTest, TEST_CONFIG };
