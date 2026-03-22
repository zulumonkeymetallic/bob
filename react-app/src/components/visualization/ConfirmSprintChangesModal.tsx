import React from 'react';
import { Modal, Button, Alert, Badge, Table } from 'react-bootstrap';
import { AlertTriangle } from 'lucide-react';
import type { GoalTimelineAffectedStory } from './goalTimelineImpact';

interface Props {
  visible: boolean;
  pendingChanges: {
    goalId: string;
    startDate: number;
    endDate: number;
    affectedStories: GoalTimelineAffectedStory[];
  } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmSprintChangesModal: React.FC<Props> = ({
  visible,
  pendingChanges,
  onConfirm,
  onCancel,
}) => {
  if (!pendingChanges) return null;

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const movable = pendingChanges.affectedStories.filter(
    (s) => s.recommendedSprintId && s.recommendedSprintId !== s.plannedSprintId,
  );
  const unchanged = pendingChanges.affectedStories.filter(
    (s) => s.recommendedSprintId && s.recommendedSprintId === s.plannedSprintId,
  );
  const manual = pendingChanges.affectedStories.length - movable.length - unchanged.length;

  const outcomeVariant = (story: GoalTimelineAffectedStory) => {
    if (!story.recommendedSprintId) return 'secondary';
    return story.recommendedSprintId === story.plannedSprintId ? 'success' : 'warning';
  };
  const outcomeLabel = (story: GoalTimelineAffectedStory) => {
    if (!story.recommendedSprintId) return 'Manual review';
    return story.recommendedSprintId === story.plannedSprintId ? 'No change' : 'Will move';
  };

  return (
    <Modal show={visible} onHide={onCancel} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2" style={{ fontSize: '1rem' }}>
          <AlertTriangle size={18} className="text-warning" />
          Confirm Sprint Changes
        </Modal.Title>
      </Modal.Header>

      <Modal.Body className="vstack gap-3">
        <Alert variant="warning" className="mb-0">
          Changing this goal's timeline will evaluate{' '}
          <strong>{pendingChanges.affectedStories.length}</strong> linked{' '}
          {pendingChanges.affectedStories.length === 1 ? 'story' : 'stories'} and move each one to
          the sprint with the closest start date where a recommendation is available.
        </Alert>

        <div>
          <div className="fw-semibold small text-muted text-uppercase mb-2" style={{ letterSpacing: '0.05em' }}>
            Timeline Changes
          </div>
          <div className="d-flex gap-4 small">
            <div>
              <span className="text-muted">New start:</span>{' '}
              <strong>{formatDate(pendingChanges.startDate)}</strong>
            </div>
            <div>
              <span className="text-muted">New end:</span>{' '}
              <strong>{formatDate(pendingChanges.endDate)}</strong>
            </div>
          </div>
        </div>

        <div>
          <div className="fw-semibold small text-muted text-uppercase mb-2" style={{ letterSpacing: '0.05em' }}>
            Affected Stories
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <Table size="sm" bordered className="mb-0" style={{ fontSize: '0.8rem' }}>
              <thead className="table-light">
                <tr>
                  <th>Story</th>
                  <th>Current Sprint</th>
                  <th>Recommended Sprint</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {pendingChanges.affectedStories.map((story) => (
                  <tr key={story.id}>
                    <td>
                      <div className="fw-medium">{story.ref}</div>
                      <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {story.title}
                      </div>
                      {typeof story.impactedTaskCount === 'number' && story.impactedTaskCount > 0 && (
                        <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                          {story.impactedTaskCount} linked task{story.impactedTaskCount !== 1 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td className="text-muted">{story.plannedSprintName || story.plannedSprintId || 'Unassigned'}</td>
                    <td className="text-muted">{story.recommendedSprintName || story.recommendedSprintId || '—'}</td>
                    <td>
                      <Badge bg={outcomeVariant(story)} text={outcomeVariant(story) === 'warning' ? 'dark' : undefined}>
                        {outcomeLabel(story)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>

        <Alert variant="info" className="mb-0 small">
          <strong>On confirm:</strong>{' '}
          {movable.length} {movable.length === 1 ? 'story' : 'stories'} will be reassigned automatically.
          {unchanged.length > 0 && ` ${unchanged.length} ${unchanged.length === 1 ? 'story is' : 'stories are'} already in the correct sprint.`}
          {manual > 0 && ` ${manual} ${manual === 1 ? 'story has' : 'stories have'} no recommendation and will stay put for manual review.`}
        </Alert>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Confirm and Move Stories
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ConfirmSprintChangesModal;
