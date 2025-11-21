// Enhanced Finance Category System
// Comprehensive category definitions with budget percentages and merchant patterns

export type CategoryBucket =
    | 'mandatory'        // Mandatory Expenses
    | 'discretionary'    // Discretionary Expenses  
    | 'net_salary'       // Net Salary (income)
    | 'irregular_income' // Irregular Income
    | 'short_saving'     // Short Term Saving
    | 'long_saving'      // Long Term Saving
    | 'investment'       // Investment
    | 'bank_transfer'    // Bank Transfer
    | 'debt_repayment'   // Debt repayment
    | 'unknown';         // Unknown

export interface FinanceCategory {
    key: string;              // "groceries", "car_insurance"
    label: string;            // "Groceries", "Car Insurance"
    bucket: CategoryBucket;   // "mandatory", "discretionary", etc.
    budgetPercent?: number;   // 5.0 = 5% of income
    budgetAmount?: number;    // fallback fixed amount in pence
    merchantPatterns?: string[]; // Auto-mapping patterns (lowercase)
    isDefault: boolean;       // Pre-populated vs user-added
}

export const BUCKET_LABELS: Record<CategoryBucket, string> = {
    'mandatory': 'Mandatory Expenses',
    'discretionary': 'Discretionary Expenses',
    'net_salary': 'Net Salary',
    'irregular_income': 'Irregular Income',
    'short_saving': 'Short Term Saving',
    'long_saving': 'Long Term Saving',
    'investment': 'Investment',
    'bank_transfer': 'Bank Transfer',
    'debt_repayment': 'Debt Repayment',
    'unknown': 'Unknown'
};

export const BUCKET_COLORS: Record<CategoryBucket, string> = {
    'mandatory': '#dc3545',      // Red
    'discretionary': '#fd7e14',  // Orange
    'net_salary': '#28a745',     // Green
    'irregular_income': '#20c997', // Teal
    'short_saving': '#17a2b8',   // Cyan
    'long_saving': '#007bff',    // Blue
    'investment': '#6610f2',     // Purple
    'bank_transfer': '#6c757d',  // Gray
    'debt_repayment': '#e83e8c', // Pink
    'unknown': '#adb5bd'         // Light gray
};

export const DEFAULT_CATEGORIES: FinanceCategory[] = [
    // ========== INCOME ==========
    { key: 'net_salary', label: 'Net Salary', bucket: 'net_salary', budgetPercent: 100, isDefault: true },
    { key: 'bonus', label: 'Bonus', bucket: 'irregular_income', isDefault: true },
    { key: 'airbnb_income', label: 'Airbnb Income', bucket: 'irregular_income', isDefault: true },
    { key: 'gift_income', label: 'Gift Income', bucket: 'irregular_income', isDefault: true },
    { key: 'side_gig', label: 'Side Gig', bucket: 'irregular_income', isDefault: true },
    { key: 'refund', label: 'Refund', bucket: 'irregular_income', isDefault: true },
    { key: 'repayment', label: 'Repayment', bucket: 'irregular_income', isDefault: true },

    // ========== MANDATORY EXPENSES ==========
    {
        key: 'groceries', label: 'Groceries', bucket: 'mandatory', budgetPercent: 15, isDefault: true,
        merchantPatterns: ['tesco', 'sainsbury', 'asda', 'aldi', 'lidl', 'waitrose', 'morrisons', 'marks & spencer', 'm&s food']
    },
    { key: 'mortgage', label: 'Mortgage Repayment', bucket: 'mandatory', budgetPercent: 25, isDefault: true },
    { key: 'rent', label: 'Rent', bucket: 'mandatory', budgetPercent: 25, isDefault: true },
    { key: 'rates', label: 'Rates', bucket: 'mandatory', budgetPercent: 2, isDefault: true },
    { key: 'home_insurance', label: 'Home Insurance', bucket: 'mandatory', budgetPercent: 1, isDefault: true },
    { key: 'car_insurance', label: 'Car Insurance', bucket: 'mandatory', budgetPercent: 2, isDefault: true },
    { key: 'life_insurance', label: 'Life Insurance', bucket: 'mandatory', budgetPercent: 1, isDefault: true },
    {
        key: 'broadband', label: 'Broadband', bucket: 'mandatory', budgetPercent: 1, isDefault: true,
        merchantPatterns: ['bt', 'virgin media', 'sky', 'talktalk', 'plusnet']
    },
    {
        key: 'mobile_bill', label: 'Mobile Bill Payment', bucket: 'mandatory', budgetPercent: 1, isDefault: true,
        merchantPatterns: ['ee', 'vodafone', 'three', 'o2', 'giffgaff']
    },
    {
        key: 'home_electricity', label: 'Home Electricity', bucket: 'mandatory', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['british gas', 'eon', 'edf', 'octopus energy', 'bulb']
    },
    { key: 'home_heating', label: 'Home Heating', bucket: 'mandatory', budgetPercent: 2, isDefault: true },
    {
        key: 'petrol', label: 'Petrol', bucket: 'mandatory', budgetPercent: 3, isDefault: true,
        merchantPatterns: ['shell', 'bp', 'esso', 'texaco', 'sainsbury fuel', 'tesco fuel']
    },
    { key: 'car_tax', label: 'Car Tax', bucket: 'mandatory', budgetPercent: 1, isDefault: true },
    {
        key: 'car_maintenance', label: 'Car Maintenance', bucket: 'mandatory', budgetPercent: 1, isDefault: true,
        merchantPatterns: ['kwik fit', 'halfords', 'garage']
    },
    { key: 'dental', label: 'Dental', bucket: 'mandatory', budgetPercent: 1, isDefault: true },
    {
        key: 'personal_care', label: 'Personal Care', bucket: 'mandatory', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['boots', 'superdrug']
    },
    { key: 'gifts', label: 'Gifts', bucket: 'mandatory', budgetPercent: 2, isDefault: true },
    { key: 'tv_licence', label: 'TV Licence', bucket: 'mandatory', budgetPercent: 0.5, isDefault: true },
    {
        key: 'home', label: 'Home', bucket: 'mandatory', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['ikea', 'argos', 'homebase', 'b&q', 'wickes']
    },

    // ========== DISCRETIONARY EXPENSES ==========
    {
        key: 'eating_out', label: 'Eating Out', bucket: 'discretionary', budgetPercent: 5, isDefault: true,
        merchantPatterns: ['restaurant', 'nando', 'mcdonald', 'kfc', 'pizza hut', 'domino', 'subway', 'greggs', 'pret']
    },
    {
        key: 'coffee', label: 'Coffee', bucket: 'discretionary', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['starbucks', 'costa', 'cafe nero', 'pret a manger']
    },
    {
        key: 'cinema', label: 'Cinema', bucket: 'discretionary', budgetPercent: 1, isDefault: true,
        merchantPatterns: ['odeon', 'cineworld', 'vue', 'picturehouse']
    },
    {
        key: 'gym', label: 'Gym', bucket: 'discretionary', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['puregym', 'the gym', 'fitness first', 'virgin active', 'david lloyd']
    },
    {
        key: 'crossfit', label: 'Crossfit - Gym', bucket: 'discretionary', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['crossfit']
    },
    {
        key: 'clothes', label: 'Clothes', bucket: 'discretionary', budgetPercent: 3, isDefault: true,
        merchantPatterns: ['primark', 'next', 'h&m', 'zara', 'uniqlo', 'tk maxx', 'sports direct', 'jd sports']
    },
    {
        key: 'going_out', label: 'Going Out', bucket: 'discretionary', budgetPercent: 3, isDefault: true,
        merchantPatterns: ['pub', 'bar', 'wetherspoon', 'brewdog']
    },
    {
        key: 'gaming', label: 'Gaming', bucket: 'discretionary', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['steam', 'playstation', 'xbox', 'nintendo', 'game']
    },
    {
        key: 'online_subscription', label: 'Online Subscription', bucket: 'discretionary', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['netflix', 'spotify', 'amazon prime', 'disney', 'apple music']
    },
    {
        key: 'travel', label: 'Travel', bucket: 'discretionary', budgetPercent: 5, isDefault: true,
        merchantPatterns: ['ryanair', 'easyjet', 'booking.com', 'airbnb', 'trainline']
    },
    {
        key: 'taxi', label: 'Taxi', bucket: 'discretionary', budgetPercent: 1, isDefault: true,
        merchantPatterns: ['uber', 'bolt', 'taxi']
    },
    {
        key: 'car_parking', label: 'Car Parking', bucket: 'discretionary', budgetPercent: 1, isDefault: true,
        merchantPatterns: ['parking', 'ncp']
    },
    {
        key: 'grooming', label: 'Grooming', bucket: 'discretionary', budgetPercent: 1, isDefault: true,
        merchantPatterns: ['barber', 'hairdresser', 'salon']
    },
    { key: 'cleaner', label: 'Cleaner', bucket: 'discretionary', budgetPercent: 2, isDefault: true },
    { key: 'charity', label: 'Charity', bucket: 'discretionary', budgetPercent: 1, isDefault: true },
    {
        key: 'pet_dog', label: 'Pet/Dog', bucket: 'discretionary', budgetPercent: 2, isDefault: true,
        merchantPatterns: ['pets at home', 'vets4pets', 'vet']
    },
    { key: 'mountainbike', label: 'Mountain Bike', bucket: 'discretionary', budgetPercent: 1, isDefault: true },

    // ========== DEBT REPAYMENT ==========
    { key: 'car_loan', label: 'Car Loan Repayment', bucket: 'debt_repayment', budgetPercent: 5, isDefault: true },
    { key: 'credit_card_interest', label: 'Credit Card Interest', bucket: 'debt_repayment', isDefault: true },
    { key: 'snowball', label: 'Debt Snowball Budget', bucket: 'debt_repayment', isDefault: true },

    // ========== SHORT TERM SAVING ==========
    { key: 'short_term_general', label: 'Short Term Saving', bucket: 'short_saving', budgetPercent: 5, isDefault: true },
    { key: 'short_travel', label: 'Short Term Saving - Travel', bucket: 'short_saving', isDefault: true },
    { key: 'short_dog', label: 'Short Term Saving - Dog', bucket: 'short_saving', isDefault: true },
    { key: 'short_debt_snowball', label: 'Short Term Saving - Debt Snowball', bucket: 'short_saving', isDefault: true },
    { key: 'short_tax', label: 'Short Term Saving - Tax Bill', bucket: 'short_saving', isDefault: true },
    { key: 'short_gifts', label: 'Short Term Saving - Gifts', bucket: 'short_saving', isDefault: true },
    { key: 'short_oil', label: 'Short Term Saving - Oil', bucket: 'short_saving', isDefault: true },
    { key: 'emergency_fund', label: 'Emergency Fund', bucket: 'short_saving', budgetPercent: 10, isDefault: true },

    // ========== LONG TERM SAVING ==========
    { key: 'long_home', label: 'Long Term Saving - Home', bucket: 'long_saving', isDefault: true },
    { key: 'long_safety_net', label: 'Long Term Saving - Safety Net', bucket: 'long_saving', isDefault: true },
    { key: 'long_gap_year', label: 'Long Term Saving - GAP Year', bucket: 'long_saving', isDefault: true },

    // ========== INVESTMENT ==========
    { key: 'investment_traditional', label: 'Investment Traditional', bucket: 'investment', budgetPercent: 5, isDefault: true },
    { key: 'crypto_investment', label: 'Crypto Investment', bucket: 'investment', budgetPercent: 2, isDefault: true },
    { key: 'retirement', label: 'Retirement', bucket: 'investment', budgetPercent: 10, isDefault: true },

    // ========== BANK TRANSFERS ==========
    { key: 'bank_transfer', label: 'Bank Transfer', bucket: 'bank_transfer', isDefault: true },
    { key: 'monzo_transfer', label: 'Monzo Transfer', bucket: 'bank_transfer', isDefault: true },
    { key: 'banking_fee', label: 'Banking Fee', bucket: 'bank_transfer', isDefault: true },
    { key: 'pot_transfer_snowball', label: 'Pot Transfer - Snowball', bucket: 'bank_transfer', isDefault: true },
    { key: 'pot_transfer_investment', label: 'Pot Transfer - Investment', bucket: 'bank_transfer', isDefault: true },

    // ========== UNKNOWN ==========
    { key: 'unknown', label: 'Unknown', bucket: 'unknown', isDefault: true },
    { key: 'uncategorised_cash', label: 'Uncategorised Cash Withdrawal', bucket: 'unknown', isDefault: true },
    { key: 'unknown_expense', label: 'Unknown Expense', bucket: 'unknown', isDefault: true },
    { key: 'returned_payment', label: 'Returned Payment', bucket: 'unknown', isDefault: true },
    { key: 'work_expense', label: 'Work Expense (Reimbursed)', bucket: 'unknown', isDefault: true },
];

/**
 * Auto-map a merchant name to a category based on pattern matching
 */
export const autoMapMerchant = (merchantName: string): string | null => {
    const normalized = merchantName.toLowerCase().trim();

    for (const category of DEFAULT_CATEGORIES) {
        if (category.merchantPatterns) {
            for (const pattern of category.merchantPatterns) {
                if (normalized.includes(pattern.toLowerCase())) {
                    return category.key;
                }
            }
        }
    }

    return null;
};

/**
 * Get category by key
 */
export const getCategoryByKey = (key: string): FinanceCategory | undefined => {
    return DEFAULT_CATEGORIES.find(c => c.key === key);
};

/**
 * Get categories by bucket
 */
export const getCategoriesByBucket = (bucket: CategoryBucket): FinanceCategory[] => {
    return DEFAULT_CATEGORIES.filter(c => c.bucket === bucket);
};

/**
 * Calculate budget amount from percentage and monthly income
 */
export const calculateBudgetAmount = (percent: number, monthlyIncome: number): number => {
    return Math.round((percent / 100) * monthlyIncome * 100); // Return in pence
};

/**
 * Calculate percentage from budget amount and monthly income
 */
export const calculateBudgetPercent = (amountPence: number, monthlyIncome: number): number => {
    if (monthlyIncome === 0) return 0;
    return ((amountPence / 100) / monthlyIncome) * 100;
};
