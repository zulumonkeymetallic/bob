/**
 * DriveFilesPanel — the Google Drive folder for a goal, story or task.
 *
 * Embedded in the right-hand column of the edit modals, alongside ActivityStreamPanel, and reused
 * by DriveFilesModal for the standalone case.
 *
 * WHY IT DOES NOT RESOLVE ON MOUNT. The obvious implementation calls ensureDriveFolder when the
 * panel appears, which reads well until you notice ensureDriveFolder *creates* the folder and the
 * whole BOB-Files/{Theme}/{Goal}/ chain above it. The panel renders on every edit-modal open, so
 * that would mean opening a goal to fix a typo silently grows a Drive tree. Instead it looks up
 * (read-only), and creation stays a button the user presses.
 *
 * The three states are therefore: no folder (offer to create), folder found by ref but not yet
 * linked (offer to link), folder linked (list it).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from 'react-bootstrap';
import { ChevronRight, ExternalLink, File as FileIcon, FolderPlus, Folder, Link2, RefreshCw } from 'lucide-react';
import {
  DriveNotConnectedError,
  driveFolderUrl,
  ensureDriveFolder,
  formatFileSize,
  listDriveFolder,
  lookupDriveFolder,
  type DriveEntityType,
  type DriveFile,
} from '../../services/driveService';
import { themeVars } from '../../utils/themeVars';

interface Crumb {
  id: string;
  name: string;
}

interface DriveFilesPanelProps {
  entityType: DriveEntityType;
  entityId?: string | null;
  /** First breadcrumb, and what the create button names. */
  entityLabel: string;
  /** Rendered without the Card chrome when embedded somewhere that already has it. */
  bare?: boolean;
  maxHeight?: number;
  /** Fired after a folder is created or linked, so the parent can refresh its copy of the entity. */
  onFolderResolved?: (folderId: string) => void;
}

const DriveFilesPanel: React.FC<DriveFilesPanelProps> = ({
  entityType, entityId, entityLabel, bare = false, maxHeight = 300, onFolderResolved,
}) => {
  const [trail, setTrail] = useState<Crumb[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [adoptable, setAdoptable] = useState(false);
  const [checked, setChecked] = useState(false);

  const current = trail[trail.length - 1] || null;

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const listing = await listDriveFolder(id);
      setFiles(listing.files);
    } catch (err: any) {
      setNotConnected(err instanceof DriveNotConnectedError);
      setError(err?.message || 'Could not list this folder');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Look up only — never create. See the note at the top of this file.
  useEffect(() => {
    if (!entityId) {
      setChecked(true);
      return;
    }
    let cancelled = false;
    setChecked(false);
    setError(null);
    setNotConnected(false);
    setFiles([]);
    setTrail([]);
    setFolderId(null);
    setAdoptable(false);

    lookupDriveFolder(entityType, entityId)
      .then((result) => {
        if (cancelled) return;
        setChecked(true);
        setAdoptable(result.adopted);
        // An adopted folder is a candidate, not a decision — it is only listed once the user
        // links it, so a bad ref match cannot quietly attach itself to the entity.
        if (result.folderId && !result.adopted) {
          setFolderId(result.folderId);
          setTrail([{ id: result.folderId, name: entityLabel }]);
          return load(result.folderId);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setChecked(true);
        setNotConnected(err instanceof DriveNotConnectedError);
        setError(err?.message || 'Could not check for a Drive folder');
      });

    return () => { cancelled = true; };
  }, [entityType, entityId, entityLabel, load]);

  /** Create the folder, or adopt the one found by ref — ensureDriveFolder does both. */
  const resolveFolder = async () => {
    if (!entityId) return;
    setResolving(true);
    setError(null);
    try {
      const { folderId: id } = await ensureDriveFolder(entityType, entityId);
      setFolderId(id);
      setAdoptable(false);
      setTrail([{ id, name: entityLabel }]);
      onFolderResolved?.(id);
      await load(id);
    } catch (err: any) {
      setNotConnected(err instanceof DriveNotConnectedError);
      setError(err?.message || 'Could not create the Drive folder');
    } finally {
      setResolving(false);
    }
  };

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

  const body = (
    <>
      {!entityId && (
        <div className="text-muted small">Save this item to give it a Drive folder.</div>
      )}

      {entityId && !checked && !error && (
        <div className="d-flex align-items-center gap-2 small" style={{ color: themeVars.muted as string }}>
          <Spinner animation="border" size="sm" /> Checking Drive…
        </div>
      )}

      {error && (
        <Alert variant={notConnected ? 'warning' : 'danger'} className="py-2 mb-2">
          <div className="small">{error}</div>
        </Alert>
      )}

      {/* No folder yet — the prompt Jim asked for, in place rather than as a toast that
          disappears before it can be acted on. */}
      {entityId && checked && !folderId && !error && (
        <div className="small">
          <div className="mb-2" style={{ color: themeVars.muted as string }}>
            {adoptable
              ? 'A Drive folder with this reference already exists.'
              : 'No Drive folder yet for this item.'}
          </div>
          <Button
            size="sm"
            variant={adoptable ? 'outline-primary' : 'outline-secondary'}
            onClick={resolveFolder}
            disabled={resolving}
          >
            {resolving
              ? <><Spinner animation="border" size="sm" className="me-1" />Working…</>
              : adoptable
                ? <><Link2 size={13} className="me-1" />Link existing folder</>
                : <><FolderPlus size={13} className="me-1" />Create Drive folder</>}
          </Button>
        </div>
      )}

      {folderId && (
        <>
          <div className="d-flex align-items-center flex-wrap gap-1 mb-2" style={{ fontSize: 12 }}>
            {trail.map((crumb, i) => (
              <React.Fragment key={crumb.id}>
                {i > 0 && <ChevronRight size={12} style={{ color: themeVars.muted as string }} />}
                <button
                  type="button"
                  onClick={() => jumpTo(i)}
                  disabled={i === trail.length - 1}
                  style={{
                    background: 'none', border: 'none', padding: '1px 3px',
                    cursor: i === trail.length - 1 ? 'default' : 'pointer',
                    color: i === trail.length - 1 ? (themeVars.text as string) : 'var(--brand, #5f77dc)',
                    fontWeight: i === trail.length - 1 ? 600 : 400,
                    maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
            <div className="ms-auto d-flex gap-1">
              {current && (
                <>
                  <Button size="sm" variant="outline-secondary" className="py-0 px-1"
                          onClick={() => load(current.id)} title="Refresh">
                    <RefreshCw size={12} />
                  </Button>
                  <Button
                    size="sm" variant="outline-secondary" className="py-0 px-1"
                    href={driveFolderUrl(current.id)} target="_blank" rel="noopener noreferrer"
                    title="Open in Google Drive"
                  >
                    <ExternalLink size={12} />
                  </Button>
                </>
              )}
            </div>
          </div>

          {loading && (
            <div className="text-center py-3">
              <Spinner animation="border" size="sm" />
            </div>
          )}

          {!loading && files.length === 0 && !error && (
            <div className="small" style={{ color: themeVars.muted as string }}>
              Empty. Files land here when the organiser matches something, or add them in Drive.
            </div>
          )}

          {!loading && files.length > 0 && (
            <div style={{ maxHeight, overflowY: 'auto', border: '1px solid var(--line, #e5e7eb)', borderRadius: 6 }}>
              {files.map((file, i) => (
                <div
                  key={file.id}
                  onClick={() => file.isFolder && openFolder(file)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    borderTop: i === 0 ? undefined : '1px solid var(--line, #e5e7eb)',
                    cursor: file.isFolder ? 'pointer' : 'default',
                    fontSize: 12,
                  }}
                >
                  {file.isFolder
                    ? <Folder size={13} style={{ color: 'var(--brand, #5f77dc)', flexShrink: 0 }} />
                    : <FileIcon size={13} style={{ color: themeVars.muted as string, flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </span>
                  {file.size != null && (
                    <span style={{ fontSize: 10, color: themeVars.muted as string, flexShrink: 0 }}>
                      {formatFileSize(file.size)}
                    </span>
                  )}
                  {file.webViewLink && !file.isFolder && (
                    <a
                      href={file.webViewLink} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()} title="Open in Google Drive"
                      style={{ color: themeVars.muted as string, lineHeight: 0, flexShrink: 0 }}
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );

  if (bare) return body;

  return (
    <Card className="mt-3">
      <Card.Header className="py-2 d-flex align-items-center gap-2">
        <Folder size={15} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>Files</span>
        {files.length > 0 && <Badge bg="secondary" className="ms-auto">{files.length}</Badge>}
      </Card.Header>
      <Card.Body className="p-2">{body}</Card.Body>
    </Card>
  );
};

export default DriveFilesPanel;
