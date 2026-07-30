// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// The jsdom build CRA ships predates TextEncoder/TextDecoder being globals, but react-router
// v7 reaches for them at module load. Without these, importing anything that pulls in
// react-router-dom throws "TextEncoder is not defined" before a single test runs. Node's are
// the same WHATWG API, so this is a straight polyfill rather than a stub.
if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  (globalThis as any).TextDecoder = TextDecoder;
}

// jsdom implements no media queries at all. ThemeContext calls matchMedia unguarded to resolve
// the 'system' theme, so without this any test that mounts the provider tree dies on
// "window.matchMedia is not a function". Reports "does not match" for everything, which makes
// tests deterministic: light theme, fine pointer, no reduced-motion.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},      // deprecated, still called by older libraries
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
