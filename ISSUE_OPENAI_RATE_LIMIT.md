**Issue Title:** Bug: OpenAI API Rate Limit Error in `generateGoalStoriesAndKPIs`

**Description:**
The `generateGoalStoriesAndKPIs` Cloud Function is experiencing OpenAI API rate limit errors. This indicates that the function is making too many requests to the OpenAI API within a given time frame, exceeding the allowed limits.

**Impact:**
- The function may not be able to complete its task of generating goal stories and KPIs, leading to incomplete data or delayed processing.
- This can negatively affect the user experience and the accuracy of AI-generated content.

**Steps to Reproduce:**
1. Trigger the `generateGoalStoriesAndKPIs` Cloud Function multiple times in quick succession, or with a large volume of data.
2. Observe the Firebase Function logs for OpenAI API rate limit error messages.

**Suggested Solutions:**
- **Increase OpenAI API Rate Limits:** If possible, request an increase in the API rate limits from OpenAI.
- **Implement Retry Mechanisms with Exponential Backoff:** Modify the function to automatically retry API calls with increasing delays between retries when a rate limit error is encountered.
- **Optimize API Calls:** Review the function's logic to identify opportunities to reduce the number of API calls or batch requests more efficiently.