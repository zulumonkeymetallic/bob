# 🤖 Agentic AI Testing Instructions for BOB

## Test User Credentials
- **Email**: agenticaitestuser@jc1.tech
- **Password**: SecureAgenticAI2025!
- **Display Name**: Agentic AI Test User
- **Purpose**: Permanent testing account for Agentic AI workflows

## Authentication Methods

### Method 1: Email/Password Login
1. Navigate to: https://bob20250810.web.app
2. Click the "Sign in with Google" button
3. Enter email: **agenticaitestuser@jc1.tech**
4. Enter password: **SecureAgenticAI2025!**
5. Complete authentication

### Method 2: Side-Door Authentication (For Automation)
1. Get the custom token from `agentic-ai-test-token.txt`
2. Navigate to: https://bob20250810.web.app?test-login=TOKEN&test-mode=true
3. Replace TOKEN with the actual token value
4. Authentication should be automatic

## Testing Scenarios

### 📋 Goals Management Testing
- **Create Goal**: Navigate to Goals → Add New Goal
- **Edit Goal**: Click on existing goal → Edit details
- **Delete Goal**: Use goal options menu → Delete
- **Goal Status**: Update status (Not Started, In Progress, Completed)
- **Goal Priority**: Test High, Medium, Low priorities

### 📝 Tasks Management Testing  
- **Create Task**: Go to Tasks → Add New Task
- **Task Assignment**: Assign tasks to goals
- **Task Status**: Update task completion status
- **Task Dependencies**: Test task relationships

### 📖 Stories Management Testing
- **Create Story**: Navigate to Stories → Add Story
- **Story Details**: Edit story description and acceptance criteria
- **Story Points**: Assign and update story points
- **Story Status**: Move through workflow states

### 🏃‍♂️ Sprint Planning Testing
- **Create Sprint**: Go to Sprints → New Sprint
- **Add Items**: Add goals/stories/tasks to sprint
- **Sprint Status**: Start, progress, and complete sprints
- **Capacity Planning**: Test velocity and capacity features

### 📊 Kanban Board Testing
- **Board Navigation**: Test different kanban views
- **Drag & Drop**: Move items between columns
- **Card Details**: Test card editing and updates
- **Filtering**: Use filters and search functionality

### 📅 Calendar Integration Testing
- **Calendar Sync**: Test calendar integration features
- **Event Creation**: Create calendar events from tasks
- **Time Blocking**: Test time blocking functionality
- **Notifications**: Verify calendar notifications

### 🎨 UI/UX Workflow Testing
- **Navigation**: Test all menu items and routes
- **Responsive Design**: Test on different screen sizes
- **Theme Switching**: Test dark/light mode
- **Performance**: Check loading times and responsiveness

### 📧 Email Notification Testing
- **Goal Updates**: Create/update goals to trigger notifications
- **Task Assignments**: Assign tasks to test assignment emails
- **Sprint Changes**: Update sprints to test sprint notifications
- **System Alerts**: Test system-generated alerts

## Browser Automation Scripts

### Selenium Example (Python)
```python
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

def test_agentic_ai_login():
    driver = webdriver.Firefox()
    try:
        # Method 1: Email/Password
        driver.get("https://bob20250810.web.app")
        
        # Wait for login form and authenticate
        email_field = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='email']"))
        )
        email_field.send_keys("agenticaitestuser@jc1.tech")
        
        password_field = driver.find_element(By.CSS_SELECTOR, "input[type='password']")
        password_field.send_keys("SecureAgenticAI2025!")
        
        login_button = driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
        login_button.click()
        
        # Wait for dashboard to load
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".sidebar"))
        )
        
        print("✅ Agentic AI authentication successful")
        
    finally:
        driver.quit()
```

### Playwright Example (JavaScript)
```javascript
const { chromium } = require('playwright');

async function testAgenticAIWorkflow() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    try {
        // Navigate and authenticate
        await page.goto('https://bob20250810.web.app');
        
        // Email/Password authentication
        await page.fill('input[type="email"]', 'agenticaitestuser@jc1.tech');
        await page.fill('input[type="password"]', 'SecureAgenticAI2025!');
        await page.click('button[type="submit"]');
        
        // Wait for dashboard
        await page.waitForSelector('.sidebar');
        
        // Test Goals CRUD
        await page.click('a[href="/goals"]');
        await page.click('button:has-text("Add Goal")');
        await page.fill('input[name="title"]', 'Agentic AI Test Goal');
        await page.fill('textarea[name="description"]', 'Test goal created by Agentic AI');
        await page.click('button:has-text("Save")');
        
        console.log('✅ Agentic AI workflow test completed');
        
    } finally {
        await browser.close();
    }
}
```

## Expected Test Results

### ✅ Success Indicators
- Authentication completes without errors
- Navigation between sections works smoothly
- CRUD operations save data correctly
- Email notifications are sent to @jc1.tech
- UI remains responsive during operations
- No console errors or warnings

### ❌ Failure Indicators
- Authentication fails or times out
- Navigation results in 404 or error pages
- Data doesn't save or corrupts
- Email notifications not received
- UI becomes unresponsive
- Console shows critical errors

## Support and Troubleshooting

### Common Issues
1. **Authentication Fails**: Check credentials and try side-door method
2. **Page Load Issues**: Clear browser cache and cookies
3. **Email Not Received**: Check spam folder and @jc1.tech domain setup
4. **UI Not Loading**: Check browser console for JavaScript errors

### Debug Information
- **Test User UID**: agentic-ai-test-user
- **Auth Provider**: Email/Password
- **Domain**: @jc1.tech (for email testing)
- **Environment**: Production (bob20250810.web.app)

### Contact
For issues with the test account or BOB application, contact the development team.

---
*Generated: 2025-09-02T09:28:07.741Z*
*BOB Version: v3.5.0*
*Test User: Permanent (Never Deleted)*
