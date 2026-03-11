// BOB - Local/test authentication helper used for localhost development.
// This intentionally does not run in production unless explicitly enabled by env.
export interface TestUser {
  email: string;
  displayName: string;
  photoURL?: string;
  uid: string;
  isTestUser: boolean;
  persona: 'personal';
}

const TEST_MODE_STORAGE_KEY = 'bobTestMode';
const TEST_USER_STORAGE_KEY = 'bobLocalTestUser';

const DEFAULT_TEST_USER: TestUser = {
  uid: 'ai-test-user-12345abcdef',
  email: 'ai-test-agent@bob.local',
  displayName: 'AI Test Agent',
  isTestUser: true,
  persona: 'personal',
};

function canUseWindow(): boolean {
  return typeof window !== 'undefined';
}

function sanitizeUid(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return normalized.slice(0, 60) || 'local-user';
}

function isTruthyFlag(value: string | null | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

class SideDoorAuthService {
  isLocalEnvironment(): boolean {
    if (!canUseWindow()) return false;
    const host = window.location.hostname.toLowerCase();
    const envEnabled = process.env.REACT_APP_ENABLE_LOCAL_LOGIN === 'true';
    return envEnabled || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  private getParams(): URLSearchParams {
    if (!canUseWindow()) return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }

  isTestModeEnabled(): boolean {
    if (!canUseWindow()) return false;
    const params = this.getParams();
    const viaUrl =
      isTruthyFlag(params.get('test_login')) ||
      isTruthyFlag(params.get('test-mode')) ||
      isTruthyFlag(params.get('local-login')) ||
      params.has('test-login');

    const viaStorage = localStorage.getItem(TEST_MODE_STORAGE_KEY) === 'true';
    return viaUrl || viaStorage;
  }

  private toMockUser(testUser: TestUser): any {
    const now = new Date().toISOString();
    return {
      uid: testUser.uid,
      email: testUser.email,
      displayName: testUser.displayName,
      photoURL: testUser.photoURL || null,
      emailVerified: true,
      isAnonymous: false,
      isTestUser: true,
      metadata: {
        creationTime: now,
        lastSignInTime: now,
      },
      providerData: [
        {
          uid: testUser.uid,
          email: testUser.email,
          displayName: testUser.displayName,
          providerId: 'local-test',
        },
      ],
      getIdToken: async () => 'local-test-id-token',
      getIdTokenResult: async () => ({ token: 'local-test-id-token' }),
      reload: async () => {},
    };
  }

  private persistTestUser(testUser: TestUser): void {
    if (!canUseWindow()) return;
    localStorage.setItem(TEST_MODE_STORAGE_KEY, 'true');
    localStorage.setItem(TEST_USER_STORAGE_KEY, JSON.stringify(testUser));
  }

  private cleanAuthParamsFromUrl(params: URLSearchParams): void {
    if (!canUseWindow()) return;
    const cleanedParams = new URLSearchParams(params.toString());
    ['test-login', 'test_login', 'test-mode', 'local-login', 'local-token', 'local-email', 'local-name', 'local-uid']
      .forEach((key) => cleanedParams.delete(key));

    const cleanQuery = cleanedParams.toString();
    const cleanUrl = cleanQuery
      ? `${window.location.pathname}?${cleanQuery}${window.location.hash || ''}`
      : `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  getPersistedTestUser(): TestUser | null {
    if (!canUseWindow()) return null;
    const raw = localStorage.getItem(TEST_USER_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as TestUser;
      if (!parsed?.uid || !parsed?.email) return null;
      return {
        uid: parsed.uid,
        email: parsed.email,
        displayName: parsed.displayName || 'Local Test User',
        photoURL: parsed.photoURL,
        isTestUser: true,
        persona: 'personal',
      };
    } catch {
      return null;
    }
  }

  initializeFromUrl(): TestUser | null {
    if (!this.isLocalEnvironment() || !canUseWindow()) return null;
    const params = this.getParams();

    const explicitLocalLogin = isTruthyFlag(params.get('local-login'));
    const explicitTestMode = isTruthyFlag(params.get('test-mode'));
    const token = params.get('test-login') || params.get('local-token');
    const localEmail = params.get('local-email');
    const localName = params.get('local-name');
    const localUid = params.get('local-uid');

    if (!explicitLocalLogin && !explicitTestMode && !token && !localEmail && !localUid) {
      return null;
    }

    const testUser = this.resolveTestUser({
      token,
      uid: localUid,
      email: localEmail,
      displayName: localName,
    });

    this.persistTestUser(testUser);
    this.cleanAuthParamsFromUrl(params);
    return testUser;
  }

  private resolveTestUser(args: {
    token?: string | null;
    uid?: string | null;
    email?: string | null;
    displayName?: string | null;
  }): TestUser {
    const token = (args.token || '').trim().toLowerCase();
    const tokenUsers: Record<string, TestUser> = {
      demo: {
        uid: 'demo-user-jc1-tech',
        email: 'demo@jc1.tech',
        displayName: 'Demo User',
        isTestUser: true,
        persona: 'personal',
      },
      'ai-agent-token': DEFAULT_TEST_USER,
      'ai-agent': DEFAULT_TEST_USER,
      anonymous: {
        uid: 'local-anon-user',
        email: 'local-anon@bob.local',
        displayName: 'Local Anonymous',
        isTestUser: true,
        persona: 'personal',
      },
    };

    if (token && tokenUsers[token]) {
      return tokenUsers[token];
    }

    const email = (args.email || '').trim();
    if (email.includes('@')) {
      const uidFromEmail = sanitizeUid(email.replace('@', '_at_'));
      return {
        uid: args.uid ? sanitizeUid(args.uid) : uidFromEmail,
        email,
        displayName: args.displayName || email.split('@')[0] || 'Local Test User',
        isTestUser: true,
        persona: 'personal',
      };
    }

    if (args.uid) {
      const uid = sanitizeUid(args.uid);
      return {
        uid,
        email: `${uid}@bob.local`,
        displayName: args.displayName || 'Local Test User',
        isTestUser: true,
        persona: 'personal',
      };
    }

    if (token) {
      const uid = sanitizeUid(token);
      return {
        uid,
        email: `${uid}@bob.local`,
        displayName: args.displayName || 'Local Test User',
        isTestUser: true,
        persona: 'personal',
      };
    }

    return DEFAULT_TEST_USER;
  }

  getAvailableTestUsers(): TestUser[] {
    return [
      DEFAULT_TEST_USER,
      {
        uid: 'demo-user-jc1-tech',
        email: 'demo@jc1.tech',
        displayName: 'Demo User',
        isTestUser: true,
        persona: 'personal',
      },
    ];
  }

  isCurrentUserTestUser(user?: { uid?: string; email?: string; isTestUser?: boolean }): boolean {
    if (!user) return false;
    if (user.isTestUser) return true;
    if (!user.uid && !user.email) return false;
    return (
      (user.uid || '').startsWith('ai-test-') ||
      (user.email || '').endsWith('@bob.local') ||
      this.getPersistedTestUser()?.uid === user.uid
    );
  }

  mockAuthState(testUser?: TestUser): any {
    return this.toMockUser(testUser || DEFAULT_TEST_USER);
  }

  disableTestMode(): void {
    if (!canUseWindow()) return;
    localStorage.removeItem(TEST_MODE_STORAGE_KEY);
    localStorage.removeItem(TEST_USER_STORAGE_KEY);
  }

  async signInAnonymously(): Promise<any> {
    const anonUser = this.resolveTestUser({ token: 'anonymous' });
    this.persistTestUser(anonUser);
    return this.toMockUser(anonUser);
  }

  async signInWithTestUser(tokenOrEmail?: string): Promise<any> {
    if (!this.isLocalEnvironment()) {
      throw new Error('Local login is only enabled on localhost or when REACT_APP_ENABLE_LOCAL_LOGIN=true');
    }
    const candidate = (tokenOrEmail || '').trim();
    const testUser = candidate.includes('@')
      ? this.resolveTestUser({ email: candidate })
      : this.resolveTestUser({ token: candidate || 'ai-agent-token' });

    this.persistTestUser(testUser);
    return this.toMockUser(testUser);
  }

  autoSignIn(): any {
    if (!this.isLocalEnvironment()) return null;
    const fromUrl = this.initializeFromUrl();
    if (fromUrl) return this.toMockUser(fromUrl);
    const persisted = this.getPersistedTestUser();
    if (!persisted) return null;
    return this.toMockUser(persisted);
  }
}

export const sideDoorAuth = new SideDoorAuthService();
export default sideDoorAuth;
