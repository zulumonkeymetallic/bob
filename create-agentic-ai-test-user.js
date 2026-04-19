const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Agentic AI Test User Configuration
const AGENTIC_TEST_USER = {
    uid: 'agentic-ai-test-user',
    email: 'agenticaitestuser@jc1.tech',
    displayName: 'Agentic AI Test User',
    // Use env var; avoid committing real passwords
    password: process.env.AGENTIC_TEST_USER_PASSWORD || 'CHANGEME',
    emailVerified: true,
    disabled: false
};

class AgenticAITestUserManager {
    constructor() {
        this.serviceAccountPath = './firebase-service-account.json';
        this.initFirebase();
    }

    initFirebase() {
        try {
            if (!fs.existsSync(this.serviceAccountPath)) {
                throw new Error(`Firebase service account key not found at: ${this.serviceAccountPath}`);
            }

            const serviceAccount = require(this.serviceAccountPath);
            
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: "https://bob20250810-default-rtdb.firebaseio.com/"
            });

            console.log('✅ Firebase Admin SDK initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
            process.exit(1);
        }
    }

    async createAgenticTestUser() {
        try {
            console.log('🤖 Creating Agentic AI Test User...');
            
            // Check if user already exists
            try {
                const existingUser = await admin.auth().getUser(AGENTIC_TEST_USER.uid);
                console.log('ℹ️  User already exists, updating...');
                return await this.updateExistingUser(existingUser);
            } catch (error) {
                if (error.code === 'auth/user-not-found') {
                    // User doesn't exist, create new one
                    return await this.createNewUser();
                } else {
                    throw error;
                }
            }
        } catch (error) {
            console.error('❌ Error managing Agentic AI test user:', error);
            throw error;
        }
    }

    async createNewUser() {
        try {
            const userRecord = await admin.auth().createUser({
                uid: AGENTIC_TEST_USER.uid,
                email: AGENTIC_TEST_USER.email,
                displayName: AGENTIC_TEST_USER.displayName,
                password: AGENTIC_TEST_USER.password,
                emailVerified: AGENTIC_TEST_USER.emailVerified,
                disabled: AGENTIC_TEST_USER.disabled,
                providerData: [{
                    uid: AGENTIC_TEST_USER.email,
                    email: AGENTIC_TEST_USER.email,
                    providerId: 'password',
                    displayName: AGENTIC_TEST_USER.displayName
                }]
            });

            console.log('✅ Agentic AI test user created successfully!');
            console.log(`📧 Email: ${userRecord.email}`);
            console.log(`🆔 UID: ${userRecord.uid}`);
            
            return userRecord;
        } catch (error) {
            console.error('❌ Error creating user:', error);
            throw error;
        }
    }

    async updateExistingUser(existingUser) {
        try {
            const updatedUser = await admin.auth().updateUser(AGENTIC_TEST_USER.uid, {
                email: AGENTIC_TEST_USER.email,
                displayName: AGENTIC_TEST_USER.displayName,
                password: AGENTIC_TEST_USER.password,
                emailVerified: AGENTIC_TEST_USER.emailVerified,
                disabled: AGENTIC_TEST_USER.disabled
            });

            console.log('✅ Agentic AI test user updated successfully!');
            console.log(`📧 Email: ${updatedUser.email}`);
            console.log(`🆔 UID: ${updatedUser.uid}`);
            
            return updatedUser;
        } catch (error) {
            console.error('❌ Error updating user:', error);
            throw error;
        }
    }

    async generateCustomToken() {
        try {
            const customToken = await admin.auth().createCustomToken(AGENTIC_TEST_USER.uid, {
                authProvider: 'email',
                testUser: true,
                agenticAI: true,
                createdAt: new Date().toISOString(),
                purpose: 'Agentic AI Testing'
            });

            const tokenFilePath = './agentic-ai-test-token.txt';
            fs.writeFileSync(tokenFilePath, customToken);
            
            console.log('🔑 Custom authentication token generated');
            console.log(`📁 Token saved to: ${tokenFilePath}`);
            
            return customToken;
        } catch (error) {
            console.error('❌ Error generating custom token:', error);
            throw error;
        }
    }

    async createTestCredentialsFile() {
        const credentials = {
            email: AGENTIC_TEST_USER.email,
            password: AGENTIC_TEST_USER.password,
            uid: AGENTIC_TEST_USER.uid,
            displayName: AGENTIC_TEST_USER.displayName,
            createdAt: new Date().toISOString(),
            purpose: 'Permanent Agentic AI Testing Account',
            
            loginInstructions: {
                method1_EmailPassword: {
                    url: 'https://bob20250810.web.app',
                    steps: [
                        '1. Navigate to https://bob20250810.web.app',
                        '2. Click "Sign in with Google" button',
                        '3. Use email: agenticaitestuser@jc1.tech',
                        '4. Use password: <set via AGENTIC_TEST_USER_PASSWORD>',
                        '5. Complete authentication'
                    ]
                },
                method2_SideDoor: {
                    url: 'https://bob20250810.web.app?test-login=TOKEN&test-mode=true',
                    steps: [
                        '1. Use the custom token from agentic-ai-test-token.txt',
                        '2. Replace TOKEN with the actual token value',
                        '3. Navigate to the complete URL',
                        '4. Authentication should be automatic'
                    ]
                }
            },
            
            testingCapabilities: [
                'Goals CRUD operations',
                'Tasks management',
                'Stories creation and editing',
                'Sprint planning',
                'Kanban board interactions',
                'Calendar integration',
                'UI workflow testing',
                'Email notification testing (via @jc1.tech domain)'
            ]
        };

        const credentialsPath = './AGENTIC_AI_TEST_CREDENTIALS.json';
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
        
        console.log('📋 Test credentials file created');
        console.log(`📁 Saved to: ${credentialsPath}`);
        
        return credentials;
    }

    async generateTestingInstructions() {
        const instructions = `# 🤖 Agentic AI Testing Instructions for BOB

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
1. Get the custom token from \`agentic-ai-test-token.txt\`
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
\`\`\`python
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
\`\`\`

### Playwright Example (JavaScript)
\`\`\`javascript
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
\`\`\`

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
*Generated: ${new Date().toISOString()}*
*BOB Version: v3.5.0*
*Test User: Permanent (Never Deleted)*
`;

        const instructionsPath = './AGENTIC_AI_TESTING_GUIDE.md';
        fs.writeFileSync(instructionsPath, instructions);
        
        console.log('📖 Testing instructions created');
        console.log(`📁 Saved to: ${instructionsPath}`);
        
        return instructionsPath;
    }
}

// Main execution
async function main() {
    console.log('🤖 ====== AGENTIC AI TEST USER SETUP ====== 🤖');
    console.log('📅 Started at:', new Date().toISOString());
    
    try {
        const manager = new AgenticAITestUserManager();
        
        // Create or update the test user
        const userRecord = await manager.createAgenticTestUser();
        
        // Generate authentication token
        const customToken = await manager.generateCustomToken();
        
        // Create credentials file
        const credentials = await manager.createTestCredentialsFile();
        
        // Generate testing instructions
        const instructionsPath = await manager.generateTestingInstructions();
        
        console.log('\n🎉 ====== SETUP COMPLETE ====== 🎉');
        console.log('✅ Agentic AI test user ready for testing');
        console.log('\n📋 CREDENTIALS:');
        console.log(`   Email: ${AGENTIC_TEST_USER.email}`);
        console.log(`   Password: ${AGENTIC_TEST_USER.password}`);
        console.log(`   UID: ${userRecord.uid}`);
        console.log('\n📁 FILES CREATED:');
        console.log('   • AGENTIC_AI_TEST_CREDENTIALS.json');
        console.log('   • agentic-ai-test-token.txt');
        console.log('   • AGENTIC_AI_TESTING_GUIDE.md');
        console.log('\n🌐 PRODUCTION URL: https://bob20250810.web.app');
        console.log('\n🔐 AUTHENTICATION METHODS:');
        console.log('   1. Email/Password (for manual testing)');
        console.log('   2. Side-door token (for automation)');
        console.log('\n📧 EMAIL DOMAIN: @jc1.tech (for notification testing)');
        console.log('\n⚠️  IMPORTANT: This user is PERMANENT and will NOT be deleted');
        
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        process.exit(1);
    }
}

// Run the setup
if (require.main === module) {
    main();
}

module.exports = { AgenticAITestUserManager, AGENTIC_TEST_USER };
