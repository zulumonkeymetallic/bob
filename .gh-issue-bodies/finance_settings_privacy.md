**Description**
Give user full control of Monzo connectivity and data.

**Acceptance Criteria**
- [ ] Settings page to connect/disconnect Monzo and choose Pots.
- [ ] Delete Finance Data wipes `/finance/*` and revokes tokens.
- [ ] GDPR export available.
- [ ] Tokens encrypted at rest.

**Proposed Technical Implementation**
- Settings UI in Finance.
- Callable function to revoke Monzo access.
- Firestore rules limit finance collections to owner UID.
- Audit logs stored in `/logs/audit`.
