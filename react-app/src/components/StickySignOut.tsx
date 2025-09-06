import React from 'react';
import { Button } from 'react-bootstrap';
import { LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ModernThemeContext';
import VersionDisplay from './VersionDisplay';
import { cacheBustingService } from '../services/cacheBustingService';

interface StickySignOutProps {
  onSignOut?: () => void;
  showVersion?: boolean;
  className?: string;
}

const StickySignOut: React.FC<StickySignOutProps> = ({ 
  onSignOut, 
  showVersion = true, 
  className = '' 
}) => {
  const { theme } = useTheme();
  
  const handleSignOut = () => {
    if (onSignOut) {
      onSignOut();
    }
  };

  const handleCacheClear = async () => {
    console.log('🔄 Manual cache clear requested');
    await cacheBustingService.manualCacheClear();
  };
  
  return (
    <div 
      className={`sticky-signout ${className}`}
      style={{ 
        position: 'sticky',
        bottom: 0,
        background: theme.colors.surface,
        borderTop: `1px solid ${theme.colors.border}`,
        padding: '16px',
        zIndex: 100,
        backdropFilter: theme.isDark ? 'blur(10px)' : 'none',
        backgroundColor: theme.isDark 
          ? `${theme.colors.surface}ee` 
          : theme.colors.surface
      }}
    >
      {/* Sign Out Button */}
      <Button 
        size="sm" 
        onClick={handleSignOut}
        className="w-100 d-flex align-items-center justify-content-center gap-2"
        style={{
          borderRadius: '8px',
          background: theme.colors.danger,
          border: `1px solid ${theme.colors.danger}`,
          color: 'white',
          fontWeight: '500',
          padding: '10px 16px',
          transition: 'all 0.2s ease',
          boxShadow: theme.isDark 
            ? '0 2px 4px rgba(0, 0, 0, 0.3)' 
            : '0 2px 4px rgba(0, 0, 0, 0.1)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = theme.isDark 
            ? '0 4px 8px rgba(0, 0, 0, 0.4)' 
            : '0 4px 8px rgba(0, 0, 0, 0.15)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = theme.isDark 
            ? '0 2px 4px rgba(0, 0, 0, 0.3)' 
            : '0 2px 4px rgba(0, 0, 0, 0.1)';
        }}
      >
        <LogOut size={16} />
        Sign Out
      </Button>

      {/* Cache Clear Button */}
      <Button 
        size="sm" 
        variant="outline-secondary"
        onClick={handleCacheClear}
        className="w-100 d-flex align-items-center justify-content-center gap-2 mt-2"
        style={{
          borderRadius: '6px',
          border: `1px solid ${theme.colors.border}`,
          color: theme.colors.onSurface,
          fontWeight: '400',
          padding: '8px 12px',
          fontSize: '12px',
          transition: 'all 0.2s ease',
          backgroundColor: 'transparent'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.colors.secondary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <RefreshCw size={14} />
        Clear Cache & Reload
      </Button>
      
      {/* Version Display */}
      {showVersion && (
        <div 
          style={{ 
            marginTop: '12px',
            fontSize: '11px',
            color: theme.colors.onSurface,
            opacity: 0.7,
            textAlign: 'center'
          }}
        >
          <VersionDisplay 
            variant="compact"
            showSessionInfo={false}
          />
        </div>
      )}
    </div>
  );
};

export default StickySignOut;
