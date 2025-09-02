// Test mode configuration and security
export interface TestModeConfig {
  isTestMode: boolean;
  testEnvironment: 'development' | 'staging' | 'production';
  allowTestUserCreation: boolean;
  testModeSecret?: string;
}

export class TestModeValidator {
  private static instance: TestModeValidator;
  private config: TestModeConfig;

  private constructor() {
    this.config = this.initializeConfig();
  }

  public static getInstance(): TestModeValidator {
    if (!TestModeValidator.instance) {
      TestModeValidator.instance = new TestModeValidator();
    }
    return TestModeValidator.instance;
  }

  private initializeConfig(): TestModeConfig {
    // Only allow test mode in specific conditions
    const isLocalDevelopment = window.location.hostname === 'localhost' || 
                               window.location.hostname === '127.0.0.1';
    
    const isDevelopmentBuild = process.env.NODE_ENV === 'development';
    
    // Check for explicit test mode flag from URL parameters (for CI/CD)
    const urlParams = new URLSearchParams(window.location.search);
    const testModeFlag = urlParams.get('testMode');
    const testSecret = urlParams.get('testSecret');
    
    // Expected secret for test mode (should match deployment script)
    const expectedSecret = process.env.REACT_APP_TEST_SECRET || 'test-secret-2025';
    
    // Only allow test mode if:
    // 1. Local development OR
    // 2. Explicit test flag with correct secret
    const isValidTestMode = isLocalDevelopment || 
                           (testModeFlag === 'true' && testSecret === expectedSecret);

    return {
      isTestMode: isValidTestMode && isDevelopmentBuild,
      testEnvironment: this.getEnvironment(),
      allowTestUserCreation: false, // Never allow frontend creation
      testModeSecret: testSecret
    };
  }

  private getEnvironment(): 'development' | 'staging' | 'production' {
    const hostname = window.location.hostname;
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'development';
    } else if (hostname.includes('staging') || hostname.includes('test')) {
      return 'staging';
    } else {
      return 'production';
    }
  }

  public isTestModeEnabled(): boolean {
    return this.config.isTestMode;
  }

  public canCreateTestUsers(): boolean {
    // Never allow frontend test user creation
    return false;
  }

  public getTestEnvironment(): string {
    return this.config.testEnvironment;
  }

  public shouldShowTestUI(): boolean {
    // Only show test UI in development or with valid test mode
    return this.config.isTestMode && this.config.testEnvironment !== 'production';
  }

  public validateTestAccess(action: string): { allowed: boolean; reason?: string } {
    if (!this.config.isTestMode) {
      return {
        allowed: false,
        reason: 'Test mode is not enabled'
      };
    }

    if (this.config.testEnvironment === 'production') {
      return {
        allowed: false,
        reason: 'Test operations not allowed in production'
      };
    }

    if (action === 'create_user') {
      return {
        allowed: false,
        reason: 'Test user creation must be done via backend scripts only'
      };
    }

    return { allowed: true };
  }
}

export const testModeValidator = TestModeValidator.getInstance();
