# 200 – Integration: Steam (Library + Playtime)

## Summary
Pull Steam library and recent playtime to inform leisure blocks and digital‑detox insights.

## Acceptance Criteria
- User links Steam; library and playtime appear; optional inclusion in daily digest.
- No credential storage beyond tokens; adhere to Steam Web API TOS.

## Proposed Technical Approach
- Use Steam Web API (GetOwnedGames, GetRecentlyPlayedGames). Store `steamid`, app list, playtime stats.

## Data Model / Schema
- `leisure/steam_apps`, `leisure/playtime`.

## Testing & QA
- Fixture tests for API shape changes.

