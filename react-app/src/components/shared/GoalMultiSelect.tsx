/**
 * GoalMultiSelect — reusable multi-select goal filter dropdown.
 * Uses raw <input type="checkbox"> for reliable visibility.
 * Includes a search box for large goal lists.
 *
 * Props:
 *   goals        — list of goals to display
 *   selectedIds  — currently selected goal IDs (empty = all)
 *   onChange     — called with new set of IDs
 *   getLabel     — optional: custom label per goal (default: goal.title)
 */

import React, { useMemo, useState } from 'react';
import { Dropdown } from 'react-bootstrap';
import type { Goal } from '../../types';

interface GoalMultiSelectProps {
  goals: Goal[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  getLabel?: (goal: Goal) => string;
  placeholder?: string;
  style?: React.CSSProperties;
  size?: 'sm' | 'lg';
}

const GoalMultiSelect: React.FC<GoalMultiSelectProps> = ({
  goals,
  selectedIds,
  onChange,
  getLabel,
  placeholder = 'All Goals',
  style,
  size = 'sm',
}) => {
  const [search, setSearch] = useState('');

  const label = selectedIds.length === 0
    ? placeholder
    : selectedIds.length <= 2
      ? goals
          .filter(g => selectedIds.includes(g.id))
          .map(g => getLabel ? getLabel(g) : g.title)
          .join(', ')
      : `${selectedIds.length} goals`;

  const filtered = useMemo(() => {
    if (!search.trim()) return goals;
    const q = search.toLowerCase();
    return goals.filter(g => {
      const lbl = getLabel ? getLabel(g) : g.title;
      return lbl.toLowerCase().includes(q);
    });
  }, [goals, search, getLabel]);

  const toggle = (id: string, checked: boolean) => {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter(x => x !== id));
  };

  return (
    <Dropdown autoClose="outside">
      <Dropdown.Toggle
        variant="outline-secondary"
        size={size}
        style={{ minWidth: 160, ...style }}
        className="text-truncate"
      >
        {label}
      </Dropdown.Toggle>
      <Dropdown.Menu style={{ maxHeight: 400, overflowY: 'auto', minWidth: 260, padding: '4px 0' }}>
        {/* Search */}
        <div className="px-3 pb-2 pt-1 sticky-top bg-white border-bottom">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Search goals…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* All goals */}
        <label
          className="d-flex align-items-center gap-2 px-3 py-1"
          style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
        >
          <input
            type="checkbox"
            checked={selectedIds.length === 0}
            onChange={() => onChange([])}
            style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
          />
          <span className="small fw-medium">{placeholder}</span>
        </label>
        <Dropdown.Divider className="my-1" />

        {filtered.length === 0 && (
          <div className="text-muted small px-3 py-1">No goals found</div>
        )}
        {filtered.map(g => {
          const lbl = getLabel ? getLabel(g) : g.title;
          return (
            <label
              key={g.id}
              className="d-flex align-items-center gap-2 px-3 py-1"
              style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(g.id)}
                onChange={e => toggle(g.id, e.target.checked)}
                style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
              />
              <span className="small text-truncate" title={lbl}>{lbl}</span>
            </label>
          );
        })}
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default GoalMultiSelect;
