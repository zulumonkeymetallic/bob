// 🧪 BOB v3.5.2 - FAB Reference Number Validation Script
// Run this in the browser console at https://bob20250810.web.app

console.log('🚀 Starting BOB v3.5.2 Reference Number Validation');

// Test 1: Validate FAB Goal Creation with Reference Numbers
const testFABGoalWithReference = async () => {
  console.log('\n🧪 TEST 1: FAB Goal Creation with Reference Numbers');
  
  try {
    // Step 1: Find and click FAB
    const fabButton = document.querySelector('.floating-action-button, [class*="fab"], [data-testid*="fab"]');
    if (!fabButton) {
      console.error('❌ FAB button not found. Looking for alternative selectors...');
      
      // Try alternative selectors
      const altFab = document.querySelector('button[style*="position: fixed"], button[style*="z-index"]');
      if (altFab) {
        console.log('✅ Found FAB with alternative selector');
        altFab.click();
      } else {
        console.error('❌ No FAB found. Please click the floating action button manually.');
        return;
      }
    } else {
      console.log('✅ FAB found, clicking...');
      fabButton.click();
    }
    
    // Wait for menu to appear
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 2: Click Goal option
    const goalOption = document.querySelector('[data-testid="goal-option"], .goal-option, [class*="goal"]');
    if (!goalOption) {
      console.error('❌ Goal option not found in FAB menu');
      return;
    }
    
    console.log('✅ Goal option found, clicking...');
    goalOption.click();
    
    // Wait for form to appear
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 3: Fill form with test data
    const titleInput = document.querySelector('input[name="title"], input[placeholder*="title"]');
    const descInput = document.querySelector('textarea[name="description"], textarea[placeholder*="description"]');
    const themeSelect = document.querySelector('select[name="theme"]');
    
    if (titleInput) {
      titleInput.value = 'TEST GOAL - Reference Validation ' + new Date().getTime();
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('✅ Title filled');
    }
    
    if (descInput) {
      descInput.value = 'Testing FAB goal creation with reference number generation';
      descInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('✅ Description filled');
    }
    
    if (themeSelect) {
      themeSelect.value = 'Health';
      themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      console.log('✅ Theme selected');
    }
    
    // Step 4: Submit form
    const submitButton = document.querySelector('button[type="submit"], .btn-primary');
    if (submitButton) {
      console.log('✅ Submitting goal creation form...');
      submitButton.click();
      
      // Wait for creation to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('✅ Goal creation submitted! Check the Goals table for the new goal with reference number (GR-XXXXXX)');
      console.log('📋 Navigate to Goals page to verify the reference number appears in the table');
      
    } else {
      console.error('❌ Submit button not found');
    }
    
  } catch (error) {
    console.error('❌ Error during FAB goal test:', error);
  }
};

// Test 2: Check Console Logs for Reference Generation
const monitorConsoleForReferences = () => {
  console.log('\n🧪 TEST 2: Monitoring Console for Reference Generation');
  
  const originalLog = console.log;
  console.log = function(...args) {
    // Check for reference generation logs
    const message = args.join(' ');
    if (message.includes('ref:') || message.includes('GR-') || message.includes('ST-') || message.includes('TK-')) {
      console.warn('🎯 REFERENCE DETECTED:', ...args);
    }
    originalLog.apply(console, args);
  };
  
  console.log('✅ Console monitoring active. Create goals/stories/tasks via FAB to see reference generation logs.');
};

// Test 3: Manual Verification Guide
const showManualVerificationSteps = () => {
  console.log('\n📋 MANUAL VERIFICATION STEPS:');
  console.log('1. Navigate to Goals page');
  console.log('2. Look for "Reference" column in the table');
  console.log('3. Verify FAB-created goals show GR-XXXXXX format');
  console.log('4. Create a story via FAB and check Stories table for ST-XXXXXX');
  console.log('5. Create a task via FAB and check Tasks table for TK-XXXXXX');
  console.log('\n✅ Expected Results:');
  console.log('- All FAB-created entities have reference numbers');
  console.log('- Reference format: GR-26LGIP (prefix + timestamp + random)');
  console.log('- References are visible in table views');
  console.log('- Console shows reference generation logs');
};

// Test 4: Quick Database Query (if Firebase console access)
const showDatabaseQuery = () => {
  console.log('\n🔍 DATABASE VERIFICATION (Firebase Console):');
  console.log('Query: goals where ownerUid == "your-uid" order by createdAt desc limit 5');
  console.log('Check: Latest goals should have "ref" field with GR-XXXXXX format');
  console.log('Console URL: https://console.firebase.google.com/project/bob20250810/firestore');
};

// Run all tests
const runAllTests = async () => {
  console.log('🧪 BOB v3.5.2 FAB Reference Number Validation Suite');
  console.log('='.repeat(60));
  
  // Start console monitoring
  monitorConsoleForReferences();
  
  // Show manual steps
  showManualVerificationSteps();
  
  // Show database query info
  showDatabaseQuery();
  
  // Ask user if they want to run automated test
  console.log('\n🤖 AUTOMATED TEST:');
  console.log('Run testFABGoalWithReference() to automatically test FAB goal creation');
  console.log('Or manually create entities via FAB and observe the console logs');
  
  console.log('\n✅ Validation suite loaded. Ready for testing!');
};

// Export functions for manual use
window.testFABGoalWithReference = testFABGoalWithReference;
window.runAllTests = runAllTests;

// Auto-run the setup
runAllTests();
