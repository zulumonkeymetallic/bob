// Spacing system for consistent layout across the application

export const spacing = {
    0: '0',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
    16: '64px',
    20: '80px',
    24: '96px',
    32: '128px',
};

// Component-specific spacing presets
export const componentSpacing = {
    // Cards
    cardPadding: spacing[6],        // 24px
    cardGap: spacing[4],            // 16px
    cardBorderRadius: '12px',

    // Sections
    sectionGap: spacing[8],         // 32px
    pageMargin: spacing[6],         // 24px

    // Buttons
    buttonPadding: '12px 24px',
    buttonPaddingSm: '8px 16px',
    buttonPaddingLg: '16px 32px',
    buttonGap: spacing[3],          // 12px
    buttonBorderRadius: '8px',

    // Inputs
    inputPadding: '10px 16px',
    inputBorderRadius: '6px',

    // Modals
    modalBodyPadding: spacing[6],   // 24px
    modalHeaderPadding: spacing[5], // 20px
    modalFooterPadding: spacing[5], // 20px

    // Tables
    tableCellPadding: '12px 16px',
    tableRowGap: spacing[2],        // 8px
};

// Helper to get spacing value
export const getSpacing = (multiplier: keyof typeof spacing): string => {
    return spacing[multiplier];
};

// Helper to create custom spacing
export const customSpacing = (px: number): string => {
    return `${px}px`;
};
