import React from 'react';
import IntegrationSettings from '../../IntegrationSettings';

const SteamSettings: React.FC = () => {
  return (
    <div className="container py-4">
      <h2 className="mb-3">Steam Settings</h2>
      <IntegrationSettings section="steam" />
    </div>
  );
};

export default SteamSettings;

