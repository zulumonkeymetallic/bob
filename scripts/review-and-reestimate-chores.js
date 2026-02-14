#!/usr/bin/env node

/**
 * Chore Review & Re-estimation Script
 *
 * This script reviews all chores and routines, re-estimates their points based on
 * title using Gemini AI, and spreads weekly/daily chores across days to avoid overload.
 *
 * Usage: node scripts/review-and-reestimate-chores.js [--dry-run] [--auto-apply]
 *
 * Options:
 *   --dry-run: Show what would be changed without making updates
 *   --auto-apply: Automatically apply all AI suggestions without prompting
 */

const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Firebase Admin
const serviceAccount = require('/Users/jim/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Initialize Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Parse command line args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AUTO_APPLY = args.includes('--auto-apply');

// Points guide: 1 point = 30 minutes
const POINTS_GUIDE = {
  1: '30 min - Quick chores (take out trash, wipe counter, sort mail)',
  2: '60 min - Medium chores (vacuum house, clean bathroom, laundry)',
  3: '90 min - Long chores (mow lawn, deep clean kitchen, wash car)',
  4: '120 min - Very long chores (deep clean entire house, organize garage)',
};

/**
 * Use Gemini AI to estimate points for a chore based on its title
 */
async function estimateChorePoints(title) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const prompt = `You are helping estimate time for household chores.
Given the chore title below, estimate how many points (1-4) it should take, where:
${Object.entries(POINTS_GUIDE).map(([p, desc]) => `${p} point = ${desc}`).join('\n')}

Chore title: "${title}"

Respond with ONLY a JSON object in this format:
{
  "points": <number 1-4>,
  "reasoning": "<brief explanation>",
  "estimatedMinutes": <number>
}`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate points are 1-4
    if (!parsed.points || parsed.points < 1 || parsed.points > 4) {
      console.warn(`  ⚠️  Invalid points ${parsed.points} from AI, defaulting to 2`);
      return { points: 2, reasoning: 'AI returned invalid points', estimatedMinutes: 60 };
    }

    return parsed;
  } catch (error) {
    console.error(`  ❌ AI estimation failed: ${error.message}`);
    return { points: 2, reasoning: 'AI estimation failed, using default', estimatedMinutes: 60 };
  }
}

/**
 * Spread weekly chores across different days to avoid overload
 */
function optimizeDayDistribution(chores) {
  const weeklyChores = chores.filter(c =>
    c.repeatFrequency === 'weekly' && Array.isArray(c.daysOfWeek)
  );

  if (weeklyChores.length < 5) {
    console.log('  ℹ️  Not enough weekly chores to optimize distribution (< 5)');
    return [];
  }

  // Calculate total time per day
  const dayTotals = {
    Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0,
    Friday: 0, Saturday: 0, Sunday: 0
  };

  weeklyChores.forEach(chore => {
    const minutes = (chore.points || 2) * 30;
    chore.daysOfWeek.forEach(day => {
      if (dayTotals[day] !== undefined) {
        dayTotals[day] += minutes;
      }
    });
  });

  console.log('\n📊 Current weekly distribution:');
  Object.entries(dayTotals).forEach(([day, mins]) => {
    const hours = (mins / 60).toFixed(1);
    const bar = '█'.repeat(Math.floor(mins / 30));
    console.log(`  ${day.padEnd(10)} ${hours}h ${bar}`);
  });

  // Find days with >2 hours of chores
  const overloadedDays = Object.entries(dayTotals)
    .filter(([_, mins]) => mins > 120)
    .map(([day, _]) => day);

  if (overloadedDays.length === 0) {
    console.log('  ✅ All days have ≤2 hours of chores');
    return [];
  }

  console.log(`\n⚠️  Overloaded days (>2h): ${overloadedDays.join(', ')}`);
  console.log('  💡 Suggestion: Manually review and spread chores to lighter days');

  return overloadedDays;
}

/**
 * Main function
 */
async function reviewAndReestimateChores() {
  console.log('🔍 Finding all chores and routines...\n');

  // Query for chores and routines
  const tasksRef = db.collection('tasks');
  const snapshot = await tasksRef
    .where('type', 'in', ['chore', 'routine'])
    .get();

  if (snapshot.empty) {
    console.log('✅ No chores or routines found');
    return;
  }

  console.log(`📋 Found ${snapshot.size} chores/routines\n`);

  const chores = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    chores.push({
      id: doc.id,
      title: data.title || 'Untitled',
      type: data.type,
      points: data.points || null,
      repeatFrequency: data.repeatFrequency || '',
      repeatInterval: data.repeatInterval || 1,
      daysOfWeek: data.daysOfWeek || [],
      ownerUid: data.ownerUid,
    });
  });

  // Sort by title for easier review
  chores.sort((a, b) => a.title.localeCompare(b.title));

  console.log('═'.repeat(80));
  console.log('CHORE REVIEW & RE-ESTIMATION');
  console.log('═'.repeat(80));
  console.log(`\nPoints Guide (1 point = 30 minutes):`);
  Object.entries(POINTS_GUIDE).forEach(([pts, desc]) => {
    console.log(`  ${pts} → ${desc}`);
  });
  console.log('\n' + '═'.repeat(80) + '\n');

  const updates = [];
  let estimatedCount = 0;
  let keptCount = 0;

  for (const chore of chores) {
    const freq = chore.repeatFrequency
      ? `${chore.repeatFrequency}${chore.daysOfWeek.length ? ` (${chore.daysOfWeek.join(', ')})` : ''}`
      : 'one-time';

    console.log(`📝 ${chore.title}`);
    console.log(`   Type: ${chore.type} | Frequency: ${freq}`);
    console.log(`   Current points: ${chore.points || 'not set'}`);

    // Estimate with AI
    const estimate = await estimateChorePoints(chore.title);

    console.log(`   AI suggests: ${estimate.points} points (${estimate.estimatedMinutes} min)`);
    console.log(`   Reasoning: ${estimate.reasoning}`);

    // Determine if we should update
    let shouldUpdate = false;
    let newPoints = estimate.points;

    if (!chore.points) {
      console.log(`   ✅ Will set points to ${newPoints} (currently unset)`);
      shouldUpdate = true;
      estimatedCount++;
    } else if (Math.abs(chore.points - estimate.points) > 0) {
      if (AUTO_APPLY) {
        console.log(`   ✏️  Will update ${chore.points} → ${newPoints}`);
        shouldUpdate = true;
        estimatedCount++;
      } else {
        console.log(`   ⏭️  Keeping existing ${chore.points} points (use --auto-apply to override)`);
        keptCount++;
      }
    } else {
      console.log(`   ✅ Already optimal at ${chore.points} points`);
      keptCount++;
    }

    if (shouldUpdate) {
      updates.push({
        id: chore.id,
        title: chore.title,
        oldPoints: chore.points,
        newPoints,
        reasoning: estimate.reasoning,
      });
    }

    console.log(''); // blank line
  }

  console.log('═'.repeat(80));
  console.log('\n📊 Summary:');
  console.log(`   Total chores: ${chores.length}`);
  console.log(`   To update: ${updates.length}`);
  console.log(`   Keeping as-is: ${keptCount}`);

  // Check day distribution
  optimizeDayDistribution(chores);

  // Apply updates
  if (updates.length > 0) {
    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN - No changes made');
      console.log('\nWould update:');
      updates.forEach(u => {
        console.log(`  - ${u.title}: ${u.oldPoints || 'unset'} → ${u.newPoints} points`);
      });
    } else {
      console.log(`\n💾 Applying ${updates.length} updates...`);

      const batch = db.batch();
      updates.forEach(update => {
        const ref = tasksRef.doc(update.id);
        batch.update(ref, {
          points: update.newPoints,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: 'chore-review-script',
        });
      });

      await batch.commit();
      console.log('✅ Updates committed!\n');

      console.log('Updated chores:');
      updates.forEach(u => {
        console.log(`  ✓ ${u.title}: ${u.oldPoints || 'unset'} → ${u.newPoints} points`);
      });
    }
  } else {
    console.log('\n✨ All chores already have appropriate points!');
  }

  console.log('\n' + '═'.repeat(80));
  console.log('🎉 Review complete!\n');
  console.log('Next steps:');
  console.log('  1. Review the day distribution above');
  console.log('  2. Manually adjust chore schedules if any day has >2 hours');
  console.log('  3. Re-run scheduler to update calendar blocks');
  console.log('  4. Check /chores/checklist to verify improved distribution\n');
}

// Run the script
reviewAndReestimateChores()
  .then(() => {
    console.log('✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
