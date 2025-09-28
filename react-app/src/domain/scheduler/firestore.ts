import type { FirestoreDataConverter } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';
import type {
  BlockModel,
  ScheduledInstanceModel,
  ChoreModel,
  RoutineModel,
  PlanningJobState,
} from './types';

type WithTimestamps<T> = Omit<T, 'createdAt' | 'updatedAt'> & {
  createdAt: number | Timestamp;
  updatedAt: number | Timestamp;
};

type MaybeTimestamp = Timestamp | number | null | undefined;

const timestampToMillis = (value: MaybeTimestamp): number => {
  if (!value) return 0;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  return 0;
};

const normalizeTimestamps = <T extends { createdAt: MaybeTimestamp; updatedAt: MaybeTimestamp }>(
  data: T,
): { createdAt: number; updatedAt: number } => ({
  createdAt: timestampToMillis(data.createdAt),
  updatedAt: timestampToMillis(data.updatedAt),
});

const serializeTimestamps = <T extends { createdAt: number; updatedAt: number }>(data: T) => ({
  ...data,
  createdAt: Timestamp.fromMillis(data.createdAt),
  updatedAt: Timestamp.fromMillis(data.updatedAt),
});

const blockConverter: FirestoreDataConverter<BlockModel> = {
  fromFirestore(snapshot) {
    const data = snapshot.data() as WithTimestamps<BlockModel>;
    const { createdAt, updatedAt } = normalizeTimestamps(data);
    return {
      id: snapshot.id,
      ...data,
      createdAt,
      updatedAt,
    };
  },
  toFirestore(model: BlockModel) {
    return serializeTimestamps(model);
  },
};

const choreConverter: FirestoreDataConverter<ChoreModel> = {
  fromFirestore(snapshot) {
    const data = snapshot.data() as WithTimestamps<ChoreModel>;
    const { createdAt, updatedAt } = normalizeTimestamps(data);
    return {
      id: snapshot.id,
      ...data,
      createdAt,
      updatedAt,
    };
  },
  toFirestore(model: ChoreModel) {
    return serializeTimestamps(model);
  },
};

const routineConverter: FirestoreDataConverter<RoutineModel> = {
  fromFirestore(snapshot) {
    const data = snapshot.data() as WithTimestamps<RoutineModel>;
    const { createdAt, updatedAt } = normalizeTimestamps(data);
    return {
      id: snapshot.id,
      ...data,
      createdAt,
      updatedAt,
    };
  },
  toFirestore(model: RoutineModel) {
    return serializeTimestamps(model);
  },
};

const instanceConverter: FirestoreDataConverter<ScheduledInstanceModel> = {
  fromFirestore(snapshot) {
    const data = snapshot.data() as WithTimestamps<ScheduledInstanceModel>;
    const { createdAt, updatedAt } = normalizeTimestamps(data);
    return {
      id: snapshot.id,
      ...data,
      createdAt,
      updatedAt,
    };
  },
  toFirestore(model: ScheduledInstanceModel) {
    return serializeTimestamps(model);
  },
};

const planningJobConverter: FirestoreDataConverter<PlanningJobState> = {
  fromFirestore(snapshot) {
    const data = snapshot.data() as WithTimestamps<PlanningJobState>;
    const { createdAt, updatedAt } = normalizeTimestamps(data);
    return {
      id: snapshot.id,
      ...data,
      createdAt,
      updatedAt,
    };
  },
  toFirestore(model: PlanningJobState) {
    return serializeTimestamps(model);
  },
};

export const schedulerConverters = {
  blockConverter,
  choreConverter,
  routineConverter,
  instanceConverter,
  planningJobConverter,
};
