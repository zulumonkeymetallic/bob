import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';

/**
 * Smoke test: the whole provider stack and router must mount without throwing.
 *
 * This replaces the Create React App boilerplate ("renders learn react link"), which asserted
 * on text this app has never contained and so had failed since the project was scaffolded.
 *
 * Mounting App exercises ThemeProvider, AuthProvider, TestModeProvider, DetailLevelProvider,
 * PersonaProvider, SprintProvider, ProcessTextActivityProvider, SidebarProvider and the
 * router in one go. That is exactly the class of failure this catches: a hook declared after
 * an early `return null` throws "rendered more hooks than during the previous render" and
 * takes the entire app to a blank screen — which happened during the tablet-shell work and
 * was only caught by loading the app in a browser.
 *
 * Signed out is the meaningful state to assert here. There are no Firebase credentials in the
 * test environment, so the app settles on its authentication screen; getting that far proves
 * the tree mounted.
 */
test('mounts the full provider stack and renders the signed-out screen', async () => {
  // ThemeProvider and AuthProvider are applied in index.tsx, not inside App, so App is not
  // self-contained — rendering it bare throws "useAuth must be used within an AuthProvider"
  // from PersonaProvider. This mirrors index.tsx's composition exactly.
  render(
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>,
  );

  // Deliberately not /sign in/i — that matches four separate elements on this screen
  // ("Sign In Locally", "Sign In", "Sign Up", "Sign in to get started") and findByText throws
  // on multiple matches. The tagline appears exactly once.
  expect(
    await screen.findByText(/your personal productivity assistant/i, {}, { timeout: 15000 }),
  ).toBeInTheDocument();
}, 30000);
