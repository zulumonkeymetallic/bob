import React from 'react';
import BudgetSettings from './BudgetSettings';

const BudgetsPage: React.FC = () => {
  return (
    <div className="container py-3">
      <h3>Budgets</h3>
      <p className="text-muted">Set monthly budgets by category. Used across Finance dashboards.</p>
      <BudgetSettings />
    </div>
  );
};

export default BudgetsPage;

