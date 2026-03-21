import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase';

/**
 * TelegramSettings
 *
 * Allows the user to link or unlink their Telegram account.
 *
 * Linking flow:
 *   1. User clicks "Generate Link Code"
 *   2. linkTelegramAccount callable returns a 6-character code + expiry
 *   3. User opens Telegram, finds @BobJC1bot, sends /start <code>
 *   4. Bot creates telegram_sessions and confirms linkage
 */
const TelegramSettings: React.FC = () => {
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlinked, setUnlinked] = useState(false);

  const handleGenerateCode = async () => {
    setLoading(true);
    setError(null);
    setLinkCode(null);
    setExpiresAt(null);

    try {
      const fn = httpsCallable<void, { code: string; expiresAt: string }>(
        functions,
        'linkTelegramAccount',
      );
      const result = await fn();
      setLinkCode(result.data.code);
      setExpiresAt(result.data.expiresAt);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate link code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    setError(null);

    try {
      const fn = httpsCallable(functions, 'unlinkTelegramAccount');
      await fn();
      setLinkCode(null);
      setExpiresAt(null);
      setUnlinked(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to unlink. Please try again.');
    } finally {
      setUnlinking(false);
    }
  };

  const expiryDisplay = expiresAt
    ? new Date(expiresAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="container py-4" style={{ maxWidth: 640 }}>
      <h2 className="mb-1">Telegram</h2>
      <p className="text-muted mb-4">
        Link your Telegram account to receive morning briefings, capture tasks, and manage priorities via chat.
      </p>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {unlinked && !error && (
        <div className="alert alert-info" role="alert">
          Telegram account unlinked.
        </div>
      )}

      {!linkCode ? (
        <div className="card p-4">
          <h5 className="mb-3">Link your account</h5>
          <ol className="mb-4">
            <li>Click <strong>Generate Link Code</strong> below</li>
            <li>Open Telegram and find <strong>@BobJC1bot</strong></li>
            <li>Send the code shown here as: <code>/start YOUR_CODE</code></li>
          </ol>
          <button
            className="btn btn-primary"
            onClick={handleGenerateCode}
            disabled={loading}
          >
            {loading ? 'Generating…' : 'Generate Link Code'}
          </button>
        </div>
      ) : (
        <div className="card p-4">
          <h5 className="mb-2">Your link code</h5>
          <div
            className="text-center my-3 p-3 rounded"
            style={{
              background: 'var(--bs-secondary-bg)',
              fontFamily: 'monospace',
              fontSize: '2rem',
              fontWeight: 700,
              letterSpacing: '0.3em',
            }}
          >
            {linkCode}
          </div>
          <p className="text-muted text-center mb-3" style={{ fontSize: '0.9rem' }}>
            Expires at {expiryDisplay}. Open Telegram, find{' '}
            <strong>@BobJC1bot</strong>, and send:
          </p>
          <div
            className="text-center p-2 rounded mb-4"
            style={{
              background: 'var(--bs-body-bg)',
              border: '1px solid var(--bs-border-color)',
              fontFamily: 'monospace',
              fontSize: '1.1rem',
            }}
          >
            /start {linkCode}
          </div>
          <div className="d-flex gap-2">
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={handleGenerateCode}
              disabled={loading}
            >
              Regenerate
            </button>
            <button
              className="btn btn-outline-danger btn-sm ms-auto"
              onClick={handleUnlink}
              disabled={unlinking}
            >
              {unlinking ? 'Unlinking…' : 'Unlink account'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 p-3 rounded" style={{ background: 'var(--bs-secondary-bg)', fontSize: '0.875rem' }}>
        <strong>Once linked you can:</strong>
        <ul className="mb-0 mt-2">
          <li>Send <code>/top3</code> for today's top priorities</li>
          <li>Send <code>/today</code> for your full day context</li>
          <li>Type a task: <em>"Add task: book swim coaching"</em></li>
          <li>Log a note: <em>"Log: feeling flat, slept 9 hours"</em></li>
          <li>Receive a morning briefing at 07:00</li>
        </ul>
      </div>
    </div>
  );
};

export default TelegramSettings;
