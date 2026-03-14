const admin = require('firebase-admin');
const httpsV2 = require('firebase-functions/v2/https');

/**
 * Focus Goals Backend Functions
 * - Create Monzo savings pots for cost-based goals
 * - Auto-story creation for selected goals
 * - Nightly focus goals syncing
 */

/**
 * Create a Monzo savings pot for a goal
 * Requires user to have connected Monzo account
 */
exports.createMonzoPotForGoal = httpsV2.onCall(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) {
      throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
    }

    const { goalId, goalTitle, targetAmount, userId } = req.data;

    if (!goalId || !goalTitle || !targetAmount) {
      throw new httpsV2.HttpsError('invalid-argument', 'Missing goalId, goalTitle, or targetAmount');
    }

    const db = admin.firestore();

    try {
      // 1. Check if user has Monzo connected
      const profileDoc = await db.collection('profiles').doc(uid).get();
      const profile = profileDoc.data();

      if (!profile?.monzoAccountId || !profile?.monzoToken) {
        throw new httpsV2.HttpsError(
          'failed-precondition',
          'Monzo account not connected. Link your Monzo account in Settings → Integrations.'
        );
      }

      // 2. Use Monzo API to create pot
      // Note: This is a placeholder - actual implementation needs Monzo API integration
      // For now, we'll create a local representation in Firestore

      const potsRef = db.collection('pots');
      const potDoc = await potsRef.add({
        ownerUid: uid,
        goalId,
        goalTitle,
        targetAmount: Math.round(targetAmount * 100), // Convert to pence
        currentBalance: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        provider: 'monzo',
        monzoAccountId: profile.monzoAccountId,
        synced: false
      });

      // 3. Queue for Monzo sync (would call actual Monzo API)
      // This would be picked up by a separate function that calls Monzo API

      return {
        ok: true,
        potId: potDoc.id,
        message: `Created savings pot "${goalTitle}" (Target: £${targetAmount})`
      };
    } catch (error) {
      console.error('[createMonzoPotForGoal] error:', error);
      throw new httpsV2.HttpsError('internal', error?.message || 'Failed to create pot');
    }
  }
);

/**
 * Nightly sync for focus goals
 * - Update daysRemaining countdown
 * - Mark as inactive when expired
 * - Calculate progress metrics
 */
exports.syncFocusGoalsNightly = httpsV2.onCall(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) {
      throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
    }

    const db = admin.firestore();

    try {
      const focusGoalsRef = admin.firestore().collection('focusGoals');
      const snap = await focusGoalsRef
        .where('ownerUid', '==', uid)
        .where('isActive', '==', true)
        .get();

      const now = Date.now();
      const updates = [];

      snap.forEach(doc => {
        const focusGoal = doc.data();
        const endDate = new Date(focusGoal.endDate).getTime();
        const daysRemaining = Math.ceil((endDate - now) / (24 * 60 * 60 * 1000));

        if (daysRemaining <= 0) {
          // Focus goal expired, deactivate
          updates.push(
            doc.ref.update({
              isActive: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            })
          );
        } else {
          // Update days remaining
          updates.push(
            doc.ref.update({
              daysRemaining,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            })
          );
        }
      });

      await Promise.all(updates);

      return {
        ok: true,
        synced: updates.length
      };
    } catch (error) {
      console.error('[syncFocusGoalsNightly] error:', error);
      throw new httpsV2.HttpsError('internal', error?.message || 'Sync failed');
    }
  }
);

/**
 * Nightly scheduled sync for all users' focus goals
 */
exports.syncAllFocusGoalsNightly = httpsV2.onRequest(
  { region: 'europe-west2', timeoutSeconds: 300 },
  async (req, res) => {
    const db = admin.firestore();

    try {
      const users = await db.collection('profiles').get();
      let totalSynced = 0;

      for (const userDoc of users.docs) {
        const focusGoals = await db
          .collection('focusGoals')
          .where('ownerUid', '==', userDoc.id)
          .where('isActive', '==', true)
          .get();

        const now = Date.now();

        for (const focusDoc of focusGoals.docs) {
          const focusGoal = focusDoc.data();
          const endDate = new Date(focusGoal.endDate).getTime();
          const daysRemaining = Math.ceil((endDate - now) / (24 * 60 * 60 * 1000));

          if (daysRemaining <= 0) {
            await focusDoc.ref.update({
              isActive: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          } else {
            await focusDoc.ref.update({
              daysRemaining,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }

          totalSynced++;
        }
      }

      res.json({ ok: true, synced: totalSynced });
    } catch (error) {
      console.error('[syncAllFocusGoalsNightly] error:', error);
      res.status(500).json({ ok: false, error: error?.message });
    }
  }
);

// Helper to get all focus goals for a user
exports.getFocusGoalsForUser = httpsV2.onCall(
  { region: 'europe-west2' },
  async (req) => {
    const uid = req?.auth?.uid;
    if (!uid) {
      throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');
    }

    const db = admin.firestore();

    try {
      const snap = await db
        .collection('focusGoals')
        .where('ownerUid', '==', uid)
        .get();

      const focusGoals = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return { ok: true, focusGoals };
    } catch (error) {
      console.error('[getFocusGoalsForUser] error:', error);
      throw new httpsV2.HttpsError('internal', error?.message);
    }
  }
);
