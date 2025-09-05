/**
 * Reference ID generator utility for BOB entities
 * Updated to use auto-generated format like GR-26LGIP instead of GOAL-001
 */

export const generateRef = (type: 'story' | 'task' | 'sprint' | 'goal', existingRefs: string[]): string => {
    const prefixes = {
        story: 'ST',
        task: 'TK', 
        sprint: 'SP',
        goal: 'GR'
    };

    const prefix = prefixes[type];
    
    // Generate auto ID using timestamp and random characters
    const timestamp = Date.now().toString(36).toUpperCase().slice(-4); // Last 4 chars of timestamp
    const randomChars = Math.random().toString(36).toUpperCase().slice(2, 4); // 2 random chars
    
    let autoRef = `${prefix}-${timestamp}${randomChars}`;
    
    // Ensure uniqueness by checking against existing refs
    let counter = 0;
    while (existingRefs.includes(autoRef) && counter < 10) {
        const extraChar = Math.random().toString(36).toUpperCase().slice(2, 3);
        autoRef = `${prefix}-${timestamp}${randomChars}${extraChar}`;
        counter++;
    }

    return autoRef;
};

export const validateRef = (ref: string, type: 'story' | 'task' | 'sprint' | 'goal'): boolean => {
    const prefixes = {
        story: 'ST',
        task: 'TK',
        sprint: 'SP', 
        goal: 'GR'
    };

    // Updated pattern for auto-generated format
    const pattern = new RegExp(`^${prefixes[type]}-[A-Z0-9]{4,8}$`);
    return pattern.test(ref);
};
