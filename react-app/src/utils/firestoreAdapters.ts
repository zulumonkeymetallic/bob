import { Timestamp } from "firebase/firestore";

/**
 * Safely converts various timestamp formats to Date objects
 * Handles Firestore Timestamps, raw {seconds, nanoseconds} objects, and other formats
 */
export const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  
  // Handle raw {seconds, nanoseconds} objects from Firestore
  if (typeof v === "object" && v !== null && "seconds" in (v as any)) {
    const { seconds, nanoseconds } = v as { seconds: number; nanoseconds?: number };
    return new Date(seconds * 1000 + Math.round((nanoseconds ?? 0) / 1e6));
  }
  
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(+d) ? null : d;
  }
  
  return null;
};

/**
 * Safe date formatter for UI display
 */
export const formatDate = (d: Date | null, options?: Intl.DateTimeFormatOptions): string => {
  if (!d) return "—";
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  };
  
  return d.toLocaleDateString('en-US', { ...defaultOptions, ...options });
};

/**
 * Adapter for Goal documents from Firestore
 */
export const adaptGoal = (doc: any) => {
  const data = doc.data ? doc.data() : doc;
  return {
    id: data.id ?? doc.id,
    title: data.title ?? "",
    description: data.description ?? "",
    status: data.status ?? "active",
    priority: data.priority ?? 0,
    ownerUid: data.ownerUid ?? "",
    persona: data.persona ?? "personal",
    category: data.category ?? "personal",
    sprintId: data.sprintId ?? null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    startDate: toDate(data.startDate),
    endDate: toDate(data.endDate),
    targetDate: toDate(data.targetDate),
    completedAt: toDate(data.completedAt),
    progress: data.progress ?? 0,
    timeframe: data.timeframe ?? "quarter",
    tags: data.tags ?? [],
    keyResults: data.keyResults ?? [],
    orderIndex: data.orderIndex ?? 0
  };
};

/**
 * Adapter for Story documents from Firestore
 */
export const adaptStory = (doc: any) => {
  const data = doc.data ? doc.data() : doc;
  return {
    id: data.id ?? doc.id,
    title: data.title ?? "",
    description: data.description ?? "",
    status: data.status ?? "todo",
    priority: data.priority ?? 0,
    ownerUid: data.ownerUid ?? "",
    persona: data.persona ?? "personal",
    goalId: data.goalId ?? null,
    sprintId: data.sprintId ?? null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    startDate: toDate(data.startDate),
    dueDate: toDate(data.dueDate),
    completedAt: toDate(data.completedAt),
    estimatedHours: data.estimatedHours ?? null,
    actualHours: data.actualHours ?? null,
    orderIndex: data.orderIndex ?? 0,
    tags: data.tags ?? [],
    acceptanceCriteria: data.acceptanceCriteria ?? []
  };
};

/**
 * Adapter for Task documents from Firestore
 */
export const adaptTask = (doc: any) => {
  const data = doc.data ? doc.data() : doc;
  return {
    id: data.id ?? doc.id,
    title: data.title ?? "",
    description: data.description ?? "",
    priority: data.priority ?? 0,
    status: data.status ?? "todo",
    ownerUid: data.ownerUid ?? "",
    persona: data.persona ?? "personal",
    parentId: data.parentId ?? null,
    goalId: data.goalId ?? null,
    storyId: data.storyId ?? null,
    sprintId: data.sprintId ?? null,
    isImportant: data.isImportant ?? false,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    dueAt: toDate(data.dueAt),
    dueDate: toDate(data.dueDate),
    completedAt: toDate(data.completedAt),
    serverUpdatedAt: data.serverUpdatedAt ?? null,
    orderIndex: data.orderIndex ?? 0,
    tags: data.tags ?? [],
    estimatedHours: data.estimatedHours ?? null,
    actualHours: data.actualHours ?? null
  };
};
