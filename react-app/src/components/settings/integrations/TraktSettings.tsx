import React from 'react';
import IntegrationSettings from '../../IntegrationSettings';

const TraktSettings: React.FC = () => {
  return (
    <div className="container py-4">
      <h2 className="mb-3">Trakt Settings</h2>
      <IntegrationSettings section="trakt" />
    </div>
  );
};

export default TraktSettings;

