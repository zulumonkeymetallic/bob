// Semantic color system for consistent theming across the application
// Uses CSS variables for theme-awareness

export const colors = {
    // Brand colors (using existing CSS variables)
    brand: {
        primary: 'var(--brand)',
        light: '#818cf8',
        lighter: '#c7d2fe',
        dark: '#4338ca',
    },

    // Semantic colors for states and actions
    success: {
        primary: '#10b981',
        light: '#34d399',
        lighter: '#d1fae5',
        dark: '#059669',
    },
    danger: {
        primary: '#ef4444',
        light: '#f87171',
        lighter: '#fee2e2',
        dark: '#dc2626',
    },
    warning: {
        primary: '#f59e0b',
        light: '#fbbf24',
        lighter: '#fef3c7',
        dark: '#d97706',
    },
    info: {
        primary: '#3b82f6',
        light: '#60a5fa',
        lighter: '#dbeafe',
        dark: '#2563eb',
    },

    // Neutral palette (aligned with existing theme variables)
    neutral: {
        50: '#f9fafb',
        100: '#f3f4f6',
        200: '#e5e7eb',
        300: '#d1d5db',
        400: '#9ca3af',
        500: '#6b7280',
        600: '#4b5563',
        700: '#374151',
        800: '#1f2937',
        900: '#111827',
    },

    // Theme-specific colors (from GLOBAL_THEMES)
    themes: {
        health: '#10b981',
        growth: '#3b82f6',
        wealth: '#f59e0b',
        tribe: '#8b5cf6',
        home: '#ec4899',
        sidegig: '#14b8a6',
    },
};

// Helper to create color with opacity
export const withOpacity = (color: string, opacity: number): string => {
    return `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
};

// Helper to get semantic color by name
export const getSemanticColor = (variant: 'success' | 'danger' | 'warning' | 'info', shade: 'primary' | 'light' | 'lighter' | 'dark' = 'primary'): string => {
    return colors[variant][shade];
};
