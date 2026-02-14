import React from 'react';
import IntegrationSettings from '../../IntegrationSettings';

const YoutubeSettings: React.FC = () => {
  return (
    <div className="container py-4">
      <h2 className="mb-3">YouTube Settings</h2>
      <IntegrationSettings section="youtube" />
    </div>
  );
};

export default YoutubeSettings;
