/**
 * Race a promise against a timeout so a stuck Firestore write (or any other
 * hanging operation) can never leave the UI silently stuck. Firestore's
 * persistent-cache/multi-tab mode can, in rare cases (a stale tab still
 * holding the IndexedDB primary lease, corrupted local storage, browser
 * storage partitioning), leave a write's promise unresolved forever with no
 * error thrown — nothing to catch, nothing to log. Wrapping the call in a
 * timeout guarantees a bounded, actionable failure instead.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms — the write likely never reached Firestore. Try closing other BOB tabs, then refresh.`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.error(`⏱️❌ [withTimeout] ${label} did not resolve within ${ms}ms`);
      reject(new TimeoutError(label, ms));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
