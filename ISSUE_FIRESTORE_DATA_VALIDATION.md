**Issue Title:** Bug: Firestore Data Validation Error in `planCalendar` and `generateStoriesForGoal`

**Description:**
The `planCalendar` and `generateStoriesForGoal` Cloud Functions are encountering a Firestore data validation error: `Cannot use "undefined" as a Firestore value (found in field "context.metadata")`.

This error indicates that the functions are attempting to write `undefined` values to Firestore documents, which is not permitted by Firestore. This suggests a bug in the function's code where data is not being properly validated or transformed before being sent to Firestore, specifically when logging AI usage or other operations involving the `context.metadata` field.

**Impact:**
- These functions will fail when attempting to log AI usage or other operations involving the `context.metadata` field.
- This can lead to incomplete logging and potential issues with AI-driven features.

**Steps to Reproduce:**
1. Trigger the `planCalendar` Cloud Function.
2. Trigger the `generateStoriesForGoal` Cloud Function.
3. Observe the Firebase Function logs for the error message: `Cannot use "undefined" as a Firestore value (found in field "context.metadata")`.

**Suggested Fix:**
Review the code for `planCalendar` and `generateStoriesForGoal` to ensure that all data being written to Firestore is properly defined and does not contain `undefined` values. Implement checks or transformations to handle potentially `undefined` data before writing to Firestore.