/**
 * SprintMultiSelect — reusable multi-select sprint filter dropdown.
 * Mirrors ThemeMultiSelect / YearMultiSelect patterns.
 * Uses raw <input type="checkbox"> for reliable visibility.
 *
 * Props:
 *   selectedIds  — currently selected sprint IDs (empty = all)
 *   onChange     — called with new set of IDs
 *   sprints      — sprint list to display; pass from useSprint() or local state
 *   allSprints   — when true, all sprints are selected regardless of selectedIds
 *   onAllChange  — toggle "all sprints"
 */

import React from 'react';
import { Dropdown } from 'react-bootstrap';
import type { Sprint } from '../../types';

interface SprintMultiSelectProps {
  sprints: Sprint[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  allSprints?: boolean;
  onAllChange?: (all: boolean) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  size?: 'sm' | 'lg';
}

function sprintStatusDot(sprint: Sprint): string {
  switch (sprint.status) {
    case 1: return '🟢'; // Active
    case 2: return '✅'; // Complete
    case 3: return '❌'; // Cancelled
    default: return '🔵'; // Planned
  }
}

const SprintMultiSelect: React.FC<SprintMultiSelectProps> = ({
  sprints,
  selectedIds,
  onChange,
  allSprints = false,
  onAllChange,
  placeholder = 'All sprints',
  style,
  size = 'sm',
}) => {
  const label = allSprints || selectedIds.length === 0
    ? placeholder
    : selectedIds.length <= 2
      ? sprints
          .filter(s => selectedIds.includes(s.id))
          .map(s => s.name || s.id)
          .join(', ')
      : `${selectedIds.length} sprints`;

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds, id]
      : selectedIds.filter(x => x !== id);
    onChange(next);
    if (checked && allSprints && onAllChange) onAllChange(false);
  };

  return (
    <Dropdown autoClose="outside">
      <Dropdown.Toggle
        variant="outline-secondary"
        size={size}
        style={{ minWidth: 140, ...style }}
        className="text-truncate"
      >
        {label}
      </Dropdown.Toggle>
      <Dropdown.Menu style={{ maxHeight: 380, overflowY: 'auto', minWidth: 220, padding: '4px 0' }}>
        {/* All sprints */}
        <label
          className="d-flex align-items-center gap-2 px-3 py-1"
          style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
        >
          <input
            type="checkbox"
            checked={allSprints || selectedIds.length === 0}
            onChange={e => {
              if (e.target.checked) {
                onChange([]);
                onAllChange?.(true);
              }
            }}
            style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
          />
          <span className="small fw-medium">{placeholder}</span>
        </label>
        <Dropdown.Divider className="my-1" />
        {sprints.length === 0 && (
          <div className="text-muted small px-3 py-1">No sprints</div>
        )}
        {sprints.map(s => (
          <label
            key={s.id}
            className="d-flex align-items-center gap-2 px-3 py-1"
            style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
          >
            <input
              type="checkbox"
              checked={allSprints || selectedIds.includes(s.id)}
              onChange={e => toggle(s.id, e.target.checked)}
              style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
            />
            <span className="small">
              {sprintStatusDot(s)}{' '}
              {(s as any).name || s.id}
            </span>
          </label>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default SprintMultiSelect;
