const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function debugStoryGoalRelationship() {
  try {
    console.log('🔍 Starting Story-Goal Relationship Debug...');
    
    // Get all goals
    const goalsSnapshot = await db.collection('goals').get();
    const goals = [];
    goalsSnapshot.forEach(doc => {
      goals.push({ id: doc.id, ...doc.data() });
    });
    
    console.log(`📊 Found ${goals.length} goals:`);
    goals.forEach(goal => {
      console.log(`  - Goal ID: ${goal.id}, Title: "${goal.title}", Owner: ${goal.ownerUid}`);
    });
    
    // Get all stories
    const storiesSnapshot = await db.collection('stories').get();
    const stories = [];
    storiesSnapshot.forEach(doc => {
      stories.push({ id: doc.id, ...doc.data() });
    });
    
    console.log(`\n📚 Found ${stories.length} stories:`);
    stories.forEach(story => {
      console.log(`  - Story ID: ${story.id}, Title: "${story.title}", Goal ID: "${story.goalId}", Owner: ${story.ownerUid}`);
    });
    
    // Check for orphaned stories (stories with goalId that doesn't exist)
    console.log('\n🔍 Checking for orphaned stories...');
    const goalIds = goals.map(g => g.id);
    const orphanedStories = stories.filter(story => story.goalId && !goalIds.includes(story.goalId));
    
    if (orphanedStories.length > 0) {
      console.log(`❌ Found ${orphanedStories.length} orphaned stories:`);
      orphanedStories.forEach(story => {
        console.log(`  - Story "${story.title}" references non-existent goal ID: ${story.goalId}`);
      });
    } else {
      console.log('✅ No orphaned stories found');
    }
    
    // Check stories per goal
    console.log('\n📊 Stories per goal:');
    goals.forEach(goal => {
      const goalStories = stories.filter(story => story.goalId === goal.id);
      console.log(`  - Goal "${goal.title}" (${goal.id}): ${goalStories.length} stories`);
      goalStories.forEach(story => {
        console.log(`    * "${story.title}" (${story.id})`);
      });
    });
    
    // Check for data type issues
    console.log('\n🔍 Checking data types...');
    stories.forEach(story => {
      console.log(`  - Story "${story.title}": goalId type = ${typeof story.goalId}, value = "${story.goalId}"`);
    });
    
    goals.forEach(goal => {
      console.log(`  - Goal "${goal.title}": id type = ${typeof goal.id}, value = "${goal.id}"`);
    });
    
  } catch (error) {
    console.error('❌ Error debugging story-goal relationship:', error);
  }
}

// Run the debug function
debugStoryGoalRelationship().then(() => {
  console.log('\n✅ Debug completed');
  process.exit(0);
}).catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
