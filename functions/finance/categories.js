// Finance category definitions shared by server-side AI/analytics.
// Keep aligned with react-app/src/utils/financeCategories.ts

const DEFAULT_FINANCE_CATEGORIES = [
  { key: 'uncategorized', label: 'Uncategorised', bucket: 'unknown' },
  { key: 'net_salary', label: 'Net Salary', bucket: 'net_salary' },
  { key: 'bonus', label: 'Bonus', bucket: 'irregular_income' },
  { key: 'airbnb_income', label: 'Airbnb Income', bucket: 'irregular_income' },
  { key: 'gift_income', label: 'Gift Income', bucket: 'irregular_income' },
  { key: 'side_gig', label: 'Side Gig', bucket: 'irregular_income' },
  { key: 'refund', label: 'Refund', bucket: 'irregular_income' },
  { key: 'repayment', label: 'Repayment', bucket: 'irregular_income' },
  { key: 'groceries', label: 'Groceries', bucket: 'mandatory' },
  { key: 'mortgage', label: 'Mortgage Repayment', bucket: 'mandatory' },
  { key: 'rent', label: 'Rent', bucket: 'mandatory' },
  { key: 'rates', label: 'Rates', bucket: 'mandatory' },
  { key: 'home_insurance', label: 'Home Insurance', bucket: 'mandatory' },
  { key: 'car_insurance', label: 'Car Insurance', bucket: 'mandatory' },
  { key: 'life_insurance', label: 'Life Insurance', bucket: 'mandatory' },
  { key: 'broadband', label: 'Broadband', bucket: 'mandatory' },
  { key: 'mobile_bill', label: 'Mobile Bill Payment', bucket: 'mandatory' },
  { key: 'home_electricity', label: 'Home Electricity', bucket: 'mandatory' },
  { key: 'home_heating', label: 'Home Heating', bucket: 'mandatory' },
  { key: 'petrol', label: 'Petrol', bucket: 'mandatory' },
  { key: 'car_tax', label: 'Car Tax', bucket: 'mandatory' },
  { key: 'car_maintenance', label: 'Car Maintenance', bucket: 'mandatory' },
  { key: 'dental', label: 'Dental', bucket: 'mandatory' },
  { key: 'personal_care', label: 'Personal Care', bucket: 'mandatory' },
  { key: 'gifts', label: 'Gifts', bucket: 'mandatory' },
  { key: 'tv_licence', label: 'TV Licence', bucket: 'mandatory' },
  { key: 'home', label: 'Home', bucket: 'mandatory' },
  { key: 'eating_out', label: 'Eating Out', bucket: 'discretionary' },
  { key: 'coffee', label: 'Coffee', bucket: 'discretionary' },
  { key: 'cinema', label: 'Cinema', bucket: 'discretionary' },
  { key: 'gym', label: 'Gym', bucket: 'discretionary' },
  { key: 'crossfit', label: 'Crossfit - Gym', bucket: 'discretionary' },
  { key: 'clothes', label: 'Clothes', bucket: 'discretionary' },
  { key: 'going_out', label: 'Going Out', bucket: 'discretionary' },
  { key: 'gaming', label: 'Gaming', bucket: 'discretionary' },
  { key: 'online_subscription', label: 'Online Subscription', bucket: 'discretionary' },
  { key: 'travel', label: 'Travel', bucket: 'discretionary' },
  { key: 'taxi', label: 'Taxi', bucket: 'discretionary' },
  { key: 'car_parking', label: 'Car Parking', bucket: 'discretionary' },
  { key: 'grooming', label: 'Grooming', bucket: 'discretionary' },
  { key: 'cleaner', label: 'Cleaner', bucket: 'discretionary' },
  { key: 'charity', label: 'Charity', bucket: 'discretionary' },
  { key: 'pet_dog', label: 'Pet/Dog', bucket: 'discretionary' },
  { key: 'mountainbike', label: 'Mountain Bike', bucket: 'discretionary' },
  { key: 'car_loan', label: 'Car Loan Repayment', bucket: 'debt_repayment' },
  { key: 'credit_card_interest', label: 'Credit Card Interest', bucket: 'debt_repayment' },
  { key: 'snowball', label: 'Debt Snowball Budget', bucket: 'debt_repayment' },
  { key: 'short_term_general', label: 'Short Term Saving', bucket: 'short_saving' },
  { key: 'short_travel', label: 'Short Term Saving - Travel', bucket: 'short_saving' },
  { key: 'short_dog', label: 'Short Term Saving - Dog', bucket: 'short_saving' },
  { key: 'short_debt_snowball', label: 'Short Term Saving - Debt Snowball', bucket: 'short_saving' },
  { key: 'short_tax', label: 'Short Term Saving - Tax Bill', bucket: 'short_saving' },
  { key: 'short_gifts', label: 'Short Term Saving - Gifts', bucket: 'short_saving' },
  { key: 'short_oil', label: 'Short Term Saving - Oil', bucket: 'short_saving' },
  { key: 'emergency_fund', label: 'Emergency Fund', bucket: 'short_saving' },
  { key: 'long_home', label: 'Long Term Saving - Home', bucket: 'long_saving' },
  { key: 'long_safety_net', label: 'Long Term Saving - Safety Net', bucket: 'long_saving' },
  { key: 'long_gap_year', label: 'Long Term Saving - GAP Year', bucket: 'long_saving' },
  { key: 'investment_traditional', label: 'Investment Traditional', bucket: 'investment' },
  { key: 'crypto_investment', label: 'Crypto Investment', bucket: 'investment' },
  { key: 'retirement', label: 'Retirement', bucket: 'investment' },
  { key: 'bank_transfer', label: 'Bank Transfer', bucket: 'bank_transfer' },
  { key: 'monzo_transfer', label: 'Monzo Transfer', bucket: 'bank_transfer' },
  { key: 'banking_fee', label: 'Banking Fee', bucket: 'bank_transfer' },
  { key: 'pot_transfer', label: 'Pot Transfer', bucket: 'bank_transfer' },
  { key: 'pot_transfer_snowball', label: 'Pot Transfer - Snowball', bucket: 'bank_transfer' },
  { key: 'pot_transfer_investment', label: 'Pot Transfer - Investment', bucket: 'bank_transfer' },
  { key: 'unknown', label: 'Unknown', bucket: 'unknown' },
  { key: 'uncategorised_cash', label: 'Uncategorised Cash Withdrawal', bucket: 'unknown' },
  { key: 'unknown_expense', label: 'Unknown Expense', bucket: 'unknown' },
  { key: 'returned_payment', label: 'Returned Payment', bucket: 'unknown' },
  { key: 'work_expense', label: 'Work Expense (Reimbursed)', bucket: 'unknown' },
];

const mergeFinanceCategories = (custom = []) => {
  const map = new Map();
  DEFAULT_FINANCE_CATEGORIES.forEach((c) => map.set(c.key, c));
  (custom || [])
    .filter((c) => c && c.key)
    .forEach((c) => {
      const existing = map.get(c.key) || {};
      map.set(c.key, { ...existing, ...c });
    });
  return Array.from(map.values());
};

module.exports = {
  DEFAULT_FINANCE_CATEGORIES,
  mergeFinanceCategories,
};
