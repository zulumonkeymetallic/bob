export interface Task {
  id: string;
  title: string;
  goalArea?: string;
  status: string;
}

export interface Column {
  id: string;
  title: string;
  taskIds: string[];
}
