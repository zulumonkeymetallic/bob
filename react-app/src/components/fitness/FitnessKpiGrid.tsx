import React, { useState } from 'react';

export interface FitnessKpiBox {
  key: string;
  pct: number | null;
  tooltip: string;
}

export interface FitnessKpiRow {
  label: string;
  summaryText: string;
  boxes: FitnessKpiBox[];
}

interface Props {
  rows: FitnessKpiRow[];
}

const BOX_SIZE = 13;
const BOX_GAP = 2;
const LABEL_WIDTH = 96;

function boxColor(pct: number | null): string {
  if (pct == null) return '#374151';
  if (pct >= 100) return '#22c55e';
  if (pct >= 70) return '#f59e0b';
  return '#ef4444';
}

export default function FitnessKpiGrid({ rows }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: 12,
              color: '#9ca3af',
              width: LABEL_WIDTH,
              minWidth: LABEL_WIDTH,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}>
              {row.label}
            </span>
            <div style={{ display: 'flex', gap: BOX_GAP, flexWrap: 'nowrap', overflowX: 'auto' }}>
              {row.boxes.map((box) => {
                const id = `${row.label}::${box.key}`;
                const isHovered = hoveredId === id;
                return (
                  <div
                    key={box.key}
                    style={{ position: 'relative', flexShrink: 0 }}
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <div
                      style={{
                        width: BOX_SIZE,
                        height: BOX_SIZE,
                        borderRadius: 4,
                        background: boxColor(box.pct),
                        cursor: 'default',
                      }}
                    />
                    {isHovered && (
                      <div style={{
                        position: 'absolute',
                        bottom: BOX_SIZE + 6,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: '#111827',
                        color: '#f9fafb',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        zIndex: 100,
                        pointerEvents: 'none',
                        border: '1px solid #374151',
                      }}>
                        {box.tooltip}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{
            fontSize: 11,
            color: '#6b7280',
            marginTop: 3,
            paddingLeft: LABEL_WIDTH + 12,
          }}>
            {row.summaryText}
          </div>
        </div>
      ))}
    </div>
  );
}
