import { useEffect, useRef } from 'react';
import { collection, onSnapshot, query, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ActivityStreamService, type ActivitySource } from '../services/ActivityStreamService';
import logger from '../utils/logger';

type EntityType = 'goals' | 'stories' | 'tasks';

interface AuditOptions {
  currentUserId: string;
  currentUserEmail?: string | null;
  persona?: string | null;
}

type FirestoreRecord = Record<string, any>;

const COLLECTIONS: EntityType[] = ['goals', 'stories', 'tasks'];

const INDEX_HINTS: Record<EntityType, string> = {
  goals: 'ownerUid+persona+updatedAt (or startDate depending on rules)',
  stories: 'ownerUid+persona+updatedAt/goalId',
  tasks: 'ownerUid+persona+updatedAt/storyId'
};

const IGNORED_FIELDS = new Set([
  'updatedAt',
  'serverUpdatedAt',
  'recentNoteAt',
  'lastSyncedAt'
]);

const normaliseValue = (value: any) => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      return (value.toDate() as Date).toISOString();
    } catch {
      return String(value);
    }
  }
  return value;
};

const serialiseForActivity = (value: any) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const diffRecord = (before: FirestoreRecord | undefined, after: FirestoreRecord): Array<{ field: string; previous: any; next: any }> => {
  const diffs: Array<{ field: string; previous: any; next: any }> = [];
  const keys = new Set<string>([
    ...(before ? Object.keys(before) : []),
    ...Object.keys(after)
  ]);
  keys.forEach((key) => {
    const prevVal = before ? normaliseValue(before[key]) : undefined;
    const nextVal = normaliseValue(after[key]);
    const prevSerialised = JSON.stringify(prevVal);
    const nextSerialised = JSON.stringify(nextVal);
    if (prevSerialised !== nextSerialised) {
      diffs.push({ field: key, previous: prevVal, next: nextVal });
    }
  });
  return diffs;
};

const personaFromRecord = (record: FirestoreRecord): string | undefined => {
  const raw = record?.persona;
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  return undefined;
};

const describeChange = (collection: EntityType, doc: QueryDocumentSnapshot, diff: { field: string; previous: any; next: any }) => ({
  collection,
  id: doc.id,
  field: diff.field,
  previous: diff.previous,
  next: diff.next
});

export const useEntityAudit = (options: AuditOptions | null) => {
  const cachesRef = useRef<Record<EntityType, Map<string, FirestoreRecord>>>({
    goals: new Map(),
    stories: new Map(),
    tasks: new Map()
  });

  useEffect(() => {
    if (!options?.currentUserId) return;
    if (process.env.REACT_APP_DISABLE_ENTITY_AUDIT === 'true') {
      logger.info('audit', 'Entity audit disabled via REACT_APP_DISABLE_ENTITY_AUDIT');
      return;
    }

    const unsubscribes = COLLECTIONS.map((collectionName) => {
      const constraints = [
        where('ownerUid', '==', options.currentUserId)
      ];
      if (options.persona) {
        constraints.push(where('persona', '==', options.persona));
      }
      const collectionQuery = query(
        collection(db, collectionName),
        ...constraints
      );
      return onSnapshot(
        collectionQuery,
        (snapshot) => {
          const cache = cachesRef.current[collectionName];
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'removed') {
              cache.delete(change.doc.id);
              return;
            }
            const previous = cache.get(change.doc.id);
            const currentData = change.doc.data() as FirestoreRecord;
            cache.set(change.doc.id, currentData);

            if (change.type === 'added') {
              // Skip initial loads to avoid noisy logs.
              return;
            }

          const diffs = diffRecord(previous, currentData);
          const meaningfulDiffs = diffs.filter((diff) => !IGNORED_FIELDS.has(diff.field));
          if (!meaningfulDiffs.length) return;

          const systemSource: ActivitySource = 'system';
          meaningfulDiffs.forEach((diff) => {
            const details = describeChange(collectionName, change.doc, diff);
            logger.info('audit', 'Entity field changed', details);
            console.log('[AUDIT]', details);
            const persona = personaFromRecord(currentData) ?? 'audit';
            const entityType: 'goal' | 'story' | 'task' =
                collectionName === 'goals' ? 'goal' :
                collectionName === 'stories' ? 'story' :
                'task';
              ActivityStreamService.logFieldChange(
                change.doc.id,
                entityType,
                options.currentUserId,
                options.currentUserEmail || '',
                diff.field,
                serialiseForActivity(diff.previous),
                serialiseForActivity(diff.next),
                persona,
                change.doc.id,
                systemSource
              ).catch((error) => {
                logger.error('audit', 'Failed to record activity stream entry', error);
              });
            });
          });
        },
        (error) => {
          if (error.code === 'permission-denied') {
            logger.warn('audit', `Audit listener blocked by Firestore rules for ${collectionName}. Ensure rules allow ownerUid/persona read.`);
          } else if (error.code === 'failed-precondition') {
            logger.warn(
              'audit',
              `Audit listener missing index for ${collectionName}. Expected index: ${INDEX_HINTS[collectionName]}. Firestore error: ${error.message}`
            );
          } else if (error.code === 'resource-exhausted') {
            logger.warn('audit', `Audit listener disabled due to Firestore resource limits for ${collectionName}.`);
          } else {
            logger.error('audit', `Failed to attach audit listener for ${collectionName}`, error);
          }
          // Disable further processing for this listener.
          return () => undefined;
        }
      );
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe && unsubscribe());
      // Reset caches on logout
      cachesRef.current = {
        goals: new Map(),
        stories: new Map(),
        tasks: new Map()
      };
    };
  }, [options?.currentUserId, options?.currentUserEmail, options?.persona]);
};
