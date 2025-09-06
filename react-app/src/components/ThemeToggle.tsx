import React from 'react';
import { Button, Dropdown } from 'react-bootstrap';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, ThemeMode } from '../contexts/ModernThemeContext';

interface ThemeToggleProps {
  size?: 'sm' | 'lg';
  showLabel?: boolean;
  variant?: 'icon' | 'dropdown';
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  size = 'sm', 
  showLabel = false,
  variant = 'icon'
}) => {
  const { theme, setThemeMode, toggleTheme } = useTheme();
  
  const getThemeIcon = (mode: ThemeMode) => {
    switch (mode) {
      case 'light': return <Sun size={16} />;
      case 'dark': return <Moon size={16} />;
      case 'auto': return <Monitor size={16} />;
    }
  };
  
  const getThemeLabel = (mode: ThemeMode) => {
    switch (mode) {
      case 'light': return 'Light';
      case 'dark': return 'Dark';
      case 'auto': return 'Auto';
    }
  };
  
  if (variant === 'dropdown') {
    return (
      <Dropdown>
        <Dropdown.Toggle
          variant="outline-secondary"
          size={size}
          id="theme-dropdown"
          style={{
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.surface,
            color: theme.colors.onSurface,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {getThemeIcon(theme.mode)}
          {showLabel && getThemeLabel(theme.mode)}
        </Dropdown.Toggle>
        
        <Dropdown.Menu
          style={{
            backgroundColor: theme.colors.surface,
            border: `1px solid ${theme.colors.border}`,
            boxShadow: theme.isDark 
              ? '0 4px 12px rgba(0, 0, 0, 0.3)' 
              : '0 4px 12px rgba(0, 0, 0, 0.1)'
          }}
        >
          <Dropdown.Item
            onClick={() => setThemeMode('light')}
            active={theme.mode === 'light'}
            style={{
              color: theme.colors.onSurface,
              backgroundColor: theme.mode === 'light' ? theme.colors.hover : 'transparent'
            }}
          >
            <Sun size={16} className="me-2" />
            Light
          </Dropdown.Item>
          
          <Dropdown.Item
            onClick={() => setThemeMode('dark')}
            active={theme.mode === 'dark'}
            style={{
              color: theme.colors.onSurface,
              backgroundColor: theme.mode === 'dark' ? theme.colors.hover : 'transparent'
            }}
          >
            <Moon size={16} className="me-2" />
            Dark
          </Dropdown.Item>
          
          <Dropdown.Item
            onClick={() => setThemeMode('auto')}
            active={theme.mode === 'auto'}
            style={{
              color: theme.colors.onSurface,
              backgroundColor: theme.mode === 'auto' ? theme.colors.hover : 'transparent'
            }}
          >
            <Monitor size={16} className="me-2" />
            Auto
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    );
  }
  
  // Icon variant (cycles through themes)
  return (
    <Button
      variant="outline-secondary"
      size={size}
      onClick={toggleTheme}
      title={`Current theme: ${getThemeLabel(theme.mode)}. Click to cycle.`}
      style={{
        border: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.surface,
        color: theme.colors.onSurface,
        display: 'flex',
        alignItems: 'center',
        gap: showLabel ? '8px' : '0',
        padding: showLabel ? '6px 12px' : '6px',
        borderRadius: '6px',
        transition: 'all 0.2s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = theme.colors.hover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = theme.colors.surface;
      }}
    >
      {getThemeIcon(theme.mode)}
      {showLabel && <span>{getThemeLabel(theme.mode)}</span>}
    </Button>
  );
};

export default ThemeToggle;
