/**
 * Reference ID generator utility for BOB entities
 * Format: {PREFIX}-{5-digit-number}
 * Examples: ST-12345, TK-67890, GR-54321, SP-98765
 */

export const generateRef = (type: 'story' | 'task' | 'sprint' | 'goal', existingRefs?: string[]): string => {
    const prefixes = {
        story: 'ST',
        task: 'TK', 
        sprint: 'SP',
        goal: 'GR'
    };

    const prefix = prefixes[type];
    
    // Generate 5-digit numeric ID using timestamp modulo and random component for uniqueness
    // This ensures we always get exactly 5 digits without leading zeros
    const timestamp = Date.now() % 100000; // Last 5 digits of timestamp
    const random = Math.floor(Math.random() * 100); // 0-99 for uniqueness
    let numericId = (timestamp + random) % 100000; // Ensure 5 digits max
    
    // Pad to ensure 5 digits
    let refNum = String(numericId).padStart(5, '0');
    if (refNum.length > 5) {
        refNum = refNum.slice(-5);
    }
    
    let ref = `${prefix}-${refNum}`;
    
    // Ensure uniqueness by checking against existing refs
    let counter = 0;
    while (existingRefs?.includes(ref) && counter < 10) {
        numericId = Math.floor(Math.random() * 100000);
        refNum = String(numericId).padStart(5, '0');
        ref = `${prefix}-${refNum}`;
        counter++;
    }

    return ref;
};

export const validateRef = (ref: string, type: 'story' | 'task' | 'sprint' | 'goal'): boolean => {
    const prefixes = {
        story: 'ST',
        task: 'TK',
        sprint: 'SP', 
        goal: 'GR'
    };

    // Pattern for format like ST-12345
    const pattern = new RegExp(`^${prefixes[type]}-\\d{5}$`);
    return pattern.test(ref);
};

/**
 * Returns a consistent display reference used across UI and activity stream,
 * derived from the entity id. Example: story -> ST-{first-5-digits-of-id}
 */
export const displayRefForEntity = (
  type: 'story' | 'task' | 'sprint' | 'goal',
  id: string
): string => {
  const prefixes: Record<string, string> = {
    story: 'ST',
    task: 'TK',
    sprint: 'SP',
    goal: 'GR'
  };
  const prefix = prefixes[type] || 'ID';
  
  // Generate deterministic numeric ID from entity ID using hash-like behavior
  let hash = 0;
  for (let i = 0; i < Math.min(id.length, 10); i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Convert to 5-digit positive number
  const numericId = Math.abs(hash % 100000);
  const refNum = String(numericId).padStart(5, '0');
  
  return `${prefix}-${refNum}`;
};
