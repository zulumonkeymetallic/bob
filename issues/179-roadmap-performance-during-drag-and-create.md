# 179 – Reduce latency during roadmap drag and entity creation

Note: Related epic – see 193 (UI: Merge Card-Based Views & Preserve Terministic Calendar Blocks).

- Type: performance
- Priority: P2 (minor)
- Areas: Roadmap, Creation flows

## Problem
Dragging roadmap cards across multi-year views and creating items exhibits >500 ms lag, especially on lower-powered devices.

## Acceptance Criteria
- Roadmap drag operations respond within 500 ms (p95).
- Creating goals/stories/tasks returns control to the user within 500 ms with loading feedback.

## Technical Notes
- Throttle drag events; use memoisation and virtualization where possible.
- Avoid full data reloads after creates; append to local state and let listeners confirm.
