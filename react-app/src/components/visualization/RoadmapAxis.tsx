import React from 'react';
import { AxisBottom } from '@visx/axis';
import { scaleTime } from '@visx/scale';
import { useRoadmapStore } from '../../stores/roadmapStore';

type Props = {
  height?: number;
};

const RoadmapAxis: React.FC<Props> = ({ height = 34 }) => {
  const { start, end, width, zoom } = useRoadmapStore();

  // Ticks by zoom level
  const ticks: Date[] = [];
  const current = new Date(start);
  if (zoom === 'week') {
    current.setHours(0,0,0,0);
    while (current <= end) {
      ticks.push(new Date(current));
      current.setDate(current.getDate() + 7);
    }
  } else if (zoom === 'month') {
    current.setDate(1);
    while (current <= end) {
      ticks.push(new Date(current));
      current.setMonth(current.getMonth() + 1);
    }
  } else if (zoom === 'quarter' || zoom === 'half' || zoom === 'year') {
    current.setMonth(Math.floor(current.getMonth() / 3) * 3, 1);
    while (current <= end) {
      ticks.push(new Date(current));
      current.setMonth(current.getMonth() + 3);
    }
  }

  const s = scaleTime<number>({ domain: [start, end], range: [0, Math.max(1, width)] });

  return (
    <div className="roadmap-axis" style={{ width, height, position: 'relative' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <AxisBottom
          top={height - 1}
          scale={s}
          numTicks={Math.min(16, ticks.length)}
          tickValues={ticks}
          tickFormat={(d) => {
            const dd = new Date(String(d));
            if (zoom === 'week') return dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (zoom === 'month') return dd.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            const q = Math.floor(dd.getMonth() / 3) + 1;
            return `Q${q} ${dd.getFullYear()}`;
          }}
          stroke="var(--line)"
          tickStroke="var(--line)"
          tickLabelProps={() => ({ fill: 'var(--text)', fontSize: 12, textAnchor: 'middle', dy: '0.25em' })}
        />
      </svg>
    </div>
  );
};

export default RoadmapAxis;
