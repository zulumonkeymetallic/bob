import React from 'react';
import { Badge, Button } from 'react-bootstrap';
import { usePersona } from '../contexts/PersonaContext';

const PersonaSwitcher: React.FC = () => {
  const { currentPersona, togglePersona } = usePersona();

  return (
    <div className="d-flex align-items-center">
      <Badge 
        bg={currentPersona === 'personal' ? 'primary' : 'secondary'}
        className="me-2"
      >
        {currentPersona === 'personal' ? 'Personal' : 'Work'}
      </Badge>
      <Button 
        variant="outline-light" 
        size="sm" 
        onClick={togglePersona}
        title={`Switch to ${currentPersona === 'personal' ? 'Work' : 'Personal'}`}
      >
        Switch
      </Button>
    </div>
  );
};

export default PersonaSwitcher;
