**Issue Title:** Bug: Missing Firestore Index for `generateDailyDigest`

**Description:**
The `generateDailyDigest` Cloud Function is failing due to a missing composite Firestore index. The function's query requires a specific index that has not been created in the Firestore database.

**Error Message from Logs:**
`9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/bob20250810/firestore/indexes?create_composite=Cklwcm9qZWN0cy9ib2IyMDUwODEwL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy90YXNrcy9pbmRleGVzL19FQUFhDAoIb3duZXJVaWQQARoKCgZzdGF0dXMQARoMCghwcmlvcml0eRACGgsKB2R1ZURhdGUQAhoMCghfX25hbWVfXxAC .`

**Impact:**
- The `generateDailyDigest` function will fail to execute its queries, preventing it from generating daily digests for users.
- Users will not receive their daily digest emails or notifications.

**Steps to Reproduce:**
1. Trigger the `generateDailyDigest` Cloud Function.
2. Observe the Firebase Function logs for the `FAILED_PRECONDITION` error related to a missing index.

**Suggested Fix:**
Create the composite Firestore index using the link provided in the error message:
`https://console.firebase.google.com/v1/r/project/bob20250810/firestore/indexes?create_composite=Cklwcm9qZWN0cy9ib2IyMDUwODEwL2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy90YXNrcy9pbmRleGVzL19FQUFhDAoIb3duZXJVaWQQARoKCgZzdGF0dXMQARoMCghwcmlvcml0eRACGgsKB2R1ZURhdGUQAhoMCghfX25hbWVfXxAC .`