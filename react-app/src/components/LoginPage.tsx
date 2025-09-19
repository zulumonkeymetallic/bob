import React, { useState } from 'react';
import { Container, Row, Col, Card, Button, Form, Alert, Spinner } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { GoogleAuthProvider, signInWithRedirect } from 'firebase/auth';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

const LoginPage: React.FC = () => {
  const { signInWithGoogle, signInWithGoogleRedirect } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const friendlyAuthMessage = (code?: string, message?: string) => {
    switch (code) {
      case 'auth/unauthorized-domain':
        return 'This domain is not authorized for Google sign-in. Please use the production URL or contact support.';
      case 'auth/popup-blocked':
        return 'Popup was blocked by the browser. Try the Redirect option below.';
      case 'auth/popup-closed-by-user':
        return 'Popup was closed before completing sign-in. Try again or use Redirect sign-in.';
      case 'auth/operation-not-supported-in-this-environment':
        return 'This browser blocks popups. Use Redirect sign-in instead.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and retry.';
      default:
        if (message?.toLowerCase().includes('cookie')) return 'Third‑party cookies are blocked. Enable them for accounts.google.com and retry.';
        return 'Sign-in failed. Please try again or use Redirect sign-in.';
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    
    try {
      await signInWithGoogle();
    } catch (error: any) {
      const code = error?.code;
      setError(friendlyAuthMessage(code, error?.message));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRedirect = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogleRedirect();
    } catch (error: any) {
      const code = error?.code;
      setError(friendlyAuthMessage(code, error?.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container fluid className="vh-100 d-flex align-items-center justify-content-center bg-light">
      <Row className="w-100 justify-content-center">
        <Col md={6} lg={4}>
          <Card className="shadow">
            <Card.Body className="p-5">
              <div className="text-center mb-4">
                <h1 className="h3 text-primary fw-bold">BOB</h1>
                <p className="text-muted">Your personal productivity assistant</p>
              </div>

              {error && <Alert variant="danger">{error}</Alert>}

              {/* Google Sign In */}
              <Button
                variant="outline-primary"
                size="lg"
                className="w-100 mb-3"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                {loading ? (
                  <Spinner animation="border" size="sm" className="me-2" />
                ) : (
                  <i className="fab fa-google me-2"></i>
                )}
                Continue with Google
              </Button>

              <Button
                variant="link"
                size="sm"
                className="w-100 mb-2"
                onClick={handleGoogleRedirect}
                disabled={loading}
              >
                Use redirect sign-in (for popup blockers)
              </Button>

              <div className="text-center my-3">
                <small className="text-muted">or</small>
              </div>

              {/* Email/Password Form */}
              <Form onSubmit={handleEmailSignIn}>
                <Form.Group className="mb-3">
                  <Form.Label>Email</Form.Label>
                  <Form.Control
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Password</Form.Label>
                  <Form.Control
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    minLength={6}
                  />
                </Form.Group>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-100 mb-3"
                  disabled={loading}
                >
                  {loading ? (
                    <Spinner animation="border" size="sm" className="me-2" />
                  ) : null}
                  {isSignUp ? 'Create Account' : 'Sign In'}
                </Button>
              </Form>

              <div className="text-center">
                <Button
                  variant="link"
                  onClick={() => setIsSignUp(!isSignUp)}
                  disabled={loading}
                  className="text-decoration-none"
                >
                  {isSignUp 
                    ? 'Already have an account? Sign In' 
                    : "Don't have an account? Sign Up"
                  }
                </Button>
              </div>

              <hr className="my-4" />
              
              <div className="text-center">
                <small className="text-muted">
                  BOB helps you manage goals, tasks, and productivity.
                  <br />
                  Sign in to get started.
                </small>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default LoginPage;
