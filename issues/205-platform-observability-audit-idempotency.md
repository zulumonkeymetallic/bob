# 205 – Platform: Observability, Audit Trail, and Idempotency Keys

## Summary
Add structured logging, tracing, and idempotency to all integrations and schedulers.

## Acceptance Criteria
- Each external call logged with correlation IDs; retries safe via idempotency keys.
- User‑visible audit of schedule changes.

## Proposed Technical Approach
- OpenTelemetry in Functions; BigQuery sink for logs; idempotency table keyed by request hash.

## Testing & QA
- Load tests and replay harness.

