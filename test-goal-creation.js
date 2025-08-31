/**
 * 🎯 BOB v3.1.1 Test Goal Creation Script
 * 
 * This script creates a test goal to verify real-time updates are working
 * in the goals table with the new activity tracking functionality.
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

const firebaseConfig = {
  apiKey: "AIzaSyBfCdXhMQy9Vqfoh3Ja2UHoMT1EDbD4cIY",
  authDomain: "bob20250810.firebaseapp.com",
  projectId: "bob20250810",
  storageBucket: "bob20250810.appspot.com",
  messagingSenderId: "251593945301",
  appId: "1:251593945301:web:a6bd67e6aa1dd36a42e3e5",
  measurementId: "G-PD0HHP3H1H"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function createTestGoal() {
  try {
    console.log('🔐 Signing in to Firebase...');
    
    // You'll need to replace these with actual credentials
    const email = 'test@example.com'; // Replace with your test email
    const password = 'your-password'; // Replace with your test password
    
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    console.log('✅ Signed in as:', user.email);
    
    const testGoal = {
      persona: 'personal',
      title: `Test Goal - Real-time Update ${new Date().toISOString()}`,
      description: 'Testing real-time goal creation and table updates',
      theme: 'Growth',
      size: 'M',
      timeToMasterHours: 40,
      targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      confidence: 7,
      status: 'Not Started',
      ownerUid: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    console.log('🎯 Creating test goal...');
    const docRef = await addDoc(collection(db, 'goals'), testGoal);
    console.log('✅ Test goal created with ID:', docRef.id);
    console.log('📊 Goal data:', testGoal);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test goal:', error);
    process.exit(1);
  }
}

// Uncomment to run the test
// createTestGoal();

console.log('🧪 Test script ready. Update credentials and uncomment createTestGoal() to run.');
