import React from 'react';
import { Container } from 'react-bootstrap';

const Changelog: React.FC = () => {
  return (
    <Container className="mt-4">
      <h2>Changelog</h2>
      <div>
        <h4>Version 0.1.0 - August 27, 2025</h4>
        <ul>
          <li>Initial React app structure</li>
          <li>Firebase authentication integration</li>
          <li>Basic routing and navigation</li>
          <li>Theme support (light/dark)</li>
        </ul>
      </div>
    </Container>
  );
};

export default Changelog;
