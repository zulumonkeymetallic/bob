import React from 'react';
import IntegrationSettings from '../../IntegrationSettings';

const StravaSettings: React.FC = () => {
  return (
    <div className="container py-4">
      <h2 className="mb-3">Strava Settings</h2>
      <IntegrationSettings section="strava" />
    </div>
  );
};

export default StravaSettings;

