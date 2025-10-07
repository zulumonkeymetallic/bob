export type TaskSource = 'web' | 'ios_reminder' | 'template' | 'ai' | 'gmail' | 'sheets' | 'unknown';

export const deriveTaskSource = (task: any): TaskSource => {
  const s = (task?.source || '').toString().toLowerCase();
  if (s) {
    if (s === 'ios' || s === 'ios_reminder' || s === 'reminder') return 'ios_reminder';
    if (s === 'template' || s === 'web' || s === 'ai' || s === 'gmail' || s === 'sheets') return s as TaskSource;
  }
  if (task?.reminderId || task?.remindersId) return 'ios_reminder';
  const st = (task?.sourceType || '').toString().toLowerCase();
  if (st === 'reminder' || st === 'ios') return 'ios_reminder';
  if (st === 'gmail') return 'gmail';
  if (st) return (st as TaskSource) || 'unknown';
  return 'web';
};

