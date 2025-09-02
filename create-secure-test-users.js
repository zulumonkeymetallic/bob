#!/usr/bin/env node

/**
 * Secure Test User Creation Script
 * 
 * This script creates test users securely using Firebase Admin SDK
 * Following Firebase Admin SDK setup guidelines: https://firebase.google.com/docs/admin/setup
 * Only to be used in controlled testing environments
 * 
 * Usage:
 *   node create-secure-test-users.js --env=development --secret=your-secret
 *   
 * Firebase Authentication Options:
 *   1. Service Account Key File:
 *      GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
 *      
 *   2. Service Account Environment Variables:
 *      FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *      FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxxx@project.iam.gserviceaccount.com"
 *      
 *   3. Default Application Credentials (Google Cloud environments)
 *   
 * Required Environment Variables:
 *   - FIREBASE_PROJECT_ID (default: bob20250810)
 *   - TEST_SECRET (for development) or STAGING_TEST_SECRET (for staging)
 *   
 * See FIREBASE_ADMIN_SETUP.md for detailed setup instructions
 */

const admin = require('firebase-admin');
const { Command } = require('commander');
const crypto = require('crypto');

class SecureTestUserCreator {
  constructor() {
    this.program = new Command();
    this.setupCLI();
    this.requiredSecrets = {
      development: process.env.TEST_SECRET || 'test-secret-2025',
      staging: process.env.STAGING_TEST_SECRET || 'staging-test-secret-2025'
    };
  }

  setupCLI() {
    this.program
      .name('create-secure-test-users')
      .description('Securely create test users for BOB application testing')
      .option('-e, --env <environment>', 'Environment (development, staging)', 'development')
      .option('-s, --secret <secret>', 'Security secret for validation')
      .option('-u, --users <users>', 'Comma-separated list of user emails to create')
      .option('--dry-run', 'Show what would be created without actually creating')
      .option('--list-existing', 'List existing test users')
      .parse();
  }

  validateEnvironment(env, secret) {
    // Security checks
    if (!['development', 'staging'].includes(env)) {
      throw new Error('Invalid environment. Only development and staging are allowed.');
    }

    if (env === 'staging' && process.env.NODE_ENV === 'production') {
      throw new Error('Cannot create test users in production environment');
    }

    const expectedSecret = this.requiredSecrets[env];
    if (secret !== expectedSecret) {
      throw new Error('Invalid security secret provided');
    }

    // Check Firebase credentials
    const hasServiceAccountFile = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const hasServiceAccountEnvVars = !!(process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL);
    
    if (!hasServiceAccountFile && !hasServiceAccountEnvVars && !admin.apps.length) {
      throw new Error(
        'Firebase credentials not found. Please set either:\n' +
        '1. GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)\n' +
        '2. FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL (service account details)'
      );
    }

    console.log(`✅ Environment validation passed for: ${env}`);
  }

  initializeFirebase() {
    if (!admin.apps.length) {
      // Option 1: Service Account Key File (via GOOGLE_APPLICATION_CREDENTIALS)
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({
          projectId: process.env.FIREBASE_PROJECT_ID || 'bob20250810'
        });
        console.log('✅ Firebase Admin SDK initialized with service account file');
      }
      // Option 2: Service Account via Environment Variables
      else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        const serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID || 'bob20250810',
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.FIREBASE_CLIENT_EMAIL
        };
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID || 'bob20250810'
        });
        console.log('✅ Firebase Admin SDK initialized with environment variables');
      }
      // Option 3: Default Application Credentials (for Google Cloud environments)
      else {
        try {
          admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID || 'bob20250810'
          });
          console.log('✅ Firebase Admin SDK initialized with default credentials');
        } catch (error) {
          throw new Error(
            'Firebase credentials not found. Please set either:\n' +
            '1. GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)\n' +
            '2. FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL (service account details)\n' +
            '3. Or run in a Google Cloud environment with default credentials'
          );
        }
      }
    }
  }

  getTestUsers() {
    return [
      {
        uid: 'test-user-jc1-tech',
        email: 'testuser@jc1.tech',
        password: 'test123456',
        displayName: 'JC1 Test User',
        emailVerified: true,
        customClaims: {
          testUser: true,
          environment: 'testing',
          createdBy: 'secure-script',
          createdAt: new Date().toISOString()
        }
      },
      {
        uid: 'test-user-demo',
        email: 'demo@bob.local',
        password: 'test123456',
        displayName: 'Demo Test User',
        emailVerified: true,
        customClaims: {
          testUser: true,
          environment: 'testing',
          createdBy: 'secure-script',
          createdAt: new Date().toISOString()
        }
      },
      {
        uid: 'test-user-admin',
        email: 'admin@bob.local',
        password: 'test123456',
        displayName: 'Admin Test User',
        emailVerified: true,
        customClaims: {
          testUser: true,
          environment: 'testing',
          role: 'admin',
          createdBy: 'secure-script',
          createdAt: new Date().toISOString()
        }
      }
    ];
  }

  async listExistingTestUsers() {
    console.log('📋 Listing existing test users...');
    
    try {
      // List users with pagination
      const listUsersResult = await admin.auth().listUsers(1000);
      const testUsers = listUsersResult.users.filter(user => {
        return user.email && (
          user.email.includes('@bob.local') ||
          user.email.includes('test') ||
          user.customClaims?.testUser === true
        );
      });

      if (testUsers.length === 0) {
        console.log('❌ No test users found');
        return;
      }

      console.log(`✅ Found ${testUsers.length} test users:`);
      testUsers.forEach(user => {
        console.log(`  - ${user.email} (${user.uid}) - Created: ${user.metadata.creationTime}`);
      });

    } catch (error) {
      console.error('❌ Error listing users:', error.message);
    }
  }

  async createTestUser(userData, dryRun = false) {
    const { uid, email, password, displayName, emailVerified, customClaims } = userData;

    if (dryRun) {
      console.log(`🔍 [DRY RUN] Would create user: ${email} (${uid})`);
      return { success: true, action: 'dry-run' };
    }

    try {
      // Check if user already exists
      let userExists = false;
      try {
        await admin.auth().getUser(uid);
        userExists = true;
      } catch (error) {
        if (error.code !== 'auth/user-not-found') {
          throw error;
        }
      }

      if (userExists) {
        console.log(`⚠️  User ${email} already exists, skipping...`);
        return { success: true, action: 'skipped' };
      }

      // Create the user
      const userRecord = await admin.auth().createUser({
        uid,
        email,
        password,
        displayName,
        emailVerified
      });

      // Set custom claims
      await admin.auth().setCustomUserClaims(uid, customClaims);

      console.log(`✅ Created test user: ${email} (${uid})`);
      return { success: true, action: 'created', uid: userRecord.uid };

    } catch (error) {
      console.error(`❌ Error creating user ${email}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async createAllTestUsers(userEmails = null, dryRun = false) {
    const testUsers = this.getTestUsers();
    
    // Filter users if specific emails provided
    const usersToCreate = userEmails 
      ? testUsers.filter(user => userEmails.includes(user.email))
      : testUsers;

    if (usersToCreate.length === 0) {
      console.log('❌ No users to create');
      return;
    }

    console.log(`🚀 ${dryRun ? '[DRY RUN] ' : ''}Creating ${usersToCreate.length} test users...`);

    const results = {
      created: 0,
      skipped: 0,
      failed: 0
    };

    for (const userData of usersToCreate) {
      const result = await this.createTestUser(userData, dryRun);
      
      if (result.success) {
        if (result.action === 'created') results.created++;
        else if (result.action === 'skipped') results.skipped++;
      } else {
        results.failed++;
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Created: ${results.created}`);
    console.log(`   ⚠️  Skipped: ${results.skipped}`);
    console.log(`   ❌ Failed: ${results.failed}`);

    if (!dryRun && results.created > 0) {
      console.log('\n🔑 Test user credentials:');
      usersToCreate.forEach(user => {
        console.log(`   ${user.email} / ${user.password}`);
      });
    }
  }

  async run() {
    const options = this.program.opts();
    
    try {
      console.log('🔐 BOB Secure Test User Creator v1.0');
      console.log('=====================================\n');

      // Validate environment and security
      this.validateEnvironment(options.env, options.secret);

      // Initialize Firebase
      this.initializeFirebase();

      // Handle different operations
      if (options.listExisting) {
        await this.listExistingTestUsers();
        return;
      }

      // Parse user emails if provided
      const userEmails = options.users 
        ? options.users.split(',').map(email => email.trim())
        : null;

      // Create test users
      await this.createAllTestUsers(userEmails, options.dryRun);

      console.log('\n✨ Operation completed successfully!');

    } catch (error) {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    }
  }
}

// Run the script
if (require.main === module) {
  const creator = new SecureTestUserCreator();
  creator.run().catch(console.error);
}

module.exports = SecureTestUserCreator;
