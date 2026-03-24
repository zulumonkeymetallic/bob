/**
 * YearMultiSelect — reusable multi-select year filter dropdown.
 * Defaults to current year + next 2 years (matching GoalsYearPlanner behaviour).
 * Uses raw <input type="checkbox"> for reliable visibility.
 */

import React from 'react';
import { Dropdown } from 'react-bootstrap';

interface YearMultiSelectProps {
  availableYears: number[];
  selectedYears: number[];
  onChange: (years: number[]) => void;
  /** When true, all years are shown regardless of selectedYears */
  allYears?: boolean;
  onAllYearsChange?: (all: boolean) => void;
  showNoYear?: boolean;
  onShowNoYearChange?: (show: boolean) => void;
  style?: React.CSSProperties;
  size?: 'sm' | 'lg';
}

export const YearMultiSelect: React.FC<YearMultiSelectProps> = ({
  availableYears,
  selectedYears,
  onChange,
  allYears = false,
  onAllYearsChange,
  showNoYear = false,
  onShowNoYearChange,
  style,
  size = 'sm',
}) => {
  const currentYear = new Date().getFullYear();

  const label = allYears
    ? 'All years'
    : selectedYears.length === 0
      ? 'No year'
      : selectedYears.length <= 3
        ? selectedYears.sort((a, b) => a - b).join(', ')
        : `${selectedYears.length} years`;

  const toggle = (year: number, checked: boolean) => {
    const next = checked
      ? [...selectedYears, year]
      : selectedYears.filter(y => y !== year);
    onChange(next);
    if (checked && allYears && onAllYearsChange) onAllYearsChange(false);
  };

  return (
    <Dropdown autoClose="outside">
      <Dropdown.Toggle
        variant="outline-secondary"
        size={size}
        style={{ minWidth: 140, ...style }}
      >
        {label}
      </Dropdown.Toggle>
      <Dropdown.Menu style={{ maxHeight: 360, overflowY: 'auto', minWidth: 180, padding: '4px 0' }}>
        {/* All years */}
        <label
          className="d-flex align-items-center gap-2 px-3 py-1"
          style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
        >
          <input
            type="checkbox"
            checked={allYears}
            onChange={e => onAllYearsChange?.(e.target.checked)}
            style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
          />
          <span className="small fw-medium">All years</span>
        </label>
        {onShowNoYearChange && (
          <label
            className="d-flex align-items-center gap-2 px-3 py-1"
            style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
          >
            <input
              type="checkbox"
              checked={showNoYear}
              onChange={e => onShowNoYearChange(e.target.checked)}
              style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
            />
            <span className="small text-muted">Include no-date goals</span>
          </label>
        )}
        <Dropdown.Divider className="my-1" />
        {availableYears.map(y => (
          <label
            key={y}
            className="d-flex align-items-center gap-2 px-3 py-1"
            style={{ cursor: 'pointer', margin: 0, userSelect: 'none' }}
          >
            <input
              type="checkbox"
              checked={allYears || selectedYears.includes(y)}
              onChange={e => toggle(y, e.target.checked)}
              style={{ cursor: 'pointer', flexShrink: 0, width: 14, height: 14 }}
            />
            <span className="small">
              {y}
              {y === currentYear && (
                <span className="text-muted ms-1" style={{ fontSize: '0.7rem' }}>this year</span>
              )}
            </span>
          </label>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default YearMultiSelect;
