#!/usr/bin/env node
/**
 * BOB v3.5.5 - Demo User Creation Script
 * Creates demo@jc1.tech user for demonstration purposes
 * 
 * Usage: node create-demo-user-standalone.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
try {
  admin.initializeApp({
    projectId: 'bob20250810'
  });
  console.log('🔥 Firebase Admin initialized');
} catch (error) {
  console.log('⚠️  Firebase Admin already initialized or error:', error.message);
}

const auth = admin.auth();
const firestore = admin.firestore();

async function createDemoUser() {
  const demoUser = {
    uid: 'demo-user-jc1-tech',
    email: 'demo@jc1.tech',
    displayName: 'Demo User',
    // Use environment variable for demo password; default to placeholder
    password: process.env.DEMO_USER_PASSWORD || 'CHANGEME',
    emailVerified: true
  };

  try {
    console.log('🎭 Creating demo user:', demoUser.email);
    
    // Check if user already exists
    try {
      const existingUser = await auth.getUser(demoUser.uid);
      console.log('✅ Demo user already exists:', existingUser.email);
      
      // Update password if needed
      await auth.updateUser(demoUser.uid, {
        password: demoUser.password,
        emailVerified: true
      });
      console.log('🔄 Updated demo user password');
      
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Create new user
        const userRecord = await auth.createUser({
          uid: demoUser.uid,
          email: demoUser.email,
          displayName: demoUser.displayName,
          password: demoUser.password,
          emailVerified: true
        });
        console.log('✅ Demo user created:', userRecord.email);
      } else {
        throw error;
      }
    }

    // Create user profile in Firestore
    const userProfile = {
      email: demoUser.email,
      displayName: demoUser.displayName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isDemo: true,
      personas: ['demo-persona'],
      preferences: {
        theme: 'light',
        viewMode: 'card'
      }
    };

    await firestore.collection('users').doc(demoUser.uid).set(userProfile, { merge: true });
    console.log('✅ Demo user profile created in Firestore');

    // Create demo goals
    const demoGoals = [
      {
        id: 'demo-goal-1',
        title: 'Complete Product Demo',
        description: 'Showcase all key features of BOB productivity platform',
        status: 'in-progress',
        priority: 'high',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      },
      {
        id: 'demo-goal-2',
        title: 'User Onboarding Workflow',
        description: 'Create smooth onboarding experience for new users',
        status: 'planned',
        priority: 'medium',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      },
      {
        id: 'demo-goal-3',
        title: 'Excel-like Story Management',
        description: 'Demonstrate inline story creation with Excel-like interface',
        status: 'done',
        priority: 'high',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona']
      }
    ];

    for (const goal of demoGoals) {
      await firestore.collection('goals').doc(goal.id).set(goal, { merge: true });
      console.log('✅ Demo goal created:', goal.title);
    }

    // Create demo stories
    const demoStories = [
      {
        id: 'demo-story-1',
        title: 'User can login with demo credentials',
        description: 'As a demo user, I want to login easily to explore the platform',
        status: 'done',
        priority: 'high',
        goalId: 'demo-goal-1',
        goalTitle: 'Complete Product Demo',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona'],
        ref: 'DEMO-001'
      },
      {
        id: 'demo-story-2',
        title: 'User can create and manage goals',
        description: 'As a user, I want to create and organize my goals effectively',
        status: 'in-progress',
        priority: 'high',
        goalId: 'demo-goal-1',
        goalTitle: 'Complete Product Demo',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona'],
        ref: 'DEMO-002'
      },
      {
        id: 'demo-story-3',
        title: 'User can add stories inline like Excel',
        description: 'As a user, I want to add stories quickly with Excel-like interface',
        status: 'done',
        priority: 'medium',
        goalId: 'demo-goal-3',
        goalTitle: 'Excel-like Story Management',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona'],
        ref: 'DEMO-003'
      },
      {
        id: 'demo-story-4',
        title: 'User can select goals from dropdown',
        description: 'As a user, I want to select goals from a dropdown when creating stories',
        status: 'done',
        priority: 'high',
        goalId: 'demo-goal-3',
        goalTitle: 'Excel-like Story Management',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona'],
        ref: 'DEMO-004'
      },
      {
        id: 'demo-story-5',
        title: 'User can view real-time updates',
        description: 'As a user, I want to see stories update in real-time after creation',
        status: 'done',
        priority: 'medium',
        goalId: 'demo-goal-2',
        goalTitle: 'User Onboarding Workflow',
        createdBy: demoUser.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        personas: ['demo-persona'],
        ref: 'DEMO-005'
      }
    ];

    for (const story of demoStories) {
      await firestore.collection('stories').doc(story.id).set(story, { merge: true });
      console.log('✅ Demo story created:', story.title);
    }

    // Create a demo sprint
    const demoSprint = {
      id: 'demo-sprint-1',
      name: 'Demo Sprint - Excel Features',
      description: 'Demonstrate Excel-like functionality and goal management',
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 weeks from now
      createdBy: demoUser.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      personas: ['demo-persona'],
      stories: ['demo-story-3', 'demo-story-4']
    };

    await firestore.collection('sprints').doc(demoSprint.id).set(demoSprint, { merge: true });
    console.log('✅ Demo sprint created:', demoSprint.name);

    console.log('\n🎉 Demo user setup completed successfully!');
    console.log('=====================================');
    console.log('📧 Email: demo@jc1.tech');
    console.log('🔐 Password: Test1234b!');
    console.log('🌐 Login at: https://bob20250810.web.app');
    console.log('\n📊 Demo Data Created:');
    console.log(`   • ${demoGoals.length} Goals`);
    console.log(`   • ${demoStories.length} Stories`);
    console.log(`   • 1 Sprint`);
    console.log('\n🎯 Features to Demo:');
    console.log('   • Excel-like inline story creation');
    console.log('   • Goal dropdown selection');
    console.log('   • Real-time story updates');
    console.log('   • Context-aware goal linking');

  } catch (error) {
    console.error('❌ Error creating demo user:', error);
    process.exit(1);
  }
}

// Check if Firebase Admin SDK is properly configured
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_CONFIG) {
  console.log('⚠️  Warning: No Firebase credentials found in environment variables.');
  console.log('   Make sure Firebase Admin SDK is properly configured.');
  console.log('   This script will try to use default credentials.');
}

// Run the demo user creation
console.log('🚀 Starting demo user creation...\n');

createDemoUser()
  .then(() => {
    console.log('\n✅ Demo user creation completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Demo user creation failed:', error);
    process.exit(1);
  });
