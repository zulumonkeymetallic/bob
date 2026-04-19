import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, Button, Card, Container } from 'react-bootstrap';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🚨 ErrorBoundary caught an error:', error, errorInfo);
    
    // Log error details
    this.setState({
      error,
      errorInfo
    });

    // Check if this looks like a cache-related error
    if (error.message.includes('Unexpected token') || 
        error.message.includes('Loading chunk') ||
        error.message.includes('Loading CSS chunk')) {
      console.log('🔄 Cache-related error detected, forcing cache clear...');
      localStorage.setItem('bobJSError', 'true');
      
      // Reload after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleClearCache = () => {
    // Clear all caches and reload
    localStorage.setItem('bobJSError', 'true');
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          caches.delete(name);
        });
      }).finally(() => {
        (window as any).location.reload();
      });
    } else {
      (window as any).location.reload();
    }
  };

  private handleGoHome = () => {
    (window as any).location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <Container fluid className="d-flex align-items-center justify-content-center min-vh-100">
          <Card className="shadow-lg" style={{ maxWidth: '600px' }}>
            <Card.Header className="bg-danger text-white">
              <div className="d-flex align-items-center">
                <AlertCircle size={24} className="me-2" />
                <h5 className="mb-0">Something went wrong</h5>
              </div>
            </Card.Header>
            <Card.Body>
              <Alert variant="danger" className="mb-3">
                <strong>Error:</strong> {this.state.error?.message || 'An unexpected error occurred'}
              </Alert>
              
              <p className="text-muted mb-4">
                The application encountered an error. This might be due to cached files being out of date.
              </p>

              <div className="d-grid gap-2">
                <Button 
                  variant="primary" 
                  onClick={this.handleClearCache}
                  className="d-flex align-items-center justify-content-center"
                >
                  <RefreshCw size={16} className="me-2" />
                  Clear Cache & Reload
                </Button>
                
                <Button 
                  variant="outline-secondary" 
                  onClick={this.handleReload}
                  className="d-flex align-items-center justify-content-center"
                >
                  <RefreshCw size={16} className="me-2" />
                  Simple Reload
                </Button>
                
                <Button 
                  variant="outline-primary" 
                  onClick={this.handleGoHome}
                  className="d-flex align-items-center justify-content-center"
                >
                  <Home size={16} className="me-2" />
                  Go to Homepage
                </Button>
              </div>

              {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
                <details className="mt-4">
                  <summary className="text-muted">Error Details (Development)</summary>
                  <pre className="mt-2 p-2 bg-light rounded small" style={{ fontSize: '12px', overflow: 'auto' }}>
                    {this.state.error && this.state.error.stack}
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </Card.Body>
          </Card>
        </Container>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
