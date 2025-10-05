export const humanizePolicyMode = (mode?: string | null): string => {
  if (!mode) return 'Standard';
  switch (mode) {
    case 'hold':
      return 'Hold';
    case 'roll_forward':
      return 'Roll forward';
    case 'escalate':
      return 'Escalate';
    default:
      return mode
        .replace(/[_-]+/g, ' ')
        .split(' ')
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ''))
        .join(' ')
        .trim();
  }
};
