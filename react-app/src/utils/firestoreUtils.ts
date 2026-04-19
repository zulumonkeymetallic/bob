/**
 * Firestore Timestamp Utilities
 * Fixes React error #31 by properly converting Firestore Timestamp objects
 */

export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
}

/**
 * Safely converts Firestore Timestamp objects to JavaScript Date objects
 * Prevents React error #31: "Objects are not valid as a React child"
 */
export const convertFirestoreTimestamp = (value: any): Date | null => {
  if (!value) return null;
  
  // If it's already a Date object, return it
  if (value instanceof Date) return value;
  
  // If it has toDate method (Firestore Timestamp), use it
  if (value.toDate && typeof value.toDate === 'function') {
    return value.toDate();
  }
  
  // If it has seconds/nanoseconds properties (raw Firestore Timestamp)
  if (value.seconds !== undefined && value.nanoseconds !== undefined) {
    return new Date(value.seconds * 1000 + value.nanoseconds / 1000000);
  }
  
  // Try to parse as string/number
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  
  return null;
};

/**
 * Formats a Firestore timestamp for display
 */
export const formatTimestamp = (timestamp: any, options?: Intl.DateTimeFormatOptions): string => {
  const date = convertFirestoreTimestamp(timestamp);
  if (!date) return 'Not set';
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  
  return date.toLocaleDateString('en-US', { ...defaultOptions, ...options });
};

/**
 * Converts Firestore document data to ensure all timestamps are properly converted
 */
export const sanitizeFirestoreData = (data: any): any => {
  if (!data || typeof data !== 'object') return data;
  
  if (Array.isArray(data)) {
    return data.map(sanitizeFirestoreData);
  }
  
  const sanitized = { ...data };
  
  // Common timestamp field names in our app
  const timestampFields = ['createdAt', 'updatedAt', 'dueDate', 'completedAt', 'timestamp'];
  
  timestampFields.forEach(field => {
    if (sanitized[field]) {
      const converted = convertFirestoreTimestamp(sanitized[field]);
      if (converted) {
        sanitized[field] = converted;
      }
    }
  });
  
  // Recursively sanitize nested objects
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] && typeof sanitized[key] === 'object' && !(sanitized[key] instanceof Date)) {
      sanitized[key] = sanitizeFirestoreData(sanitized[key]);
    }
  });
  
  return sanitized;
};

/**
 * Converts an array of Firestore documents to sanitized data
 */
export const sanitizeFirestoreArray = <T>(docs: any[]): T[] => {
  return docs.map(doc => sanitizeFirestoreData(doc));
};
