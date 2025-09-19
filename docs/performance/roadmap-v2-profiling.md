# Roadmap V2 Rendering Profiling

Profiling was collected with the reusable Jest harness in `react-app/src/components/visualization/__tests__/RoadmapV2.profile.test.tsx`.

Run command:

```bash
ROADMAP_PROFILE=1 ROADMAP_PROFILE_GOALS=<count> npm test -- --watchAll=false --testPathPattern=RoadmapV2.profile
```

## Results Summary

| Goal Count | Baseline Total (ms) | Optimized Total (ms) | Δ | Notes |
|------------|---------------------|----------------------|----|-------|
| 24         | 52.46               | 59.02                | +6.56 | Additional detail rendering at week zoom introduces a small overhead for small datasets. |
| 60         | 73.22               | 50.92                | -22.30 | Lane virtualization and memoized layout reduce initial render cost by ~30%. |

Baseline values were captured from main before applying the optimizations. Optimized values reflect the current `feat/roadmap-optimized-auto-scroll` branch.

Both runs were executed on the local environment via the profiling harness and the console output from the test runner.
