/**
 * DriveFilesModal — the standalone "browse this item's files" dialog, opened from GlobalSidebar.
 *
 * The browsing itself lives in DriveFilesPanel, which the edit modals embed in their right-hand
 * column. This file is the modal chrome around the same component: two copies of the breadcrumb,
 * listing and empty-state logic would drift, and the panel is the version that has to be careful
 * about not creating folders as a side effect of rendering.
 *
 * Read-only by design for now. Listing and opening are safe; upload, rename and delete are
 * destructive operations against the user's real Drive with no undo — those belong in a
 * deliberate second pass, not bundled into "let me see the files".
 */
import React from 'react';
import { Modal, Button } from 'react-bootstrap';
import { Folder } from 'lucide-react';
import DriveFilesPanel from './DriveFilesPanel';
import type { DriveEntityType } from '../../services/driveService';

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
}) => (
  <Modal show={show} onHide={onClose} size="lg" centered scrollable>
    <Modal.Header closeButton>
      <Modal.Title className="d-flex align-items-center gap-2" style={{ fontSize: 18 }}>
        <Folder size={18} />
        Files
      </Modal.Title>
    </Modal.Header>

    <Modal.Body>
      {/* Keyed on `show` so reopening re-reads: the file organiser may have filed something
          into this folder since it was last looked at. */}
      {show && (
        <DriveFilesPanel
          key={`${entityType}:${entityId}`}
          entityType={entityType}
          entityId={entityId}
          entityLabel={entityLabel}
          bare
          maxHeight={420}
        />
      )}
    </Modal.Body>

    <Modal.Footer>
      <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
    </Modal.Footer>
  </Modal>
);

export default DriveFilesModal;
