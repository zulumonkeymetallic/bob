export type PlaceStatus = 'UNVISITED' | 'BUCKET_LIST' | 'STORY_CREATED' | 'COMPLETED';
export type PlaceType = 'continent' | 'country' | 'region' | 'city';
export type GoalMatchMethod = 'heuristic' | 'llm' | 'manual';

export interface TravelEntry {
  id: string;
  placeType?: PlaceType;
  name?: string;
  countryCode?: string;
  country_code?: string;
  city?: string;
  visited?: boolean;
  visitedAt?: any;
  linked_story_id?: string;
  continent?: string;
  ownerUid: string;
  status?: PlaceStatus | string;
  goalId?: string | null;
  goalTitleSnapshot?: string | null;
  storyId?: string | null;
  storyNumber?: string | null;
  storyTitleSnapshot?: string | null;
  bucketListFlaggedAt?: any;
  storyCreatedAt?: any;
  completedAt?: any;
  lastMatchedAt?: any;
  matchConfidence?: number | null;
  matchMethod?: GoalMatchMethod | null;
  lat?: number;
  lon?: number;
  lng?: number;
  locationName?: string;
  plannedVisitAt?: number | null;
  createdAt?: any;
  updatedAt?: any;
}

export const CONTINENTS = [
  'Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica',
] as const;

export const TRAVEL_THEME_ID = 7;
// ≥ this → auto-link and show toast; 0.5–0.79 → suggest; < 0.5 → skip
export const AUTO_LINK_THRESHOLD = 0.8;
export const SUGGEST_LINK_THRESHOLD = 0.5;

export const PLACE_STATUS_LABELS: Record<PlaceStatus, string> = {
  UNVISITED: 'Unvisited',
  BUCKET_LIST: 'Bucket List',
  STORY_CREATED: 'Story Created',
  COMPLETED: 'Completed',
};

export const PLACE_STATUS_PRIORITY: Record<PlaceStatus, number> = {
  UNVISITED: 0,
  BUCKET_LIST: 1,
  STORY_CREATED: 2,
  COMPLETED: 3,
};

export const PLACE_STATUS_COLORS: Record<PlaceStatus, { fill: string; hover: string; pressed: string }> = {
  UNVISITED:     { fill: '#111827', hover: '#1f2937', pressed: '#0f172a' },
  BUCKET_LIST:   { fill: '#facc15', hover: '#eab308', pressed: '#ca8a04' },
  STORY_CREATED: { fill: '#16a34a', hover: '#15803d', pressed: '#166534' },
  COMPLETED:     { fill: '#2563eb', hover: '#1d4ed8', pressed: '#1e40af' },
};
