import React, { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';

interface Props {
  visible: boolean;
  onClose: () => void;
  themes: string[];
  goals: string[];
}

const ShareLinkDialog: React.FC<Props> = ({ visible, onClose, themes, goals }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [expiryDays, setExpiryDays] = useState(7);
  const [loading, setLoading] = useState(false);

  const generateShareLink = async () => {
    setLoading(true);
    try {
      // TODO: Call API to generate share token
      const token = `share_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const url = `${window.location.origin}/share/viz/${token}?themes=${themes.join(',')}&goals=${goals.join(',')}`;
      setShareUrl(url);
    } catch (error) {
      console.error('Error generating share link:', error);
      alert('Failed to generate share link');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('Failed to copy to clipboard');
    }
  };

  React.useEffect(() => {
    if (visible && !shareUrl) {
      generateShareLink();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="rounded-lg shadow-xl max-w-md w-full mx-4" style={{ backgroundColor: 'var(--panel)', border: '1px solid var(--line)' }}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">Share Visualization</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Share a read-only view of your goal visualization with others.
            </p>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Expiry
              </label>
              <select
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={1}>1 day</option>
                <option value={7}>1 week</option>
                <option value={30}>1 month</option>
                <option value={90}>3 months</option>
                <option value={0}>Never expires</option>
              </select>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Share URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50"
                placeholder={loading ? "Generating link..." : "Share URL will appear here"}
              />
              <button
                onClick={copyToClipboard}
                disabled={!shareUrl || loading}
                className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          
          <div className="text-xs text-gray-500">
            <p><strong>Included in share:</strong></p>
            <ul className="mt-1 space-y-1">
              <li>• {goals.length} goal(s)</li>
              <li>• {themes.length} theme(s)</li>
              <li>• Current timeline view</li>
            </ul>
            <p className="mt-2">
              <strong>Note:</strong> Recipients will have read-only access and cannot make changes.
            </p>
          </div>
        </div>
        
        <div className="flex justify-end gap-3 p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={generateShareLink}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Regenerate Link'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareLinkDialog;
