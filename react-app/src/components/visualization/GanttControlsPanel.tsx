import React from 'react';
import { Card, Button, Form } from 'react-bootstrap';
import { ZoomIn, ZoomOut, Home, Maximize2, Minimize2, GitBranch } from 'lucide-react';
import SprintSelector from '../SprintSelector';

interface GanttControlsPanelProps {
  selectedSprintId?: string;
  onSprintChange: (id: string) => void;
  zoomPercent: number | null;
  onZoomPercentChange: (p: number | null) => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToday: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  showDependencyLines: boolean;
  onToggleDependencyLines: (val: boolean) => void;
  autoFitSprintGoals: boolean;
  onToggleAutoFit: (val: boolean) => void;
  metrics?: {
    label: string;
    daysText: string;
    stories: { done: number; total: number };
    goalsWithStories: number;
    progressPct: number;
  };
}

const percentOptions = [25, 50, 75, 90, 100, 125, 150, 200];

const GanttControlsPanel: React.FC<GanttControlsPanelProps> = ({
  selectedSprintId,
  onSprintChange,
  zoomPercent,
  onZoomPercentChange,
  onFit,
  onZoomIn,
  onZoomOut,
  onToday,
  fullscreen,
  onToggleFullscreen,
  showDependencyLines,
  onToggleDependencyLines,
  autoFitSprintGoals,
  onToggleAutoFit,
  metrics
}) => {
  return (
    <div style={{ width: 260, flex: '0 0 260px' }} className="me-3">
      <Card className="border-0 shadow-sm">
        <Card.Header className="bg-white">
          <strong>Timeline Controls</strong>
        </Card.Header>
        <Card.Body className="d-flex flex-column gap-3">
          <div>
            <div className="mb-1 small text-muted">Sprint</div>
            <SprintSelector selectedSprintId={selectedSprintId} onSprintChange={onSprintChange} />
            {metrics && (
              <div className="mt-2 d-flex flex-wrap align-items-center gap-2">
                <span className="badge rounded-pill bg-light text-dark border" title="Timing">
                  {metrics.daysText}
                </span>
                <span className="badge rounded-pill bg-danger-subtle text-danger border" title="Stories done/total">
                  {metrics.stories.done}/{metrics.stories.total}
                </span>
                <span className="badge rounded-pill bg-info-subtle text-info border" title="Goals with stories">
                  {metrics.goalsWithStories}
                </span>
                <span className="badge rounded-pill bg-secondary-subtle text-secondary border" title="Progress %">
                  {metrics.progressPct}%
                </span>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 small text-muted">Zoom</div>
            <div className="d-flex align-items-center gap-2">
              <Form.Select
                size="sm"
                value={zoomPercent ?? 'fit'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'fit') onFit();
                  else onZoomPercentChange(parseInt(v, 10));
                }}
                style={{ width: 120 }}
              >
                <option value="fit">Fit</option>
                {percentOptions.map((p) => (
                  <option key={p} value={p}>{p}%</option>
                ))}
              </Form.Select>
              <Button variant="outline-secondary" size="sm" onClick={onZoomOut} title="Zoom out">
                <ZoomOut size={16} />
              </Button>
              <Button variant="outline-secondary" size="sm" onClick={onZoomIn} title="Zoom in">
                <ZoomIn size={16} />
              </Button>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            <Button variant="outline-primary" size="sm" onClick={onToday} title="Jump to today">
              <Home size={16} />
            </Button>
            <Button
              variant={fullscreen ? 'primary' : 'outline-secondary'}
              size="sm"
              onClick={onToggleFullscreen}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </Button>
          </div>

          <Form.Check
            type="switch"
            id="dep-lines-toggle"
            label={<span className="d-inline-flex align-items-center gap-2"><GitBranch size={14} /> Show links</span> as any}
            checked={showDependencyLines}
            onChange={(e) => onToggleDependencyLines(e.target.checked)}
          />

          <Form.Check
            type="switch"
            id="auto-fit-toggle"
            label="Auto-fit sprint goals"
            checked={autoFitSprintGoals}
            onChange={(e) => onToggleAutoFit(e.target.checked)}
          />
        </Card.Body>
      </Card>
    </div>
  );
};

export default GanttControlsPanel;
