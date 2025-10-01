// Quick test script to add sample data for testing AI planning
// Run this in the browser console after signing in

const addTestTasks = async () => {
  console.log('Adding test tasks for AI planning...');
  
  const testTasks = [
    {
      title: 'Morning workout - strength training',
      persona: 'personal',
      parentType: 'goal',
      parentId: 'health-goal-1',
      effort: 'M',
      priority: 'high',
      theme: 'Health',
      estimateMin: 60,
      estimatedHours: 1,
      status: 'planned',
      description: 'Upper body strength training session'
    },
    {
      title: 'Review quarterly financial goals',
      persona: 'personal', 
      parentType: 'goal',
      parentId: 'wealth-goal-1',
      effort: 'L',
      priority: 'med',
      theme: 'Wealth',
      estimateMin: 90,
      estimatedHours: 1.5,
      status: 'planned',
      description: 'Analyze investment portfolio and budget'
    },
    {
      title: 'Call mom and dad',
      persona: 'personal',
      parentType: 'goal', 
      parentId: 'tribe-goal-1',
      effort: 'S',
      priority: 'high',
      theme: 'Tribe',
      estimateMin: 30,
      estimatedHours: 0.5,
      status: 'planned',
      description: 'Weekly family check-in call'
    },
    {
      title: 'Complete AI planning feature implementation',
      persona: 'work',
      parentType: 'project',
      parentId: 'bob-development',
      effort: 'L',
      priority: 'high',
      theme: 'Growth',
      estimateMin: 120,
      estimatedHours: 2,
      status: 'in_progress',
      description: 'Finish and test the AI calendar planning system'
    },
    {
      title: 'Organize home office desk',
      persona: 'personal',
      parentType: 'goal',
      parentId: 'home-goal-1', 
      effort: 'S',
      priority: 'low',
      theme: 'Home',
      estimateMin: 45,
      estimatedHours: 0.75,
      status: 'planned',
      description: 'Declutter and reorganize workspace'
    }
  ];

  try {
    for (const task of testTasks) {
      const docRef = await db.collection('tasks').add({
        ...task,
        ownerUid: auth.currentUser.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
        source: 'manual',
        hasGoal: true,
        alignedToGoal: true,
        syncState: 'clean'
      });
      console.log(`Added task: ${task.title} (${docRef.id})`);
    }
    
    console.log('✅ Test tasks added successfully!');
    console.log('Now try the AI planner at /planning');
    
  } catch (error) {
    console.error('Error adding test tasks:', error);
  }
};

// Also add planning preferences
const addPlanningPrefs = async () => {
  console.log('Adding default planning preferences...');
  
  try {
    await db.collection('planning_prefs').doc(auth.currentUser.uid).set({
      wakeTime: '07:00',
      sleepTime: '23:00', 
      quietHours: [
        { start: '22:00', end: '07:00' }
      ],
      maxHiSessionsPerWeek: 3,
      minRecoveryGapHours: 24,
      weeklyThemeTargets: {
        Health: 300,  // 5 hours
        Growth: 240,  // 4 hours  
        Wealth: 180,  // 3 hours
        Tribe: 120,   // 2 hours
        Home: 60      // 1 hour
      },
      autoApplyThreshold: 0.7
    });
    
    console.log('✅ Planning preferences added!');
    
  } catch (error) {
    console.error('Error adding planning prefs:', error);
  }
};

console.log('Test data functions ready!');
console.log('After signing in, run:');
console.log('1. addTestTasks() - to add sample tasks');
console.log('2. addPlanningPrefs() - to add planning preferences');
console.log('3. Navigate to /planning and test the AI planner');

// Export for easy access
window.addTestTasks = addTestTasks;
window.addPlanningPrefs = addPlanningPrefs;
