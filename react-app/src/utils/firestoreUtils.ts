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
  console.log('🔥 convertFirestoreTimestamp called', {
    value: value,
    valueType: typeof value,
    isNull: value === null,
    isUndefined: value === undefined,
    hasToDateMethod: value?.toDate ? 'YES' : 'NO',
    hasSecondsNanoseconds: (value?.seconds !== undefined && value?.nanoseconds !== undefined) ? 'YES' : 'NO',
    timestamp: new Date().toISOString()
  });
  
  if (!value) return null;
  
  // If it's already a Date object, return it
  if (value instanceof Date) {
    console.log('✅ Already a Date object', value);
    return value;
  }
  
  // If it has toDate method (Firestore Timestamp), use it
  if (value.toDate && typeof value.toDate === 'function') {
    const converted = value.toDate();
    console.log('✅ Converted using toDate()', { original: value, converted: converted });
    return converted;
  }
  
  // If it has seconds/nanoseconds properties (raw Firestore Timestamp)
  if (value.seconds !== undefined && value.nanoseconds !== undefined) {
    const converted = new Date(value.seconds * 1000 + value.nanoseconds / 1000000);
    console.log('⚠️ Converted raw timestamp object', { 
      original: value, 
      converted: converted,
      seconds: value.seconds,
      nanoseconds: value.nanoseconds
    });
    return converted;
  }
  
  // Try to parse as string/number
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    const isValid = !isNaN(date.getTime());
    console.log(`${isValid ? '✅' : '❌'} String/number conversion`, { 
      original: value, 
      converted: date,
      isValid: isValid
    });
    return isValid ? date : null;
  }
  
  console.log('❌ Could not convert timestamp', { value: value, type: typeof value });
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
  console.log('🧹 sanitizeFirestoreData called', {
    data: data,
    dataType: typeof data,
    isArray: Array.isArray(data),
    isObject: typeof data === 'object' && data !== null,
    timestamp: new Date().toISOString()
  });
  
  if (!data || typeof data !== 'object') return data;
  
  if (Array.isArray(data)) {
    console.log('🧹 Processing array', { length: data.length });
    return data.map(sanitizeFirestoreData);
  }
  
  const sanitized = { ...data };
  
  // Common timestamp field names in our app
  const timestampFields = ['createdAt', 'updatedAt', 'dueDate', 'completedAt', 'timestamp', 'startDate', 'endDate'];
  
  console.log('🧹 Checking timestamp fields', { timestampFields: timestampFields });
  
  timestampFields.forEach(field => {
    if (sanitized[field]) {
      console.log(`🧹 Processing timestamp field: ${field}`, {
        field: field,
        originalValue: sanitized[field],
        originalType: typeof sanitized[field]
      });
      
      const converted = convertFirestoreTimestamp(sanitized[field]);
      if (converted) {
        console.log(`✅ Converted field ${field}`, {
          field: field,
          original: sanitized[field],
          converted: converted
        });
        sanitized[field] = converted;
      } else {
        console.log(`⚠️ Could not convert field ${field}`, {
          field: field,
          value: sanitized[field]
        });
      }
    }
  });
  
  // Recursively sanitize nested objects
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] && typeof sanitized[key] === 'object' && !(sanitized[key] instanceof Date)) {
      console.log(`🧹 Recursively sanitizing nested object: ${key}`);
      sanitized[key] = sanitizeFirestoreData(sanitized[key]);
    }
  });
  
  console.log('🧹 sanitizeFirestoreData complete', {
    original: data,
    sanitized: sanitized,
    timestamp: new Date().toISOString()
  });
  
  return sanitized;
};

/**
 * Converts an array of Firestore documents to sanitized data
 */
export const sanitizeFirestoreArray = <T>(docs: any[]): T[] => {
  return docs.map(doc => sanitizeFirestoreData(doc));
};
