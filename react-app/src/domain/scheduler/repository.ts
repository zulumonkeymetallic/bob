import {
  collection,
  doc,
  Firestore,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { schedulerConverters } from './firestore';
import type {
  BlockModel,
  ChoreModel,
  RoutineModel,
  ScheduledInstanceModel,
  PlanningJobState,
  SchedulePreview,
} from './types';

const blocksPath = 'blocks';
const choresPath = 'chores';
const routinesPath = 'routines';
const instancesPath = 'scheduled_instances';
const planningJobsPath = 'planning_jobs';

export const schedulerCollections = {
  blocks(db: Firestore) {
    return collection(db, blocksPath).withConverter(schedulerConverters.blockConverter);
  },
  userBlocks(db: Firestore, ownerUid: string) {
    return query(
      schedulerCollections.blocks(db),
      where('ownerUid', '==', ownerUid),
      orderBy('priority', 'asc'),
    );
  },
  chores(db: Firestore) {
    return collection(db, choresPath).withConverter(schedulerConverters.choreConverter);
  },
  userChores(db: Firestore, ownerUid: string) {
    return query(
      schedulerCollections.chores(db),
      where('ownerUid', '==', ownerUid),
      orderBy('priority', 'asc'),
    );
  },
  routines(db: Firestore) {
    return collection(db, routinesPath).withConverter(schedulerConverters.routineConverter);
  },
  userRoutines(db: Firestore, ownerUid: string) {
    return query(
      schedulerCollections.routines(db),
      where('ownerUid', '==', ownerUid),
      orderBy('priority', 'asc'),
    );
  },
  scheduledInstances(db: Firestore) {
    return collection(db, instancesPath).withConverter(schedulerConverters.instanceConverter);
  },
  userInstances(db: Firestore, ownerUid: string, occurrenceDate: string) {
    return query(
      schedulerCollections.scheduledInstances(db),
      where('ownerUid', '==', ownerUid),
      where('occurrenceDate', '==', occurrenceDate),
      orderBy('plannedStart', 'asc'),
    );
  },
  userInstancesRange(db: Firestore, ownerUid: string, startKey: string, endKey: string) {
    return query(
      schedulerCollections.scheduledInstances(db),
      where('ownerUid', '==', ownerUid),
      where('occurrenceDate', '>=', startKey),
      where('occurrenceDate', '<=', endKey),
      orderBy('occurrenceDate', 'asc'),
      orderBy('plannedStart', 'asc'),
    );
  },
  planningJobs(db: Firestore) {
    return collection(db, planningJobsPath).withConverter(schedulerConverters.planningJobConverter);
  },
  planningJobKey(db: Firestore, userId: string, planningDate: string) {
    const id = `${userId}__${planningDate}`;
    return doc(db, `${planningJobsPath}/${id}`).withConverter(
      schedulerConverters.planningJobConverter,
    );
  },
};

export type SchedulerCollections = typeof schedulerCollections;

export type {
  BlockModel,
  ChoreModel,
  RoutineModel,
  ScheduledInstanceModel,
  PlanningJobState,
  SchedulePreview,
};
