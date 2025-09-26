**Description**
Allow users to paste text into BOB and automatically convert it into tasks and stories.

**Acceptance Criteria**
- [ ] User can paste text into a modal.
- [ ] Lines of text are parsed into tasks.
- [ ] Tasks are linked to a goal/story selected in the modal.
- [ ] Default due date is set to tomorrow unless specified.

**Proposed Technical Implementation**
- Add React modal for quick import.
- Use Firebase Functions with GPT API to parse free text into structured tasks.
- Store imported tasks in Firestore (`/tasks`) with metadata.
- Auto-link to current sprint if no story specified.
