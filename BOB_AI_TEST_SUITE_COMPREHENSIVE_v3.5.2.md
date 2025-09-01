# BOB AI Test Suite - Goal and Story Management CRUD Testing
**Version:** v3.5.2  
**Date:** September 1, 2025  
**Purpose:** Comprehensive AI-driven testing of Goal-Story linking and CRUD operations

## Test Environment Setup

### Prerequisites
- BOB Application: https://bob20250810.web.app/
- Test User: donnelly.jim@gmail.com
- Test Mode: Browser automation with Selenium/Playwright
- Target Modules: Goals Management, Stories, Theme-Goal Linking

## Test Suite Structure

### Phase 1: Authentication & Setup
```python
# AI Test Agent Authentication Script
import playwright
from playwright.sync_api import sync_playwright

class BOBTestAgent:
    def __init__(self):
        self.base_url = "https://bob20250810.web.app"
        self.test_user = "donnelly.jim@gmail.com"
        self.page = None
        self.observations = []
        self.defects = []
        self.enhancements = []
    
    def setup_browser(self):
        """Initialize browser and authenticate"""
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=False)
        self.page = self.browser.new_page()
        
    def authenticate(self):
        """Perform Google authentication"""
        self.page.goto(f"{self.base_url}")
        # Handle Google OAuth flow
        self.observe("Authentication flow initiated")
        
    def observe(self, observation, category="INFO"):
        """Log observations for analysis"""
        self.observations.append({
            "timestamp": datetime.now(),
            "category": category,
            "observation": observation,
            "screenshot": self.page.screenshot()
        })
```

### Phase 2: Goal CRUD Operations Testing

#### Test Case 1: Goal Creation via FAB
```python
def test_goal_creation_via_fab(self):
    """Test goal creation using Floating Action Button"""
    try:
        # Navigate to dashboard
        self.page.goto(f"{self.base_url}/dashboard")
        
        # Click FAB button
        fab_button = self.page.locator('[data-testid="floating-action-button"]')
        fab_button.click()
        
        # Select Goal option
        goal_option = self.page.locator('text="Goal"')
        goal_option.click()
        
        # Fill goal form
        goal_data = {
            "title": f"AI Test Goal {datetime.now().strftime('%H%M%S')}",
            "description": "Automated test goal creation",
            "priority": "High",
            "theme": "Personal Development"
        }
        
        self.page.fill('[name="title"]', goal_data["title"])
        self.page.fill('[name="description"]', goal_data["description"])
        
        # Submit form
        self.page.click('button[type="submit"]')
        
        # Verify goal appears in list
        self.page.wait_for_selector(f'text="{goal_data["title"]}"')
        
        # CHECK: Reference number assignment
        goal_element = self.page.locator(f'text="{goal_data["title"]}"').first
        reference_number = goal_element.locator('..').locator('[data-testid="reference-number"]')
        
        if reference_number.count() == 0:
            self.defects.append({
                "severity": "HIGH",
                "issue": "Goal created via FAB missing reference number",
                "description": "Goals created through FAB don't get reference numbers in table view",
                "reproduction": "Use FAB -> Goal -> Submit, then check table view",
                "expected": "Goal should have reference number like GR-05570A",
                "actual": "No reference number displayed"
            })
        
        self.observe(f"Goal creation test completed - Reference number check: {'PASS' if reference_number.count() > 0 else 'FAIL'}")
        
    except Exception as e:
        self.defects.append({
            "severity": "CRITICAL",
            "issue": "Goal creation via FAB failed",
            "error": str(e)
        })
```

#### Test Case 2: Goal-Theme Linking
```python
def test_theme_goal_linking(self):
    """Test theme assignment and goal categorization"""
    try:
        # Navigate to goals management
        self.page.goto(f"{self.base_url}/goals-management")
        
        # Select first goal
        first_goal = self.page.locator('[data-testid="goal-card"]').first
        first_goal.click()
        
        # Check theme assignment UI
        theme_selector = self.page.locator('[data-testid="theme-selector"]')
        if theme_selector.count() == 0:
            self.enhancements.append({
                "priority": "MEDIUM",
                "enhancement": "Add theme assignment UI to goal details",
                "description": "No visible theme assignment interface in goal management",
                "benefit": "Better goal categorization and filtering"
            })
        
        # Test theme filtering
        theme_filters = self.page.locator('[data-testid="theme-filter"]')
        theme_count = theme_filters.count()
        
        self.observe(f"Theme linking test - Available themes: {theme_count}")
        
        if theme_count > 0:
            # Test filtering by theme
            first_theme = theme_filters.first
            theme_name = first_theme.text_content()
            first_theme.click()
            
            # Verify filtered results
            self.page.wait_for_timeout(1000)
            filtered_goals = self.page.locator('[data-testid="goal-card"]')
            
            self.observe(f"Theme filter '{theme_name}' applied - Goals shown: {filtered_goals.count()}")
        
    except Exception as e:
        self.defects.append({
            "severity": "MEDIUM",
            "issue": "Theme-goal linking test failed",
            "error": str(e)
        })
```

#### Test Case 3: Goal-Story Linking & Management
```python
def test_goal_story_linking(self):
    """Test goal to story linking and table view functionality"""
    try:
        # Navigate to goals management
        self.page.goto(f"{self.base_url}/goals-management")
        
        # Select a goal with stories
        goal_with_stories = self.page.locator('[data-testid="goal-card"]').first
        goal_with_stories.click()
        
        # Verify stories table appears
        stories_table = self.page.locator('[data-testid="stories-table"]')
        self.page.wait_for_selector('[data-testid="stories-table"]', timeout=5000)
        
        if stories_table.count() == 0:
            self.defects.append({
                "severity": "HIGH",
                "issue": "Stories table not appearing when goal selected",
                "reproduction": "Click on goal card in goals management"
            })
            return
        
        # Test story filtering by goal
        story_rows = self.page.locator('[data-testid="story-row"]')
        story_count = story_rows.count()
        
        self.observe(f"Goal-story linking - Stories found: {story_count}")
        
        # Test in-line editing
        if story_count > 0:
            first_story = story_rows.first
            
            # Test status editing
            status_cell = first_story.locator('[data-testid="story-status-cell"]')
            status_cell.click()
            
            status_dropdown = self.page.locator('[data-testid="status-dropdown"]')
            if status_dropdown.count() > 0:
                self.observe("In-line status editing available")
                
                # Test status change
                new_status = status_dropdown.locator('option').nth(1)
                new_status.click()
                
                # Verify save
                save_button = self.page.locator('[data-testid="save-changes"]')
                if save_button.count() > 0:
                    save_button.click()
                    self.observe("Story status updated successfully")
                else:
                    self.defects.append({
                        "severity": "MEDIUM",
                        "issue": "No save mechanism for in-line edits",
                        "description": "Changes to story status don't have clear save action"
                    })
            
            # Test sprint assignment editing
            sprint_cell = first_story.locator('[data-testid="story-sprint-cell"]')
            sprint_cell.click()
            
            sprint_dropdown = self.page.locator('[data-testid="sprint-dropdown"]')
            if sprint_dropdown.count() > 0:
                self.observe("In-line sprint assignment available")
                
                # Test sprint change
                new_sprint = sprint_dropdown.locator('option').nth(1)
                sprint_name = new_sprint.text_content()
                new_sprint.click()
                
                self.observe(f"Story sprint changed to: {sprint_name}")
            else:
                self.enhancements.append({
                    "priority": "HIGH",
                    "enhancement": "Add in-line sprint assignment for stories",
                    "description": "Stories should allow sprint assignment directly from goals view",
                    "benefit": "Faster story management and sprint planning"
                })
        
        # Test Edit/Delete buttons
        if story_count > 0:
            edit_button = story_rows.first.locator('[data-testid="story-edit-btn"]')
            delete_button = story_rows.first.locator('[data-testid="story-delete-btn"]')
            
            if edit_button.count() == 0:
                self.defects.append({
                    "severity": "HIGH",
                    "issue": "Missing edit button for stories",
                    "description": "Stories in goal view don't have edit buttons"
                })
            
            if delete_button.count() == 0:
                self.defects.append({
                    "severity": "MEDIUM",
                    "issue": "Missing delete button for stories",
                    "description": "Stories in goal view don't have delete buttons"
                })
            
            # Test edit functionality
            if edit_button.count() > 0:
                edit_button.click()
                
                # Verify edit modal/form opens
                edit_modal = self.page.locator('[data-testid="story-edit-modal"]')
                if edit_modal.count() > 0:
                    self.observe("Story edit modal opens successfully")
                    
                    # Test form fields
                    title_field = edit_modal.locator('[name="title"]')
                    description_field = edit_modal.locator('[name="description"]')
                    
                    if title_field.count() > 0 and description_field.count() > 0:
                        self.observe("Story edit form has required fields")
                    else:
                        self.defects.append({
                            "severity": "MEDIUM",
                            "issue": "Story edit form missing required fields",
                            "expected": "Title and description fields should be present"
                        })
                    
                    # Close modal
                    close_button = edit_modal.locator('[data-testid="close-modal"]')
                    if close_button.count() > 0:
                        close_button.click()
        
    except Exception as e:
        self.defects.append({
            "severity": "HIGH",
            "issue": "Goal-story linking test failed",
            "error": str(e)
        })
```

### Phase 3: Reference Number Generation Testing
```python
def test_reference_number_generation(self):
    """Test reference number assignment for all entities"""
    try:
        entities_to_test = [
            {"type": "goal", "prefix": "GR-", "route": "/goals-management"},
            {"type": "story", "prefix": "ST-", "route": "/stories"},
            {"type": "task", "prefix": "TSK-", "route": "/task-list"}
        ]
        
        for entity in entities_to_test:
            self.page.goto(f"{self.base_url}{entity['route']}")
            
            # Check existing items for reference numbers
            items = self.page.locator(f'[data-testid="{entity["type"]}-row"]')
            item_count = items.count()
            
            items_with_refs = 0
            items_without_refs = 0
            
            for i in range(min(5, item_count)):  # Check first 5 items
                item = items.nth(i)
                ref_number = item.locator('[data-testid="reference-number"]')
                
                if ref_number.count() > 0:
                    ref_text = ref_number.text_content()
                    if ref_text.startswith(entity["prefix"]):
                        items_with_refs += 1
                    else:
                        self.defects.append({
                            "severity": "LOW",
                            "issue": f"Incorrect reference number format for {entity['type']}",
                            "expected": f"Should start with {entity['prefix']}",
                            "actual": ref_text
                        })
                else:
                    items_without_refs += 1
            
            if items_without_refs > 0:
                self.defects.append({
                    "severity": "MEDIUM",
                    "issue": f"Missing reference numbers for {entity['type']}",
                    "description": f"{items_without_refs} out of {min(5, item_count)} {entity['type']}s missing reference numbers",
                    "impact": "Difficult to reference and track items"
                })
            
            self.observe(f"Reference number check for {entity['type']}: {items_with_refs} with refs, {items_without_refs} without")
        
    except Exception as e:
        self.defects.append({
            "severity": "MEDIUM",
            "issue": "Reference number generation test failed",
            "error": str(e)
        })
```

### Phase 4: Comprehensive Analysis & Reporting
```python
def generate_test_report(self):
    """Generate comprehensive test report with recommendations"""
    
    report = {
        "test_execution": {
            "timestamp": datetime.now(),
            "version": "v3.5.2",
            "total_observations": len(self.observations),
            "total_defects": len(self.defects),
            "total_enhancements": len(self.enhancements)
        },
        
        "defect_summary": {
            "critical": len([d for d in self.defects if d.get("severity") == "CRITICAL"]),
            "high": len([d for d in self.defects if d.get("severity") == "HIGH"]),
            "medium": len([d for d in self.defects if d.get("severity") == "MEDIUM"]),
            "low": len([d for d in self.defects if d.get("severity") == "LOW"])
        },
        
        "enhancement_summary": {
            "high": len([e for e in self.enhancements if e.get("priority") == "HIGH"]),
            "medium": len([e for e in self.enhancements if e.get("priority") == "MEDIUM"]),
            "low": len([e for e in self.enhancements if e.get("priority") == "LOW"])
        },
        
        "detailed_findings": {
            "defects": self.defects,
            "enhancements": self.enhancements,
            "observations": self.observations
        },
        
        "recommendations": self.generate_recommendations()
    }
    
    return report

def generate_recommendations(self):
    """Generate actionable recommendations based on test results"""
    recommendations = []
    
    # Reference number issues
    ref_defects = [d for d in self.defects if "reference number" in d.get("issue", "").lower()]
    if ref_defects:
        recommendations.append({
            "category": "Data Integrity",
            "priority": "HIGH",
            "title": "Implement Consistent Reference Number Generation",
            "description": "Add automatic reference number generation for all CRUD operations",
            "implementation": "Create a service to generate unique references on entity creation",
            "impact": "Improved traceability and user experience"
        })
    
    # CRUD parity issues
    crud_defects = [d for d in self.defects if any(word in d.get("issue", "").lower() for word in ["edit", "delete", "create"])]
    if crud_defects:
        recommendations.append({
            "category": "Functionality",
            "priority": "HIGH",
            "title": "Ensure CRUD Parity Across All Entities",
            "description": "Standardize create, read, update, delete operations for goals, stories, and tasks",
            "implementation": "Audit and align CRUD interfaces across all entity types",
            "impact": "Consistent user experience and reduced training burden"
        })
    
    return recommendations
```

## Execution Script
```python
def run_comprehensive_test():
    """Execute the full test suite"""
    agent = BOBTestAgent()
    
    try:
        # Setup
        agent.setup_browser()
        agent.authenticate()
        
        # Execute test phases
        agent.test_goal_creation_via_fab()
        agent.test_theme_goal_linking()
        agent.test_goal_story_linking()
        agent.test_reference_number_generation()
        
        # Generate report
        report = agent.generate_test_report()
        
        # Save results
        with open(f"bob_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json", "w") as f:
            json.dump(report, f, indent=2, default=str)
        
        print("Test execution completed. Report generated.")
        
    except Exception as e:
        print(f"Test execution failed: {e}")
    
    finally:
        agent.browser.close()
        agent.playwright.stop()

if __name__ == "__main__":
    run_comprehensive_test()
```

## Expected Test Outcomes

### Key Areas to Validate:
1. **Reference Number Generation** - All entities should have consistent reference numbers
2. **Goal-Story Linking** - Stories should filter properly when goal is selected
3. **In-line Editing** - Sprint assignments and status changes should work seamlessly
4. **CRUD Operations** - All create, read, update, delete operations should work consistently
5. **Theme Management** - Goal categorization and filtering by themes

### Success Criteria:
- ✅ All CRUD operations work without permission errors
- ✅ Reference numbers generated for all new entities
- ✅ Goal-story linking functional with proper filtering
- ✅ In-line editing saves changes correctly
- ✅ Edit/delete buttons present and functional

Would you like me to implement this test suite and run it, or would you prefer to confirm the specific requirements from your screenshot first?
