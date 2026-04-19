Title: Audio Goal Chat (voice capture + transcription)

Description
- Add optional audio entry for the goal chat: hold-to-record or upload voice note → transcribe → feed into the same clarifications/orchestration loop.
- Optimise for mobile overlay UI; allow hands-free “continue” prompts.

Acceptance Criteria
- [ ] Mic capture button in Goal Chat modal (desktop + mobile overlay).
- [ ] Transcription via provider (e.g., Whisper/ASR) with retry + latency budget.
- [ ] Transcripts appear as user messages; user can edit before sending to LLM.
- [ ] Privacy: store raw audio behind a short-lived URL or delete after successful transcript.
- [ ] Feature flag `audioGoalChatEnabled` and graceful fallback if device has no mic permissions.

Technical Plan
- UI: add `MicButton` with recording state and waveform; integrate in `GoalChatModal`.
- Functions: new callable `transcribeAudio` (uploads signed URL → returns text); feed result to `sendGoalChatMessage`.
- Storage: temporary `/uploads/audio/{uid}/{session}` with TTL; delete on success.
- Error handling: show partial transcript if full fails; allow manual correction.

Links
- Relates to: #309 (AI Goal Chat), #305 (Orchestration), #307 (Roadmap UI)

