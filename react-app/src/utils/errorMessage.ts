/**
 * Helpers for reading a thrown value.
 *
 * A `catch` binding is `unknown`, because JavaScript lets you throw anything — a string, a
 * Firebase error object, undefined. Reading `.message` off it directly is what
 * useUnknownInCatchVariables flags, and it is not merely pedantic: when something that is not
 * an Error is thrown, `error.message` silently yields `undefined` and the UI reports
 * "Failed: undefined", which is exactly the case where a real message would help most.
 */

/** Best available human-readable message for a thrown value. Never throws, never undefined. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; code?: unknown };
    if (typeof maybe.message === 'string' && maybe.message) return maybe.message;
    // Firebase errors carry a `code` even when the message is empty.
    if (typeof maybe.code === 'string' && maybe.code) return maybe.code;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
};

/** Stack trace when the thrown value has one, otherwise undefined. */
export const errorStack = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.stack;
  const maybe = error as { stack?: unknown } | null;
  return maybe && typeof maybe.stack === 'string' ? maybe.stack : undefined;
};
