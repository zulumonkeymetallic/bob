import React, { useState } from 'react';
import { Button, Card, Form, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';

const TestLoginPanel: React.FC = () => {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    try {
      setLoading(true);
      setError(null);
      await signInWithGoogle();
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <Card.Header className="bg-primary text-white text-center">
        <h4 className="mb-0">Sign In to BOB</h4>
      </Card.Header>
      <Card.Body className="p-4">
        {error && (
          <Alert variant="danger" className="mb-3">
            {error}
          </Alert>
        )}
        
        <div className="text-center">
          <Button 
            variant="primary" 
            size="lg" 
            onClick={handleSignIn}
            disabled={loading}
            className="w-100 mb-3"
          >
            {loading ? 'Signing in...' : 'Sign in with Google'}
          </Button>
          
          <hr className="my-4" />
          
          <div className="text-muted">
            <small>
              <strong>For Testing:</strong><br />
              Use side-door authentication by adding URL parameters:<br />
              <code>?test-login=TOKEN&test-mode=true</code>
            </small>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default TestLoginPanel;
