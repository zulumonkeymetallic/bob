/**
 * planningHorizon — how far ahead the planners are allowed to place work, and how far
 * ahead BOB can actually see.
 *
 * One invariant governs both numbers: NEVER PLAN BEYOND WHAT YOU CAN SEE. Placing an item
 * past the point real Google Calendar events have been synced means placing it blind — the
 * real events arrive on a later sync and land retroactively on top of it. Confirmed live
 * 2026-07-16 twice over: 25 personal items dropped onto real recurring events (swim,
 * sauna, macro logging) that were beyond the horizon at planning time, and separately 227
 * of 251 forward-scheduled items fell into the gap where the planning window (then 90
 * days) outran the window in which work blocks were materialised (then 21).
 *
 * These constants live here, together, because the invariant is a relationship between
 * them and it has already been broken once by three files each holding their own copy
 * behind a comment asking the next reader to keep them in step.
 *
 *   PLANNING_HORIZON_DAYS <= CALENDAR_VISIBILITY_DAYS
 *
 * Planning is deliberately the shorter of the two. A sprint can run 60-90 days, but a
 * calendar filled that far out is noise: the items are unstable, they get re-scored and
 * re-placed nightly anyway, and nothing that far ahead survives contact with a real week.
 * Work beyond the horizon is not lost — it is simply picked up by a later nightly run once
 * it comes inside the window.
 */

'use strict';

// How far ahead a planner may place work. Per Jim, 2026-08-01: a rolling two-to-four week
// window, not a whole sprint. Set at the top of that range.
const PLANNING_HORIZON_DAYS = 30;

// How far ahead real Google Calendar events and recurring instances are synced into
// calendar_blocks — i.e. the furthest out BOB can be trusted to know what is already
// committed. Stays at 90: seeing further than you plan is free and strictly safer, and
// shortening it would blind the conflict checks rather than tidy the calendar.
const CALENDAR_VISIBILITY_DAYS = 90;

if (PLANNING_HORIZON_DAYS > CALENDAR_VISIBILITY_DAYS) {
  throw new Error(
    `planningHorizon: PLANNING_HORIZON_DAYS (${PLANNING_HORIZON_DAYS}) exceeds `
    + `CALENDAR_VISIBILITY_DAYS (${CALENDAR_VISIBILITY_DAYS}) — planners would place work `
    + 'into a window BOB cannot see, which is what caused the 2026-07-16 collisions.',
  );
}

module.exports = { PLANNING_HORIZON_DAYS, CALENDAR_VISIBILITY_DAYS };
