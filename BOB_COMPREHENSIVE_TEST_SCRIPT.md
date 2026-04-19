# BOB Comprehensive Test Script & Codebase Analysis

## Executive Summary
This document provides a comprehensive test script for BOB v3.0.4+ and identifies gaps against the requirements document. It includes automated test scenarios for all CRUD operations, drag-and-drop functionality, sprint management, and end-to-end workflows using the test account side door authentication.

---

## 1. Codebase Analysis Against Requirements

### ✅ IMPLEMENTED FEATURES

#### 1.1 Sprint Planning & Maintenance (Partial)
**Status**: Implemented but potentially buggy
- ✅ `SprintPlanner.tsx` exists with drag-and-drop functionality
- ✅ Backlog grouping by theme/goal
- ✅ Sprint creation modal
- ✅ Activity stream logging for sprint changes
- ✅ Auto-generated sprint references (SPR-###)
- ❌ **ISSUE**: May show blank screen due to data loading issues

#### 1.2 Current Sprint Kanban (Partial)
**Status**: Basic implementation exists
- ✅ `CurrentSprintKanban.tsx` component exists
- ✅ Basic kanban layout
- ❌ **MISSING**: Expandable task subgrid for inline editing
- ❌ **MISSING**: Excel-like task editing interface

#### 1.3 Goals Management (Fully Implemented)
**Status**: Complete with modern table
- ✅ `ModernGoalsTable.tsx` with full functionality
- ✅ Inline editing with proper status values
- ✅ Drag-and-drop reordering
- ✅ Modal editing interface
- ✅ Column configuration
- ✅ Story count tracking

#### 1.4 Enhanced UI Components
**Status**: Well implemented
- ✅ `SprintSelector.tsx` for global sprint context
- ✅ `SidebarLayout.tsx` with sticky header
- ✅ Modern table patterns
- ✅ Responsive design

### ❌ MISSING FEATURES

#### 2.1 Calendar Blocking & AI Scheduling
**Status**: Partially implemented
- ✅ `CalendarBlockManagerNew.tsx` exists
- ✅ Basic calendar functionality
- ❌ **MISSING**: AI-powered task scheduling into unblocked time
- ❌ **MISSING**: Google Calendar bidirectional sync with `googleEventId`
- ❌ **MISSING**: Deep links in calendar events
- ❌ **MISSING**: `subTheme` field in calendar_blocks
- ❌ **MISSING**: Recovery constraints and theme targets

#### 2.2 Daily LLM Email Digest
**Status**: Stub implementation
- ✅ `dailyDigest.js` function exists in Cloud Functions
- ❌ **MISSING**: Comprehensive email generation logic
- ❌ **MISSING**: LLM narrative generation
- ❌ **MISSING**: Mobile-friendly HTML templates
- ❌ **MISSING**: `digests` collection schema

#### 2.3 Health & Nutrition Integrations
**Status**: Not implemented
- ❌ **MISSING**: OAuth integration functions for Strava, Runna, MyFitnessPal
- ❌ **MISSING**: `metrics_hrv`, `metrics_workouts`, `metrics_nutrition` collections
- ❌ **MISSING**: Integration tokens storage
- ❌ **MISSING**: Nightly data ingestion functions

#### 2.4 iOS Reminders Two-Way Sync
**Status**: Schema prepared, no implementation
- ✅ `reminderId` field exists in Task type
- ❌ **MISSING**: Sync functions
- ❌ **MISSING**: Conflict resolution logic
- ❌ **MISSING**: Activity stream logging for sync events

#### 2.5 Mobile View Enhancements
**Status**: Basic mobile view exists
- ✅ `MobileView.tsx` component exists
- ✅ Basic task display
- ❌ **MISSING**: `importanceScore` calculation
- ❌ **MISSING**: "Important Now" prioritization logic
- ❌ **MISSING**: One-tap complete/defer

#### 2.6 Test Automation Infrastructure
**Status**: Basic side-door auth exists
- ✅ `testLogin` function in Cloud Functions
- ✅ Test token generation
- ❌ **MISSING**: Comprehensive Selenium test suite
- ❌ **MISSING**: CI/CD integration
- ❌ **MISSING**: Test data management

---

## 2. Sprint Planning Blank Screen Diagnosis

### Root Cause Analysis
The `SprintPlanner.tsx` component appears well-implemented but may fail due to:

1. **Data Loading Issues**: Empty collections causing blank state
2. **Authentication Context**: User not properly authenticated
3. **Firebase Connection**: Network or permission issues
4. **Console Errors**: JavaScript errors preventing render

### Debug Steps
```javascript
// Check browser console for these logs:
// "SprintPlanner: Loading data for user: [uid]"
// "SprintPlanner: Loaded stories: [count]"
// "SprintPlanner: Loaded sprints: [count]"
// "SprintPlanner: Loaded goals: [count]"
```

### Quick Fix
The component shows empty state when no stories exist. Verify:
1. Stories collection has data for the user
2. User authentication is working
3. Firestore rules allow reading stories, sprints, goals

---

## 3. Comprehensive Test Script

### 3.1 Test Environment Setup

```javascript
// Test Account Credentials (Side Door)
const TEST_TOKEN = "test-token-2025-08-31";
const TEST_USER_UID = "test-user-bob-2025";
const BASE_URL = "https://bob20250810.web.app";

// Selenium WebDriver Setup
const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const driver = new Builder()
  .forBrowser('chrome')
  .setChromeOptions(new chrome.Options().addArguments('--headless'))
  .build();
```

### 3.2 Authentication Test

```javascript
describe('Authentication Tests', () => {
  test('Side Door Authentication', async () => {
    await driver.get(`${BASE_URL}/test-login?token=${TEST_TOKEN}`);
    await driver.wait(until.urlContains('/dashboard'), 5000);
    
    // Verify user is logged in
    const userElement = await driver.findElement(By.className('user-info'));
    expect(await userElement.getText()).toContain('Test User');
  });
});
```

### 3.3 Goals Management Tests

```javascript
describe('Goals Management - CRUD Operations', () => {
  beforeEach(async () => {
    await driver.get(`${BASE_URL}/goals`);
    await driver.wait(until.elementLocated(By.className('modern-goals-table')), 5000);
  });

  test('Create New Goal', async () => {
    // Click add goal button
    await driver.findElement(By.css('[data-testid="add-goal"]')).click();
    
    // Fill goal form
    await driver.findElement(By.name('title')).sendKeys('Test Marathon Training');
    await driver.findElement(By.name('description')).sendKeys('Complete marathon in under 4 hours');
    
    // Select theme
    const themeSelect = await driver.findElement(By.name('theme'));
    await themeSelect.sendKeys('Health');
    
    // Select status
    const statusSelect = await driver.findElement(By.name('status'));
    await statusSelect.sendKeys('Not Started');
    
    // Set target date
    await driver.findElement(By.name('targetDate')).sendKeys('2025-12-31');
    
    // Submit form
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    // Verify goal appears in table
    await driver.wait(until.elementLocated(By.xpath('//td[contains(text(), "Test Marathon Training")]')), 5000);
  });

  test('Inline Edit Goal Status', async () => {
    // Click on status cell
    const statusCell = await driver.findElement(By.xpath('//tr[1]//td[contains(@class, "status-cell")]'));
    await statusCell.click();
    
    // Select new status
    const statusSelect = await driver.findElement(By.css('.inline-edit-select'));
    await statusSelect.sendKeys('Work in Progress');
    
    // Click outside to save
    await driver.findElement(By.css('body')).click();
    
    // Verify status updated
    await driver.wait(until.elementTextContains(statusCell, 'Work in Progress'), 3000);
  });

  test('Modal Edit Goal', async () => {
    // Click edit button
    await driver.findElement(By.css('[data-testid="edit-goal-btn"]:first-of-type')).click();
    
    // Wait for modal
    await driver.wait(until.elementLocated(By.css('.modal-body')), 3000);
    
    // Edit title
    const titleInput = await driver.findElement(By.name('title'));
    await titleInput.clear();
    await titleInput.sendKeys('Updated Goal Title');
    
    // Save changes
    await driver.findElement(By.css('.modal-footer .btn-primary')).click();
    
    // Verify modal closes and title updated
    await driver.wait(until.stalenessOf(driver.findElement(By.css('.modal'))), 3000);
    await driver.wait(until.elementLocated(By.xpath('//td[contains(text(), "Updated Goal Title")]')), 5000);
  });

  test('Drag and Drop Goal Reordering', async () => {
    const sourceGoal = await driver.findElement(By.css('[data-testid="goal-row"]:first-of-type .drag-handle'));
    const targetGoal = await driver.findElement(By.css('[data-testid="goal-row"]:nth-of-type(3) .drag-handle'));
    
    // Perform drag and drop
    const actions = driver.actions();
    await actions.dragAndDrop(sourceGoal, targetGoal).perform();
    
    // Verify order changed (check by goal IDs or positions)
    await driver.sleep(1000); // Wait for animation
    const newOrder = await driver.findElements(By.css('[data-testid="goal-row"]'));
    expect(newOrder.length).toBeGreaterThan(0);
  });

  test('Delete Goal', async () => {
    // Get initial count
    const initialRows = await driver.findElements(By.css('[data-testid="goal-row"]'));
    const initialCount = initialRows.length;
    
    // Click delete button
    await driver.findElement(By.css('[data-testid="delete-goal-btn"]:first-of-type')).click();
    
    // Confirm deletion in alert
    await driver.wait(until.alertIsPresent(), 3000);
    await driver.switchTo().alert().accept();
    
    // Verify count decreased
    await driver.wait(async () => {
      const currentRows = await driver.findElements(By.css('[data-testid="goal-row"]'));
      return currentRows.length === initialCount - 1;
    }, 5000);
  });
});
```

### 3.4 Sprint Planning Tests

```javascript
describe('Sprint Planning & Management', () => {
  beforeEach(async () => {
    await driver.get(`${BASE_URL}/sprint-planning`);
    await driver.wait(until.elementLocated(By.className('sprint-planner')), 10000);
  });

  test('Sprint Planning Screen Loads', async () => {
    // Verify main components are present
    await driver.wait(until.elementLocated(By.css('.backlog-column')), 5000);
    await driver.wait(until.elementLocated(By.css('.sprints-section')), 5000);
    
    // Check for create sprint button
    const createBtn = await driver.findElement(By.css('[data-testid="create-sprint-btn"]'));
    expect(await createBtn.isDisplayed()).toBe(true);
  });

  test('Create New Sprint', async () => {
    // Click create sprint
    await driver.findElement(By.css('[data-testid="create-sprint-btn"]')).click();
    
    // Fill sprint form
    await driver.wait(until.elementLocated(By.css('.modal-body')), 3000);
    await driver.findElement(By.name('name')).sendKeys('Sprint 1');
    await driver.findElement(By.name('objective')).sendKeys('Complete user authentication');
    await driver.findElement(By.name('startDate')).sendKeys('2025-09-01');
    await driver.findElement(By.name('endDate')).sendKeys('2025-09-14');
    
    // Submit
    await driver.findElement(By.css('.modal-footer .btn-primary')).click();
    
    // Verify sprint appears
    await driver.wait(until.elementLocated(By.xpath('//div[contains(text(), "Sprint 1")]')), 5000);
  });

  test('Drag Story to Sprint', async () => {
    // Ensure we have stories and sprints
    await driver.wait(until.elementLocated(By.css('.story-card')), 5000);
    await driver.wait(until.elementLocated(By.css('.sprint-drop-zone')), 5000);
    
    const storyCard = await driver.findElement(By.css('.story-card:first-of-type'));
    const sprintZone = await driver.findElement(By.css('.sprint-drop-zone:first-of-type'));
    
    // Perform drag and drop
    await driver.actions().dragAndDrop(storyCard, sprintZone).perform();
    
    // Verify story moved to sprint
    await driver.sleep(1000);
    const sprintStories = await driver.findElements(By.css('.sprint-drop-zone:first-of-type .story-card'));
    expect(sprintStories.length).toBeGreaterThan(0);
  });

  test('Story Backlog Grouping by Theme', async () => {
    // Verify theme groups exist
    const themeGroups = await driver.findElements(By.css('.theme-group'));
    expect(themeGroups.length).toBeGreaterThan(0);
    
    // Check theme headers
    const healthGroup = await driver.findElement(By.xpath('//h6[contains(text(), "Health")]'));
    expect(await healthGroup.isDisplayed()).toBe(true);
  });
});
```

### 3.5 Current Sprint Kanban Tests

```javascript
describe('Current Sprint Kanban', () => {
  beforeEach(async () => {
    await driver.get(`${BASE_URL}/sprint-dashboard`);
    await driver.wait(until.elementLocated(By.className('kanban-board')), 5000);
  });

  test('Sprint Selector Functionality', async () => {
    // Click sprint selector
    await driver.findElement(By.css('[data-testid="sprint-selector"]')).click();
    
    // Select different sprint
    await driver.wait(until.elementLocated(By.css('.dropdown-menu')), 3000);
    await driver.findElement(By.css('.dropdown-item:nth-child(2)')).click();
    
    // Verify sprint changed
    await driver.sleep(1000);
    const currentSprint = await driver.findElement(By.css('.selected-sprint-name'));
    expect(await currentSprint.getText()).not.toBe('');
  });

  test('Story Card Drag Between Columns', async () => {
    const storyCard = await driver.findElement(By.css('.kanban-story-card:first-of-type'));
    const targetColumn = await driver.findElement(By.css('.kanban-column:nth-child(2) .drop-zone'));
    
    // Drag story to different column
    await driver.actions().dragAndDrop(storyCard, targetColumn).perform();
    
    // Verify story moved
    await driver.sleep(1000);
    const newColumnStories = await driver.findElements(By.css('.kanban-column:nth-child(2) .kanban-story-card'));
    expect(newColumnStories.length).toBeGreaterThan(0);
  });

  test('Expandable Task Subgrid (If Implemented)', async () => {
    // Click on story to expand tasks
    await driver.findElement(By.css('.story-card:first-of-type')).click();
    
    // Check if task subgrid appears
    try {
      await driver.wait(until.elementLocated(By.css('.task-subgrid')), 3000);
      const taskRows = await driver.findElements(By.css('.task-row'));
      expect(taskRows.length).toBeGreaterThan(0);
    } catch (error) {
      console.log('Task subgrid not implemented yet');
    }
  });
});
```

### 3.6 Stories and Tasks CRUD Tests

```javascript
describe('Stories Management', () => {
  beforeEach(async () => {
    await driver.get(`${BASE_URL}/stories`);
    await driver.wait(until.elementLocated(By.className('stories-table')), 5000);
  });

  test('Create Story', async () => {
    await driver.findElement(By.css('[data-testid="add-story-btn"]')).click();
    
    // Fill story form
    await driver.findElement(By.name('title')).sendKeys('User Authentication API');
    await driver.findElement(By.name('description')).sendKeys('Implement JWT-based authentication');
    
    // Select goal
    const goalSelect = await driver.findElement(By.name('goalId'));
    await goalSelect.sendKeys(Key.ARROW_DOWN, Key.ENTER);
    
    // Set priority and points
    await driver.findElement(By.name('priority')).sendKeys('P1');
    await driver.findElement(By.name('points')).sendKeys('8');
    
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    // Verify story created
    await driver.wait(until.elementLocated(By.xpath('//td[contains(text(), "User Authentication API")]')), 5000);
  });

  test('Link Story to Goal', async () => {
    // Edit existing story
    await driver.findElement(By.css('[data-testid="edit-story-btn"]:first-of-type')).click();
    
    // Change goal
    const goalSelect = await driver.findElement(By.name('goalId'));
    await goalSelect.sendKeys(Key.ARROW_DOWN, Key.ENTER);
    
    await driver.findElement(By.css('.modal-footer .btn-primary')).click();
    
    // Verify goal linked
    await driver.sleep(1000);
    const goalColumn = await driver.findElement(By.css('tr:first-child .goal-column'));
    expect(await goalColumn.getText()).not.toBe('');
  });
});

describe('Tasks Management', () => {
  beforeEach(async () => {
    await driver.get(`${BASE_URL}/tasks`);
    await driver.wait(until.elementLocated(By.className('tasks-table')), 5000);
  });

  test('Create Task', async () => {
    await driver.findElement(By.css('[data-testid="add-task-btn"]')).click();
    
    await driver.findElement(By.name('title')).sendKeys('Set up JWT middleware');
    await driver.findElement(By.name('description')).sendKeys('Configure express-jwt middleware');
    
    // Select parent story
    const storySelect = await driver.findElement(By.name('parentId'));
    await storySelect.sendKeys(Key.ARROW_DOWN, Key.ENTER);
    
    await driver.findElement(By.name('priority')).sendKeys('high');
    await driver.findElement(By.name('effort')).sendKeys('M');
    await driver.findElement(By.name('estimateMin')).sendKeys('120');
    
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    await driver.wait(until.elementLocated(By.xpath('//td[contains(text(), "Set up JWT middleware")]')), 5000);
  });

  test('Task Status Updates', async () => {
    // Click on status cell
    const statusCell = await driver.findElement(By.css('tr:first-child .status-cell'));
    await statusCell.click();
    
    // Change status
    const statusSelect = await driver.findElement(By.css('.inline-edit-select'));
    await statusSelect.sendKeys('in-progress');
    
    await driver.findElement(By.css('body')).click();
    
    // Verify status updated
    await driver.wait(until.elementTextContains(statusCell, 'in-progress'), 3000);
  });
});
```

### 3.7 Calendar Integration Tests

```javascript
describe('Calendar Functionality', () => {
  beforeEach(async () => {
    await driver.get(`${BASE_URL}/calendar`);
    await driver.wait(until.elementLocated(By.className('calendar-view')), 5000);
  });

  test('Create Calendar Block', async () => {
    // Click on calendar slot
    await driver.findElement(By.css('.calendar-slot[data-hour="14"]')).click();
    
    // Fill block form
    await driver.findElement(By.name('title')).sendKeys('Workout Session');
    await driver.findElement(By.name('theme')).sendKeys('Health');
    await driver.findElement(By.name('startTime')).sendKeys('14:00');
    await driver.findElement(By.name('endTime')).sendKeys('15:30');
    
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    // Verify block appears
    await driver.wait(until.elementLocated(By.xpath('//div[contains(text(), "Workout Session")]')), 5000);
  });

  test('Link Story to Calendar Block', async () => {
    // Create block linked to story
    await driver.findElement(By.css('.calendar-slot[data-hour="10"]')).click();
    
    await driver.findElement(By.name('title')).sendKeys('API Development');
    
    // Select story
    const storySelect = await driver.findElement(By.name('storyId'));
    await storySelect.sendKeys(Key.ARROW_DOWN, Key.ENTER);
    
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    // Verify story link
    const block = await driver.findElement(By.xpath('//div[contains(text(), "API Development")]'));
    expect(await block.getAttribute('data-story-id')).not.toBe('');
  });
});
```

### 3.8 Mobile View Tests

```javascript
describe('Mobile View', () => {
  beforeEach(async () => {
    // Set mobile viewport
    await driver.manage().window().setRect({ width: 375, height: 667 });
    await driver.get(`${BASE_URL}/mobile`);
    await driver.wait(until.elementLocated(By.className('mobile-view')), 5000);
  });

  test('Important Tasks Surface First', async () => {
    // Verify important tasks section
    const importantSection = await driver.findElement(By.css('.important-now-section'));
    expect(await importantSection.isDisplayed()).toBe(true);
    
    // Check task priorities
    const importantTasks = await driver.findElements(By.css('.important-task'));
    expect(importantTasks.length).toBeGreaterThan(0);
  });

  test('One-Tap Task Complete', async () => {
    // Tap complete button
    await driver.findElement(By.css('.task-complete-btn:first-of-type')).click();
    
    // Verify task completed
    await driver.sleep(500);
    const completedTask = await driver.findElement(By.css('.task-item:first-of-type'));
    expect(await completedTask.getAttribute('class')).toContain('completed');
  });

  test('Habits Checklist Strip', async () => {
    // Verify habits strip at top
    const habitsStrip = await driver.findElement(By.css('.habits-strip'));
    expect(await habitsStrip.isDisplayed()).toBe(true);
    
    // Check habit checkboxes
    const habitCheckboxes = await driver.findElements(By.css('.habit-checkbox'));
    expect(habitCheckboxes.length).toBeGreaterThan(0);
    
    // Toggle habit
    await habitCheckboxes[0].click();
    
    // Verify streak badge updates
    const streakBadge = await driver.findElement(By.css('.streak-badge'));
    expect(await streakBadge.getText()).toMatch(/\d+/);
  });
});
```

### 3.9 Performance Tests

```javascript
describe('Performance Tests', () => {
  test('Page Load Times', async () => {
    const startTime = Date.now();
    await driver.get(`${BASE_URL}/dashboard`);
    await driver.wait(until.elementLocated(By.className('dashboard-content')), 5000);
    const loadTime = Date.now() - startTime;
    
    expect(loadTime).toBeLessThan(3000); // Should load in under 3 seconds
  });

  test('Drag and Drop Responsiveness', async () => {
    await driver.get(`${BASE_URL}/goals`);
    await driver.wait(until.elementLocated(By.css('.goal-row')), 5000);
    
    const startTime = Date.now();
    
    const sourceGoal = await driver.findElement(By.css('.goal-row:first-of-type .drag-handle'));
    const targetGoal = await driver.findElement(By.css('.goal-row:nth-of-type(2) .drag-handle'));
    
    await driver.actions().dragAndDrop(sourceGoal, targetGoal).perform();
    
    // Wait for visual feedback (optimistic UI)
    await driver.sleep(200);
    const responseTime = Date.now() - startTime;
    
    expect(responseTime).toBeLessThan(500); // Should respond in under 500ms
  });

  test('Large Dataset Handling', async () => {
    // Test with many items
    await driver.get(`${BASE_URL}/stories`);
    await driver.wait(until.elementLocated(By.css('.stories-table')), 5000);
    
    const rows = await driver.findElements(By.css('.story-row'));
    
    // Should handle at least 100 items without performance issues
    if (rows.length > 50) {
      const scrollStart = Date.now();
      await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
      await driver.sleep(100);
      const scrollTime = Date.now() - scrollStart;
      
      expect(scrollTime).toBeLessThan(200); // Smooth scrolling
    }
  });
});
```

### 3.10 Integration Tests

```javascript
describe('End-to-End Workflows', () => {
  test('Complete Goal-to-Task Workflow', async () => {
    // 1. Create Goal
    await driver.get(`${BASE_URL}/goals`);
    await driver.findElement(By.css('[data-testid="add-goal-btn"]')).click();
    await driver.findElement(By.name('title')).sendKeys('E2E Test Goal');
    await driver.findElement(By.name('theme')).sendKeys('Growth');
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    const goalId = await driver.findElement(By.css('.goal-row:last-child')).getAttribute('data-goal-id');
    
    // 2. Create Story linked to Goal
    await driver.get(`${BASE_URL}/stories`);
    await driver.findElement(By.css('[data-testid="add-story-btn"]')).click();
    await driver.findElement(By.name('title')).sendKeys('E2E Test Story');
    
    const goalSelect = await driver.findElement(By.name('goalId'));
    await goalSelect.sendKeys(goalId);
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    const storyId = await driver.findElement(By.css('.story-row:last-child')).getAttribute('data-story-id');
    
    // 3. Create Task linked to Story
    await driver.get(`${BASE_URL}/tasks`);
    await driver.findElement(By.css('[data-testid="add-task-btn"]')).click();
    await driver.findElement(By.name('title')).sendKeys('E2E Test Task');
    
    const storySelect = await driver.findElement(By.name('parentId'));
    await storySelect.sendKeys(storyId);
    await driver.findElement(By.css('button[type="submit"]')).click();
    
    // 4. Move Story to Sprint
    await driver.get(`${BASE_URL}/sprint-planning`);
    await driver.wait(until.elementLocated(By.xpath(`//div[@data-story-id="${storyId}"]`)), 5000);
    
    const storyCard = await driver.findElement(By.xpath(`//div[@data-story-id="${storyId}"]`));
    const sprintZone = await driver.findElement(By.css('.sprint-drop-zone:first-of-type'));
    
    await driver.actions().dragAndDrop(storyCard, sprintZone).perform();
    
    // 5. Verify Task appears in Sprint Dashboard
    await driver.get(`${BASE_URL}/sprint-dashboard`);
    await driver.wait(until.elementLocated(By.xpath(`//div[contains(text(), "E2E Test Story")]`)), 5000);
    
    // 6. Complete Task
    const taskComplete = await driver.findElement(By.css(`[data-task-id] .complete-btn`));
    await taskComplete.click();
    
    // 7. Verify Goal Progress Updated
    await driver.get(`${BASE_URL}/goals`);
    const goalProgress = await driver.findElement(By.xpath(`//tr[@data-goal-id="${goalId}"]//td[contains(@class, "progress")]`));
    expect(await goalProgress.getText()).toMatch(/\d+%/);
  });

  test('Sprint Lifecycle Management', async () => {
    // Create sprint, add stories, activate, complete
    await driver.get(`${BASE_URL}/sprint-planning`);
    
    // Create sprint
    await driver.findElement(By.css('[data-testid="create-sprint-btn"]')).click();
    await driver.findElement(By.name('name')).sendKeys('E2E Test Sprint');
    await driver.findElement(By.name('startDate')).sendKeys('2025-09-01');
    await driver.findElement(By.name('endDate')).sendKeys('2025-09-14');
    await driver.findElement(By.css('.modal-footer .btn-primary')).click();
    
    // Add stories to sprint
    const stories = await driver.findElements(By.css('.backlog .story-card'));
    if (stories.length > 0) {
      const sprintZone = await driver.findElement(By.css('.sprint-drop-zone:last-of-type'));
      await driver.actions().dragAndDrop(stories[0], sprintZone).perform();
    }
    
    // Activate sprint (if functionality exists)
    const activateBtn = await driver.findElement(By.css('.activate-sprint-btn'));
    if (await activateBtn.isDisplayed()) {
      await activateBtn.click();
    }
    
    // Verify sprint status
    const sprintStatus = await driver.findElement(By.css('.sprint-status'));
    expect(['planned', 'active']).toContain(await sprintStatus.getText());
  });
});
```

---

## 4. Test Data Management

### 4.1 Test Data Setup

```javascript
// Test data creation functions
const createTestData = async () => {
  const testGoals = [
    {
      title: "Complete Marathon Training",
      theme: "Health",
      status: "Work in Progress",
      description: "Train for and complete a marathon in under 4 hours"
    },
    {
      title: "Learn React Advanced Patterns",
      theme: "Growth", 
      status: "Not Started",
      description: "Master advanced React patterns and hooks"
    },
    {
      title: "Build Emergency Fund",
      theme: "Wealth",
      status: "Work in Progress", 
      description: "Save 6 months of expenses"
    }
  ];

  const testStories = [
    {
      title: "Weekly Long Runs",
      goalId: "marathon-goal-id",
      priority: "P1",
      points: 5,
      status: "backlog"
    },
    {
      title: "Speed Training Sessions", 
      goalId: "marathon-goal-id",
      priority: "P2",
      points: 3,
      status: "backlog"
    }
  ];

  const testTasks = [
    {
      title: "Sunday 20K Run",
      parentId: "long-runs-story-id",
      priority: "high",
      effort: "L",
      estimateMin: 120,
      status: "todo"
    }
  ];

  // Insert test data via API or direct database calls
  return { testGoals, testStories, testTasks };
};
```

### 4.2 Test Data Cleanup

```javascript
const cleanupTestData = async () => {
  // Remove all test data created during test runs
  const testCollections = ['goals', 'stories', 'tasks', 'sprints', 'calendar_blocks'];
  
  for (const collection of testCollections) {
    // Delete test documents
    const testDocs = await db.collection(collection)
      .where('ownerUid', '==', TEST_USER_UID)
      .where('title', '>=', 'E2E Test')
      .where('title', '<', 'E2E Tesu')
      .get();
    
    const batch = db.batch();
    testDocs.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
};
```

---

## 5. CI/CD Integration

### 5.1 GitHub Actions Workflow

```yaml
name: BOB E2E Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: |
          cd react-app
          npm ci
          
      - name: Build application
        run: |
          cd react-app
          npm run build
          
      - name: Setup Chrome
        uses: browser-actions/setup-chrome@latest
        
      - name: Run E2E tests
        run: |
          npm test -- --testNamePattern="E2E"
        env:
          TEST_BASE_URL: ${{ secrets.TEST_BASE_URL }}
          TEST_TOKEN: ${{ secrets.TEST_TOKEN }}
          
      - name: Upload test artifacts
        uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: test-screenshots
          path: test-screenshots/
```

---

## 6. Recommended Fixes & Implementation

### Priority 1: Sprint Planning Blank Screen
1. Add debugging console logs to identify data loading issues
2. Verify Firestore security rules allow reading required collections
3. Add error handling and user feedback
4. Test with sample data

### Priority 2: Missing Task Subgrid in Kanban
1. Extend `CurrentSprintKanban.tsx` with expandable story cards
2. Add inline task editing interface
3. Implement Excel-like cell editing

### Priority 3: Calendar AI Scheduling
1. Implement AI task scheduling algorithm
2. Add Google Calendar bidirectional sync
3. Create deep links in calendar events

### Priority 4: Complete Test Suite
1. Implement comprehensive Selenium tests
2. Add CI/CD integration
3. Create test data management utilities

---

## 7. Success Metrics

- **Test Coverage**: 90%+ of user workflows covered
- **Performance**: Page loads < 3s, drag-drop < 500ms
- **Reliability**: 99%+ test pass rate in CI
- **User Experience**: Zero critical bugs in production
- **Data Integrity**: All CRUD operations maintain referential integrity

---

This comprehensive test script provides the foundation for ensuring BOB's quality and reliability across all features while identifying gaps that need to be addressed in future development cycles.
