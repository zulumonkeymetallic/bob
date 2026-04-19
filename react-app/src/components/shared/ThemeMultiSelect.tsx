/**
 * ThemeMultiSelect — reusable multi-select theme filter dropdown.
 *
 * Features:
 *  - Color dot before each label
 *  - Travel & Adventure hidden by default (toggle at bottom)
 *  - Visible checkboxes (raw <input type="checkbox">, not Bootstrap Form.Check)
 *  - "All Themes" clears selection
 */

import React, { useState } from 'react';
import { Dropdown } from 'react-bootstrap';
import { GLOBAL_THEMES } from '../../constants/globalThemes';

const TRAVEL_THEME_ID = 7;

interface ThemeMultiSelectProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  size?: 'sm' | 'lg';
}

export const ThemeMultiSelect: React.FC<ThemeMultiSelectProps> = ({
  selectedIds,
  onChange,
  placeholder = 'All Themes',
  style,
  size = 'sm',
}) => {
  const [showTravel, setShowTravel] = useState(false);

  const visibleThemes = showTravel
    ? GLOBAL_THEMES
    : GLOBAL_THEMES.filter(t => t.id !== TRAVEL_THEME_ID);

  const label =
    selectedIds.length === 0
      ? placeholder
      : selectedIds.length <= 2
        ? selectedIds
            .map(id => GLOBAL_THEMES.find(t => t.id === id)?.label ?? `Theme ${id}`)
            .join(', ')
        : `${selectedIds.length} themes`;

  const toggle = (id: number, checked: boolean) => {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter(x => x !== id));
  };

  return (
    <Dropdown autoClose="outside">
      <Dropdown.Toggle
        variant="outline-secondary"
        size={size}
        style={{ minWidth: 160, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', ...style }}
      >
        {label}
      </Dropdown.Toggle>
      <Dropdown.Menu style={{ maxHeight: 420, overflowY: 'auto', minWidth: 220, padding: '4px 0' }}>
        {/* All Themes row */}
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
          <span className="small fw-medium">All Themes</span>
        </label>
        <Dropdown.Divider className="my-1" />

        {visibleThemes.map(theme => (
          <label
            key={theme.id}
            className="d-flex align-items-center gap-2 px-3 py-1"
            style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(theme.id)}
              onChange={e => toggle(theme.id, e.target.checked)}
              style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
            />
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: theme.color,
                flexShrink: 0,
                display: 'inline-block',
              }}
            />
            <span className="small text-truncate">{theme.label}</span>
          </label>
        ))}

        <Dropdown.Divider className="my-1" />
        <button
          type="button"
          className="btn btn-link btn-sm text-muted px-3 py-1"
          style={{ fontSize: '0.75rem', textDecoration: 'none' }}
          onClick={e => { e.stopPropagation(); setShowTravel(v => !v); }}
        >
          {showTravel ? '− Hide travel' : '+ Show travel & adventure'}
        </button>
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default ThemeMultiSelect;
