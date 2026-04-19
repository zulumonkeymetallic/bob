// Debug script to verify goal-story relationship fixes
// Run this in the browser console to verify the fixes are working

console.log('🔧 BOB Debug Script - Goal-Story Relationship Verification v2.0');
console.log('📊 Checking ModernStoriesTable component fixes...');

// Check if we're on the goals page and can see the component
const checkModernStoriesTable = () => {
  console.log('\n=== ModernStoriesTable Component Analysis ===');
  
  // Look for the stories table
  const storiesTable = document.querySelector('table');
  if (storiesTable) {
    console.log('✅ Stories table found');
    
    // Check for goal columns
    const goalHeaders = document.querySelectorAll('th');
    const goalColumn = Array.from(goalHeaders).find(th => th.textContent.includes('Goal'));
    if (goalColumn) {
      console.log('✅ Goal column found in table header');
    } else {
      console.log('❌ Goal column not found in table header');
    }
    
    // Check for goal select dropdowns in edit mode
    const goalSelects = document.querySelectorAll('select option[value]');
    if (goalSelects.length > 0) {
      console.log(`✅ Found ${goalSelects.length} select options (including goal dropdowns)`);
    }
    
    // Check for goal dropdowns specifically
    const goalDropdowns = Array.from(document.querySelectorAll('select')).filter(select => {
      const options = Array.from(select.options);
      return options.some(option => option.textContent.includes('Goal') || option.textContent.includes('Select Goal'));
    });
    
    if (goalDropdowns.length > 0) {
      console.log(`✅ Found ${goalDropdowns.length} goal dropdown(s)`);
    } else {
      console.log('⚠️  No goal dropdowns found (may need to enter edit mode first)');
    }
  } else {
    console.log('❌ Stories table not found - may not be on Goals page');
  }
};

// Check for goal selection state
const checkGoalSelection = () => {
  console.log('\n=== Goal Selection State Analysis ===');
  
  // Look for goal cards or selection UI
  const goalCards = document.querySelectorAll('[data-testid*="goal"], .goal-card, .card');
  console.log(`📋 Found ${goalCards.length} potential goal elements`);
  
  // Check for selected goal indicators
  const selectedElements = document.querySelectorAll('.selected, .active, [aria-selected="true"]');
  console.log(`🎯 Found ${selectedElements.length} selected/active elements`);
  
  // Check console for debug messages
  console.log('💬 Check browser console for debug messages starting with:');
  console.log('   📊 Goal ID filter:');
  console.log('   🎯 Goal selected:');
  console.log('   📊 Goal ID prop:');
};

// Run the checks
checkModernStoriesTable();
checkGoalSelection();

console.log('\n=== Instructions ===');
console.log('1. Navigate to Goals page');
console.log('2. Select a goal to filter stories');
console.log('3. Try editing a story to see if goal shows as dropdown');
console.log('4. Try adding a new story to verify goal dropdown works');
console.log('5. Check browser console for debug messages');

console.log('\n=== Expected Fixes ===');
console.log('✅ Goal field should show as dropdown in edit mode (not text input)');
console.log('✅ Goal selection should filter stories correctly');
console.log('✅ selectedGoalId prop should be passed correctly to ModernStoriesTable');
console.log('✅ Console should show goal filtering debug messages');

// New fix verification
console.log('\n=== New Fixes Applied ===');
console.log('🔧 goalTitle column now configured as select type');
console.log('🔧 Goal editing now properly updates goalId field');
console.log('🔧 Goal dropdown shows available goals from goals prop');
console.log('🔧 Edit value correctly set to goalId when editing goalTitle');
console.log('🔧 Save operation updates goalId field (not goalTitle)');
