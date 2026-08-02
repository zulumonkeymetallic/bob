/**
 * DriveFilesModal — browse the Google Drive folder belonging to a goal, story or task.
 *
 * The folder is resolved by the server (functions/driveHierarchy.js), which creates the
 * BOB-Files/{Theme}/{Goal}/{Story}/ chain on demand. So opening this on a goal that has never
 * had a folder is not an error state — it is how the folder comes to exist.
 *
 * Read-only by design for now. Listing and opening are safe; upload, rename and delete are
 * destructive operations against the user's real Drive, and there is no undo — those belong in
 * a deliberate second pass, not bundled into "let me see the files".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Button, Spinner, Alert } from 'react-bootstrap';
import { ChevronRight, ExternalLink, File as FileIcon, Folder, RefreshCw } from 'lucide-react';
import {
  DriveNotConnectedError,
  driveFolderUrl,
  ensureDriveFolder,
  formatFileSize,
  listDriveFolder,
  type DriveEntityType,
  type DriveFile,
} from '../../services/driveService';
import { themeVars } from '../../utils/themeVars';

interface Crumb {
  id: string;
  name: string;
}

interface DriveFilesModalProps {
  show: boolean;
  onClose: () => void;
  entityType: DriveEntityType;
  entityId: string;
  /** Shown as the first breadcrumb — the entity's own folder. */
  entityLabel: string;
}

const DriveFilesModal: React.FC<DriveFilesModalProps> = ({
  show, onClose, entityType, entityId, entityLabel,
}) => {
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);

  const current = trail[trail.length - 1] || null;

  const load = useCallback(async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      const listing = await listDriveFolder(folderId);
      setFiles(listing.files);
    } catch (err: any) {
      setNotConnected(err instanceof DriveNotConnectedError);
      setError(err?.message || 'Could not list this folder');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Resolve the entity's folder on open, then list it. Deliberately keyed on `show` as well as
   * the entity: reopening on the same story should re-read, because Hermes' file organiser may
   * have filed something into it since.
   */
  useEffect(() => {
    if (!show || !entityId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotConnected(false);
    setFiles([]);
    setTrail([]);

    ensureDriveFolder(entityType, entityId)
      .then(({ folderId }) => {
        if (cancelled) return;
        setTrail([{ id: folderId, name: entityLabel }]);
        return load(folderId);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setNotConnected(err instanceof DriveNotConnectedError);
        setError(err?.message || 'Could not open the Drive folder');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [show, entityType, entityId, entityLabel, load]);

  const openFolder = (file: DriveFile) => {
    setTrail((prev) => [...prev, { id: file.id, name: file.name }]);
    load(file.id);
  };

  const jumpTo = (index: number) => {
    const target = trail[index];
    if (!target) return;
    setTrail((prev) => prev.slice(0, index + 1));
    load(target.id);
  };

  return (
    <Modal show={show} onHide={onClose} size="lg" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2" style={{ fontSize: 18 }}>
          <Folder size={18} />
          Files
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {/* Breadcrumb. The first crumb is the entity's own folder, so there is always something
            to go back to and no way to navigate above what this entity owns. */}
        <div className="d-flex align-items-center flex-wrap gap-1 mb-3" style={{ fontSize: 13 }}>
          {trail.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <ChevronRight size={13} style={{ color: themeVars.muted as string }} />}
              <button
                type="button"
                onClick={() => jumpTo(i)}
                disabled={i === trail.length - 1}
                style={{
                  background: 'none', border: 'none', padding: '2px 4px', cursor: i === trail.length - 1 ? 'default' : 'pointer',
                  color: i === trail.length - 1 ? (themeVars.text as string) : 'var(--brand, #5f77dc)',
                  fontWeight: i === trail.length - 1 ? 600 : 400,
                }}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
          <div className="ms-auto d-flex gap-1">
            {current && (
              <>
                <Button size="sm" variant="outline-secondary" onClick={() => load(current.id)} title="Refresh">
                  <RefreshCw size={13} />
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  href={driveFolderUrl(current.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open this folder in Google Drive"
                >
                  <ExternalLink size={13} className="me-1" />Drive
                </Button>
              </>
            )}
          </div>
        </div>

        {error && (
          <Alert variant={notConnected ? 'warning' : 'danger'} className="py-2">
            <div className="small">{error}</div>
          </Alert>
        )}

        {loading && (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
            <div className="small mt-2" style={{ color: themeVars.muted as string }}>
              {trail.length ? 'Loading files…' : 'Opening Drive folder…'}
            </div>
          </div>
        )}

        {!loading && !error && files.length === 0 && (
          <div className="text-center py-4 small" style={{ color: themeVars.muted as string }}>
            This folder is empty.
            <div className="mt-1">
              Files land here when the file organiser matches something to this item, or you can
              add them in Drive directly.
            </div>
          </div>
        )}

        {!loading && files.length > 0 && (
          <div style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 6, overflow: 'hidden' }}>
            {files.map((file, i) => (
              <div
                key={file.id}
                onClick={() => file.isFolder && openFolder(file)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderTop: i === 0 ? undefined : '1px solid var(--line, #e5e7eb)',
                  cursor: file.isFolder ? 'pointer' : 'default',
                  fontSize: 13,
                }}
              >
                {file.isFolder
                  ? <Folder size={15} style={{ color: 'var(--brand, #5f77dc)', flexShrink: 0 }} />
                  : <FileIcon size={15} style={{ color: themeVars.muted as string, flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </span>
                {file.size != null && (
                  <span style={{ fontSize: 11, color: themeVars.muted as string, flexShrink: 0 }}>
                    {formatFileSize(file.size)}
                  </span>
                )}
                {file.modifiedTime && (
                  <span style={{ fontSize: 11, color: themeVars.muted as string, flexShrink: 0 }}>
                    {new Date(file.modifiedTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </span>
                )}
                {file.webViewLink && !file.isFolder && (
                  <a
                    href={file.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="Open in Google Drive"
                    style={{ color: themeVars.muted as string, lineHeight: 0, flexShrink: 0 }}
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DriveFilesModal;
