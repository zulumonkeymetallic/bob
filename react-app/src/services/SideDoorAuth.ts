// BOB v3.5.5 - Enhanced Test Authentication Service
export interface TestUser {
  email: string;
  displayName: string;
  photoURL?: string;
  uid?: string;
  isTestUser: boolean;
  persona: 'personal';
}

class SideDoorAuthService {
  isTestModeEnabled(): boolean {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('test_login') === 'true' || 
           urlParams.get('test-mode') === 'true' ||
           urlParams.has('test-login');
  }

  getAvailableTestUsers(): TestUser[] {
    return [];
  }

  isCurrentUserTestUser(): boolean {
    return false;
  }

  async signInAnonymously(): Promise<any> {
    throw new Error('Not implemented');
  }

  async signInWithTestUser(): Promise<any> {
    throw new Error('Not implemented');
  }

  async autoSignIn(): Promise<any> {
    return null;
  }
}

export const sideDoorAuth = new SideDoorAuthService();
export default sideDoorAuth;
