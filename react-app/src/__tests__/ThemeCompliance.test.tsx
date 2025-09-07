import React from 'react';
import { render, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../contexts/ModernThemeContext';

// Mock matchMedia for JSDOM
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

const Probe: React.FC = () => {
  const { setThemeMode } = useTheme();
  React.useEffect(() => {
    setThemeMode('dark');
  }, [setThemeMode]);
  return null;
};

describe('ThemeCompliance', () => {
  test('applies html/body attributes for dark mode', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );

    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.body.getAttribute('data-bs-theme')).toBe('dark');
    expect(document.body.getAttribute('data-theme')).toBe('dark');
  });
});

