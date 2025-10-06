import React from 'react';
import IntegrationSettings from '../../IntegrationSettings';

const MonzoSettings: React.FC = () => {
  return (
    <div className="container py-4">
      <h2 className="mb-3">Monzo Settings</h2>
      <IntegrationSettings section="monzo" />
    </div>
  );
};

export default MonzoSettings;

