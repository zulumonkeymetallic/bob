// Create test sprint for debugging
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyDSGpLZDCfvnbzQpnI1yCUUa6nBUl1O2zY",
  authDomain: "bob20250810.firebaseapp.com",
  projectId: "bob20250810",
  storageBucket: "bob20250810.appspot.com",
  messagingSenderId: "1039292839",
  appId: "1:1039292839:web:18b6f0a62a6a7b3d5a0c3a"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createTestSprint() {
  try {
    // Get current user ID - you'll need to replace this with actual user ID
    const ownerUid = "your-user-id-here"; // Replace with actual user ID from Firebase Auth
    
    const testSprint = {
      ref: "SPRINT-001",
      name: "Test Sprint v3.0.8",
      objective: "Testing drag-and-drop functionality and activity stream",
      notes: "Created for debugging v3.0.8 issues",
      status: "active",
      startDate: Date.now(),
      endDate: Date.now() + (14 * 24 * 60 * 60 * 1000), // 2 weeks from now
      planningDate: Date.now() - (1 * 24 * 60 * 60 * 1000), // 1 day ago
      retroDate: Date.now() + (15 * 24 * 60 * 60 * 1000), // 15 days from now
      ownerUid: ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, 'sprints'), testSprint);
    console.log('Test sprint created with ID:', docRef.id);
    
  } catch (error) {
    console.error('Error creating test sprint:', error);
  }
}

// Uncomment and update ownerUid to run
// createTestSprint();

console.log('To use this script:');
console.log('1. Replace "your-user-id-here" with your actual Firebase Auth user ID');
console.log('2. Run: node create-test-sprint.js');
