import React from 'react';
import IntegrationSettings from '../../IntegrationSettings';

const GoogleCalendarSettings: React.FC = () => {
  return (
    <div className="container py-4">
      <h2 className="mb-3">Google Calendar Settings</h2>
      <IntegrationSettings section="google" />
    </div>
  );
};

export default GoogleCalendarSettings;

