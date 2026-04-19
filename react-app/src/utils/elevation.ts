// Elevation system for consistent shadows and depth across the application

export const elevation = {
    none: 'none',
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    base: '0 2px 8px rgba(0, 0, 0, 0.08)',
    md: '0 4px 12px rgba(0, 0, 0, 0.1)',
    lg: '0 8px 24px rgba(0, 0, 0, 0.12)',
    xl: '0 12px 32px rgba(0, 0, 0, 0.15)',
    '2xl': '0 16px 48px rgba(0, 0, 0, 0.18)',
};

// Interactive elevation states (for hover/active transitions)
export const elevationTransitions = {
    card: {
        rest: elevation.base,
        hover: elevation.md,
        active: elevation.sm,
    },
    button: {
        rest: elevation.sm,
        hover: elevation.base,
        active: elevation.none,
    },
    modal: {
        rest: elevation.xl,
        hover: elevation.xl,
        active: elevation.xl,
    },
};

// Helper to get elevation with custom opacity
export const getElevation = (level: keyof typeof elevation, opacity: number = 1): string => {
    if (level === 'none') return 'none';

    const shadow = elevation[level];
    if (opacity === 1) return shadow;

    // Adjust opacity in the rgba values
    return shadow.replace(/rgba\(0, 0, 0, ([0-9.]+)\)/g, (_, alpha) => {
        const adjustedAlpha = parseFloat(alpha) * opacity;
        return `rgba(0, 0, 0, ${adjustedAlpha.toFixed(2)})`;
    });
};

// Transition utility for elevation changes
export const elevationTransition = 'box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
