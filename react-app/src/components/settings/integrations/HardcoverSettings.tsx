import React from 'react';
import IntegrationSettings from '../../IntegrationSettings';

const HardcoverSettings: React.FC = () => {
  return (
    <div className="container py-4">
      <h2 className="mb-3">Hardcover Settings</h2>
      <IntegrationSettings section="hardcover" />
    </div>
  );
};

export default HardcoverSettings;

