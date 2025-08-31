/**
 * Reference ID generator utility for BOB entities
 */

export const generateRef = (type: 'story' | 'task' | 'sprint' | 'goal', existingRefs: string[]): string => {
    const prefixes = {
        story: 'STRY',
        task: 'TASK',
        sprint: 'SPR',
        goal: 'GOAL'
    };

    const prefix = prefixes[type];
    
    // Extract existing numbers for this type
    const existingNumbers = existingRefs
        .filter(ref => ref.startsWith(prefix + '-'))
        .map(ref => parseInt(ref.replace(prefix + '-', '')))
        .filter(num => !isNaN(num));

    // Find the next available number
    const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    const nextNumber = maxNumber + 1;

    return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
};

export const validateRef = (ref: string, type: 'story' | 'task' | 'sprint' | 'goal'): boolean => {
    const prefixes = {
        story: 'STRY',
        task: 'TASK', 
        sprint: 'SPR',
        goal: 'GOAL'
    };

    const pattern = new RegExp(`^${prefixes[type]}-\\d{3}$`);
    return pattern.test(ref);
};
