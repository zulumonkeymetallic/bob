import React, { useCallback, useRef } from 'react';
import { Button } from 'react-bootstrap';
import { FolderOpen } from 'lucide-react';
import { firebaseConfig } from '../../firebase';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export interface DriveFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
}

interface DrivePickerButtonProps {
  onSelect: (file: DriveFile) => void;
  disabled?: boolean;
  label?: string;
}

const PICKER_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const CLIENT_ID = process.env.REACT_APP_GOOGLE_OAUTH_CLIENT_ID || '';
const API_KEY = (process.env.REACT_APP_GOOGLE_PICKER_API_KEY || firebaseConfig.apiKey) as string;

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) { resolve(); return; }
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

const DrivePickerButton: React.FC<DrivePickerButtonProps> = ({ onSelect, disabled, label = 'Drive' }) => {
  const accessTokenRef = useRef<string | null>(null);

  const openPicker = useCallback(async () => {
    if (!CLIENT_ID) {
      console.warn('DrivePickerButton: REACT_APP_GOOGLE_OAUTH_CLIENT_ID is not set.');
      return;
    }

    try {
      // Load Google API client + Google Identity Services
      await Promise.all([
        loadScript('https://apis.google.com/js/api.js', 'bob-gapi-script'),
        loadScript('https://accounts.google.com/gsi/client', 'bob-gis-script'),
      ]);

      // Load gapi picker module
      await new Promise<void>((resolve) => {
        window.gapi.load('picker', { callback: resolve });
      });

      // Request an OAuth access token with drive.readonly scope
      const token = await new Promise<string>((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: PICKER_SCOPE,
          callback: (response: any) => {
            if (response.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }
            accessTokenRef.current = response.access_token;
            resolve(response.access_token);
          },
        });
        // Skip the account chooser on subsequent calls if we already have a token
        tokenClient.requestAccessToken(
          accessTokenRef.current ? { prompt: '' } : { prompt: 'select_account' }
        );
      });

      // Build the Picker UI
      const docsView = new window.google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);

      const picker = new window.google.picker.PickerBuilder()
        .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
        .setOAuthToken(token)
        .setDeveloperKey(API_KEY)
        .addView(docsView)
        .setTitle('Select a document')
        .setCallback((data: any) => {
          const { ACTION, PICKED } = window.google.picker.Response
            ? { ACTION: window.google.picker.Response.ACTION, PICKED: window.google.picker.Action.PICKED }
            : { ACTION: 'action', PICKED: 'picked' };

          if (data[ACTION] === PICKED || data.action === 'picked') {
            const docData = data[window.google.picker.Response.DOCUMENTS]?.[0] ?? data.docs?.[0];
            if (docData) {
              onSelect({
                id: docData[window.google.picker.Document.ID] ?? docData.id,
                name: docData[window.google.picker.Document.NAME] ?? docData.name,
                url: docData[window.google.picker.Document.URL] ?? docData.url,
                mimeType: docData[window.google.picker.Document.MIME_TYPE] ?? docData.mimeType ?? '',
              });
            }
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      console.error('DrivePickerButton error:', err);
    }
  }, [onSelect]);

  // Don't render anything if the OAuth client ID is not configured
  if (!CLIENT_ID) return null;

  return (
    <Button
      variant="outline-secondary"
      size="sm"
      onClick={openPicker}
      disabled={disabled}
      title="Browse Google Drive"
      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      <FolderOpen size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
      {label}
    </Button>
  );
};

export default DrivePickerButton;
