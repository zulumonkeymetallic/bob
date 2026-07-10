import React from 'react';
import { Navigate } from 'react-big-calendar';
// TimeGrid is the same primitive react-big-calendar's own Week/Day views build on.
import TimeGrid from 'react-big-calendar/lib/TimeGrid';

const FIVE_DAY_LENGTH = 5;

interface FiveDayViewProps {
  date: Date;
  localizer: any;
  min?: Date;
  max?: Date;
  scrollToTime?: Date;
  [key: string]: any;
}

type FiveDayViewComponent = React.FC<FiveDayViewProps> & {
  range: (date: Date, ctx: { localizer: any }) => Date[];
  navigate: (date: Date, action: string, ctx: { localizer: any }) => Date;
  title: (date: Date, ctx: { localizer: any }) => string;
};

/**
 * A rolling N-day react-big-calendar view (N=5): unlike the built-in `work_week`
 * view (fixed Mon-Fri), Prev/Next step the window by 1 day so it always shows
 * "today + next 4" style rolling ranges.
 */
const FiveDayView: FiveDayViewComponent = ({ date, localizer, min, max, scrollToTime, ...props }) => {
  const range = FiveDayView.range(date, { localizer });
  const resolvedMin = min || localizer.startOf(new Date(), 'day');
  const resolvedMax = max || localizer.endOf(new Date(), 'day');
  const resolvedScrollToTime = scrollToTime || localizer.startOf(new Date(), 'day');
  return (
    <TimeGrid
      {...props}
      range={range}
      eventOffset={15}
      localizer={localizer}
      min={resolvedMin}
      max={resolvedMax}
      scrollToTime={resolvedScrollToTime}
    />
  );
};

FiveDayView.range = (date, { localizer }) => {
  const start = date;
  const end = localizer.add(start, FIVE_DAY_LENGTH - 1, 'day');
  return localizer.range(start, end);
};

FiveDayView.navigate = (date, action, { localizer }) => {
  switch (action) {
    case Navigate.PREVIOUS:
      return localizer.add(date, -1, 'day');
    case Navigate.NEXT:
      return localizer.add(date, 1, 'day');
    default:
      return date;
  }
};

FiveDayView.title = (date, { localizer }) => {
  const range = FiveDayView.range(date, { localizer });
  const start = range[0];
  const end = range[range.length - 1];
  return localizer.format({ start, end }, 'dayRangeHeaderFormat');
};

(FiveDayView as any).defaultProps = (TimeGrid as any).defaultProps;

export default FiveDayView;
