export interface Goal {
  id: string;
  ref: string;
  title: string;
  themeId: string;
  startDate?: number;
  endDate?: number;
  status: string;
  progress?: number;
  ownerUid: string;
}

export interface Sprint {
  id: string;
  ref: string;
  title: string;
  startDate: number;
  endDate: number;
  status: string;
}

export interface Story {
  id: string;
  ref: string;
  title: string;
  goalId: string;
  plannedSprintId?: string;
  status: string;
}

export interface Theme {
  id: string;
  name: string;
  color: string;
}
