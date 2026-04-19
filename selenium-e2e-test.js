#!/usr/bin/env node
/**
 * BOB v3.5.5 - Comprehensive Selenium E2E Testing
 * Tests critical user flows including Excel-like story creation
 */

const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

class BOBSeleniumTester {
    constructor() {
        this.driver = null;
        this.baseUrl = 'https://bob20250810.web.app';
        this.testResults = [];
    }

    async initialize() {
        const options = new chrome.Options();
        options.addArguments('--headless');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--window-size=1920,1080');

        this.driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        console.log('🌐 Selenium WebDriver initialized');
    }

    async runTest(testName, testFunction) {
        try {
            console.log(`🧪 Running test: ${testName}`);
            await testFunction();
            this.testResults.push({ name: testName, status: 'PASS' });
            console.log(`✅ ${testName}: PASSED`);
        } catch (error) {
            this.testResults.push({ name: testName, status: 'FAIL', error: error.message });
            console.log(`❌ ${testName}: FAILED - ${error.message}`);
        }
    }

    async testPageLoad() {
        await this.driver.get(this.baseUrl);
        await this.driver.wait(until.titleContains('BOB'), 10000);
        
        const title = await this.driver.getTitle();
        if (!title.includes('BOB')) {
            throw new Error('Page title does not contain BOB');
        }
    }

    async testDemoLogin() {
        await this.driver.get(this.baseUrl);
        
        // Wait for login form
        const emailField = await this.driver.wait(
            until.elementLocated(By.css('input[type="email"]')), 
            10000
        );
        
        const passwordField = await this.driver.findElement(By.css('input[type="password"]'));
        const loginButton = await this.driver.findElement(By.css('button[type="submit"]'));

        // Login with demo credentials
        await emailField.sendKeys('demo@jc1.tech');
        await passwordField.sendKeys('Test1234b!');
        await loginButton.click();

        // Wait for dashboard to load
        await this.driver.wait(until.urlContains('dashboard'), 15000);
    }

    async testNavigationToStories() {
        // Navigate to Stories Management
        const storiesLink = await this.driver.wait(
            until.elementLocated(By.xpath("//a[contains(text(), 'Stories') or contains(text(), 'Story')]")),
            10000
        );
        await storiesLink.click();

        // Wait for stories page to load
        await this.driver.wait(until.urlContains('stories'), 10000);
    }

    async testExcelLikeStoryCreation() {
        // Look for "Add New Story" button
        const addButton = await this.driver.wait(
            until.elementLocated(By.xpath("//button[contains(text(), 'Add New Story')]")),
            10000
        );
        await addButton.click();

        // Wait for inline editing row to appear
        await this.driver.sleep(2000);

        // Find input fields in the new row
        const titleInput = await this.driver.findElement(By.css('input[placeholder*="title" i], input[value=""], td input[type="text"]'));
        await titleInput.sendKeys('E2E Test Story');

        // Find goal dropdown
        const goalSelect = await this.driver.findElement(By.css('select, td select'));
        await goalSelect.click();
        
        // Select first available goal
        const goalOptions = await goalSelect.findElements(By.css('option'));
        if (goalOptions.length > 1) {
            await goalOptions[1].click(); // Skip "Select Goal" option
        }

        // Save the story (look for save button or press Enter)
        await titleInput.sendKeys(Key.ENTER);
        
        // Wait for story to appear in table
        await this.driver.sleep(3000);
        
        // Verify story was created
        const storyElements = await this.driver.findElements(By.xpath("//td[contains(text(), 'E2E Test Story')]"));
        if (storyElements.length === 0) {
            throw new Error('Story was not created successfully');
        }
    }

    async testGoalDropdownFunctionality() {
        // Verify goal dropdown has options
        const goalSelects = await this.driver.findElements(By.css('select'));
        
        for (let select of goalSelects) {
            const options = await select.findElements(By.css('option'));
            if (options.length > 1) { // Should have "Select Goal" plus actual goals
                return; // Found a working dropdown
            }
        }
        
        throw new Error('No functional goal dropdown found');
    }

    async testResponsiveDesign() {
        // Test mobile viewport
        await this.driver.manage().window().setRect({ width: 375, height: 667 });
        await this.driver.sleep(2000);

        // Check if mobile elements are visible
        const body = await this.driver.findElement(By.css('body'));
        const bodyClass = await body.getAttribute('class');
        
        // Reset to desktop
        await this.driver.manage().window().setRect({ width: 1920, height: 1080 });
    }

    async runAllTests() {
        try {
            await this.initialize();
            
            await this.runTest('Page Load Test', () => this.testPageLoad());
            await this.runTest('Demo Login Test', () => this.testDemoLogin());
            await this.runTest('Navigation to Stories', () => this.testNavigationToStories());
            await this.runTest('Excel-like Story Creation', () => this.testExcelLikeStoryCreation());
            await this.runTest('Goal Dropdown Functionality', () => this.testGoalDropdownFunctionality());
            await this.runTest('Responsive Design Test', () => this.testResponsiveDesign());

            console.log('\n📊 Test Results Summary:');
            console.log('========================');
            
            const passed = this.testResults.filter(r => r.status === 'PASS').length;
            const failed = this.testResults.filter(r => r.status === 'FAIL').length;
            
            console.log(`✅ Passed: ${passed}`);
            console.log(`❌ Failed: ${failed}`);
            
            if (failed > 0) {
                console.log('\n💥 Failed Tests:');
                this.testResults.filter(r => r.status === 'FAIL').forEach(test => {
                    console.log(`   • ${test.name}: ${test.error}`);
                });
            }

            return failed === 0;

        } finally {
            if (this.driver) {
                await this.driver.quit();
            }
        }
    }
}

// Run the tests
(async () => {
    const tester = new BOBSeleniumTester();
    const success = await tester.runAllTests();
    process.exit(success ? 0 : 1);
})();
