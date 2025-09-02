#!/usr/bin/env node
/**
 * BOB v3.5.5 - Test User Creation Script
 * Creates test users for automated testing via Firebase Admin SDK
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBfCdXhMQy9Vqfoh3Ja2UHoMT1EDbD4cIY",
  authDomain: "bob20250810.firebaseapp.com",
  projectId: "bob20250810",
  storageBucket: "bob20250810.appspot.com",
  messagingSenderId: "251593945301",
  appId: "1:251593945301:web:a6bd67e6aa1dd36a42e3e5",
  measurementId: "G-PD0HHP3H1H"
};

class BOBTestUserCreator {
  constructor() {
    this.app = null;
    this.auth = null;
    this.firestore = null;
    
    // Test users to create
    this.testUsers = [
      {
        uid: 'ai-test-user-12345abcdef',
        email: 'ai-test-agent@bob.local',
        displayName: 'AI Test Agent',
        password: 'TestPassword123!',
        customClaims: {
          isTestUser: true,
          testRole: 'automation',
          createdBy: 'test-script'
        }
      },
      {
        uid: 'automation-test-67890ghijk',
        email: 'automation@bob.local',
        displayName: 'Test Automation User',
        password: 'AutomationPass456!',
        customClaims: {
          isTestUser: true,
          testRole: 'automation',
          createdBy: 'test-script'
        }
      },
      {
        uid: 'crud-test-98765fedcba',
        email: 'crud-test@bob.local',
        displayName: 'CRUD Test User',
        password: 'CrudTest789!',
        customClaims: {
          isTestUser: true,
          testRole: 'crud-testing',
          createdBy: 'test-script'
        }
      }
    ];
    
    this.createdUsers = [];
    this.errors = [];
  }

  async initialize() {
    try {
      // Check if service account key exists
      const serviceAccountPath = './serviceAccountKey.json';
      
      if (!fs.existsSync(serviceAccountPath)) {
        console.log('⚠️  Service account key not found. Using environment credentials.');
        
        // Initialize without service account (uses environment credentials)
        this.app = admin.initializeApp({
          projectId: firebaseConfig.projectId
        });
      } else {
        // Initialize with service account
        const serviceAccount = require(serviceAccountPath);
        this.app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: firebaseConfig.projectId
        });
      }
      
      this.auth = admin.auth(this.app);
      this.firestore = admin.firestore(this.app);
      
      console.log('✅ Firebase Admin SDK initialized');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
      this.errors.push(`Initialization error: ${error.message}`);
      return false;
    }
  }

  async createTestUser(userData) {
    try {
      console.log(`🔧 Creating test user: ${userData.email}`);
      
      // Check if user already exists
      try {
        const existingUser = await this.auth.getUser(userData.uid);
        console.log(`ℹ️  User ${userData.email} already exists, updating...`);
        
        // Update existing user with email/password provider
        const updatedUser = await this.auth.updateUser(userData.uid, {
          email: userData.email,
          displayName: userData.displayName,
          password: userData.password,
          emailVerified: true,
          // Ensure user can sign in with email/password (not OAuth)
          providerData: [{
            uid: userData.email,
            email: userData.email,
            providerId: 'password'
          }]
        });
        
        // Set custom claims
        await this.auth.setCustomUserClaims(userData.uid, userData.customClaims);
        
        console.log(`✅ Updated existing user: ${userData.email} (Email/Password provider)`);
        return updatedUser;
        
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          // Create new user with email/password provider
          const newUser = await this.auth.createUser({
            uid: userData.uid,
            email: userData.email,
            displayName: userData.displayName,
            password: userData.password,
            emailVerified: true,
            // Explicitly set email/password provider (not OAuth)
            providerData: [{
              uid: userData.email,
              email: userData.email,
              providerId: 'password'
            }]
          });
          
          // Set custom claims
          await this.auth.setCustomUserClaims(userData.uid, userData.customClaims);
          
          console.log(`✅ Created new user: ${userData.email} (Email/Password provider)`);
          return newUser;
        } else {
          throw error;
        }
      }
      
    } catch (error) {
      console.error(`❌ Failed to create user ${userData.email}:`, error.message);
      this.errors.push(`User creation error for ${userData.email}: ${error.message}`);
      return null;
    }
  }

  async createTestUserProfile(userData, userRecord) {
    try {
      console.log(`📝 Creating Firestore profile for: ${userData.email}`);
      
      const userProfile = {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName || userData.displayName,
        isTestUser: true,
        testRole: userData.customClaims.testRole,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        preferences: {
          defaultPersona: 'personal',
          theme: 'light',
          notifications: false,
          authProvider: 'email' // Explicitly set email provider preference
        },
        testMetadata: {
          createdBy: 'test-script',
          purpose: 'automated-testing',
          version: 'v3.5.5',
          authType: 'email-password' // Track that this uses email/password auth
        },
        // Firebase Auth provider configuration
        authProviders: ['password'], // Only email/password, no OAuth
        loginMethod: 'email-password'
      };
      
      await this.firestore.collection('users').doc(userRecord.uid).set(userProfile, { merge: true });
      
      console.log(`✅ Created Firestore profile for: ${userData.email}`);
      return true;
      
    } catch (error) {
      console.error(`❌ Failed to create profile for ${userData.email}:`, error.message);
      this.errors.push(`Profile creation error for ${userData.email}: ${error.message}`);
      return false;
    }
  }

  async createTestGoalsForUser(userRecord) {
    try {
      console.log(`🎯 Creating test goals for: ${userRecord.email}`);
      
      const testGoals = [
        {
          title: `Test Goal 1 - ${userRecord.displayName}`,
          description: 'Sample goal for testing CRUD operations',
          theme: 'Growth',
          size: 'M',
          timeToMasterHours: 40,
          targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          confidence: 8,
          status: 'Not Started',
          persona: 'personal',
          ownerUid: userRecord.uid,
          isTestData: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        {
          title: `Test Goal 2 - ${userRecord.displayName}`,
          description: 'Another sample goal for testing updates and deletion',
          theme: 'Health',
          size: 'L',
          timeToMasterHours: 80,
          targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
          confidence: 7,
          status: 'In Progress',
          persona: 'personal',
          ownerUid: userRecord.uid,
          isTestData: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      ];
      
      for (const goal of testGoals) {
        await this.firestore.collection('goals').add(goal);
      }
      
      console.log(`✅ Created ${testGoals.length} test goals for: ${userRecord.email}`);
      return true;
      
    } catch (error) {
      console.error(`❌ Failed to create test goals for ${userRecord.email}:`, error.message);
      this.errors.push(`Test goals creation error for ${userRecord.email}: ${error.message}`);
      return false;
    }
  }

  async generateTestLoginTokens() {
    try {
      console.log('🔑 Generating test login tokens...');
      
      const tokens = {};
      
      for (const user of this.createdUsers) {
        try {
          // Create custom token for side-door authentication
          const customToken = await this.auth.createCustomToken(user.uid, {
            isTestUser: true,
            testMode: true,
            createdAt: Date.now()
          });
          
          tokens[user.uid] = {
            email: user.email,
            displayName: user.displayName,
            customToken: customToken,
            testUrl: `https://bob20250810.web.app?test-login=${user.uid}&test-mode=true`,
            uid: user.uid
          };
          
        } catch (error) {
          console.error(`❌ Failed to create token for ${user.email}:`, error.message);
        }
      }
      
      // Save tokens to file
      const tokensFile = './test-users-tokens.json';
      fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2));
      
      console.log(`✅ Generated tokens saved to: ${tokensFile}`);
      return tokens;
      
    } catch (error) {
      console.error('❌ Failed to generate test tokens:', error.message);
      this.errors.push(`Token generation error: ${error.message}`);
      return {};
    }
  }

  async createAllTestUsers() {
    console.log('🚀 Starting test user creation...');
    
    for (const userData of this.testUsers) {
      try {
        // Create user in Firebase Auth
        const userRecord = await this.createTestUser(userData);
        
        if (userRecord) {
          this.createdUsers.push(userRecord);
          
          // Create user profile in Firestore
          await this.createTestUserProfile(userData, userRecord);
          
          // Create test goals for the user
          await this.createTestGoalsForUser(userRecord);
        }
        
      } catch (error) {
        console.error(`❌ Error processing user ${userData.email}:`, error.message);
        this.errors.push(`Processing error for ${userData.email}: ${error.message}`);
      }
    }
  }

  async listExistingTestUsers() {
    try {
      console.log('📋 Listing existing test users...');
      
      const listUsersResult = await this.auth.listUsers();
      const testUsers = listUsersResult.users.filter(user => 
        user.email && user.email.includes('@bob.local')
      );
      
      console.log(`Found ${testUsers.length} existing test users:`);
      testUsers.forEach(user => {
        console.log(`  - ${user.email} (${user.uid})`);
      });
      
      return testUsers;
      
    } catch (error) {
      console.error('❌ Failed to list users:', error.message);
      return [];
    }
  }

  async cleanupTestUsers() {
    try {
      console.log('🧹 Cleaning up test users...');
      
      const listUsersResult = await this.auth.listUsers();
      const testUsers = listUsersResult.users.filter(user => 
        user.email && user.email.includes('@bob.local')
      );
      
      for (const user of testUsers) {
        try {
          // Delete from Auth
          await this.auth.deleteUser(user.uid);
          
          // Delete from Firestore
          await this.firestore.collection('users').doc(user.uid).delete();
          
          // Delete test goals
          const goalsQuery = await this.firestore.collection('goals')
            .where('ownerUid', '==', user.uid)
            .where('isTestData', '==', true)
            .get();
          
          const batch = this.firestore.batch();
          goalsQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();
          
          console.log(`✅ Cleaned up user: ${user.email}`);
          
        } catch (error) {
          console.error(`❌ Failed to cleanup user ${user.email}:`, error.message);
        }
      }
      
      console.log('✅ Cleanup completed');
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
    }
  }

  generateReport() {
    const timestamp = new Date().toISOString();
    const report = {
      timestamp,
      created_users: this.createdUsers.length,
      total_users: this.testUsers.length,
      errors: this.errors,
      users: this.createdUsers.map(user => ({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
      }))
    };
    
    const reportFile = `test-users-report-${Date.now()}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    console.log('\n📊 Test User Creation Report:');
    console.log(`✅ Created: ${this.createdUsers.length}/${this.testUsers.length} users`);
    console.log(`❌ Errors: ${this.errors.length}`);
    console.log(`📄 Report saved: ${reportFile}`);
    
    if (this.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      this.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    return report;
  }

  async run(command = 'create') {
    try {
      const initialized = await this.initialize();
      if (!initialized) {
        return false;
      }
      
      switch (command) {
        case 'create':
          await this.createAllTestUsers();
          await this.generateTestLoginTokens();
          break;
          
        case 'list':
          await this.listExistingTestUsers();
          break;
          
        case 'cleanup':
          await this.cleanupTestUsers();
          break;
          
        default:
          console.log('❌ Unknown command. Use: create, list, or cleanup');
          return false;
      }
      
      this.generateReport();
      return true;
      
    } catch (error) {
      console.error('❌ Script execution failed:', error.message);
      return false;
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'create';
  
  console.log('🧪 BOB Test User Creation Script v3.5.5');
  console.log(`🎯 Command: ${command}`);
  
  const creator = new BOBTestUserCreator();
  const success = await creator.run(command);
  
  process.exit(success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = BOBTestUserCreator;
