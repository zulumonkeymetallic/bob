// Typography scale for consistent text styling across the application

export const typography = {
    // Display (hero sections, large headings)
    display: {
        fontSize: '48px',
        lineHeight: '1.1',
        fontWeight: '800',
        letterSpacing: '-1px',
    },

    // Headings
    h1: {
        fontSize: '32px',
        lineHeight: '1.2',
        fontWeight: '700',
        letterSpacing: '-0.5px',
    },
    h2: {
        fontSize: '24px',
        lineHeight: '1.3',
        fontWeight: '600',
    },
    h3: {
        fontSize: '20px',
        lineHeight: '1.4',
        fontWeight: '600',
    },
    h4: {
        fontSize: '18px',
        lineHeight: '1.4',
        fontWeight: '600',
    },
    h5: {
        fontSize: '16px',
        lineHeight: '1.5',
        fontWeight: '600',
    },

    // Body text
    body: {
        fontSize: '15px',
        lineHeight: '1.6',
        fontWeight: '400',
    },
    bodyLarge: {
        fontSize: '16px',
        lineHeight: '1.6',
        fontWeight: '400',
    },
    bodySmall: {
        fontSize: '14px',
        lineHeight: '1.5',
        fontWeight: '400',
    },

    // Utility text
    caption: {
        fontSize: '12px',
        lineHeight: '1.4',
        fontWeight: '500',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
    overline: {
        fontSize: '11px',
        lineHeight: '1.4',
        fontWeight: '600',
        textTransform: 'uppercase' as const,
        letterSpacing: '1px',
    },
    code: {
        fontFamily: 'monospace',
        fontSize: '14px',
        lineHeight: '1.5',
    },
};

// Helper to apply typography styles
export const applyTypography = (variant: keyof typeof typography): React.CSSProperties => {
    return typography[variant] as React.CSSProperties;
};
