# BOB Merchant Pattern Registry Schema

This document defines the Firestore structure for runtime-editable transaction categorisation rules, allowing users to override default categorisation without code deployments.

## Collection: `merchant_pattern_overrides`

**Path:** `/merchant_pattern_overrides/{pattern_id}`

### Document Structure

```typescript
interface MerchantPatternOverride {
  // Identification
  patternId: string;           // Auto-generated (e.g., "mp_001")
  uid: string;                 // Owner user ID (for multi-tenant)
  
  // Pattern matching
  namePattern: string;         // Regex or substring to match (e.g., "madigans", "four horsemen")
  matchType: 'substring' | 'regex' | 'exact';
  
  // Categorisation mapping
  forcedCategoryKey: string;   // BOB category key (e.g., "eating_out", "coffee", "groceries")
  forcedBucket: CategoryBucket; // "mandatory" | "discretionary" | "unknown"
  
  // Metadata
  rationale?: string;          // User notes why this mapping exists
  createdAt: string;           // ISO timestamp
  updatedAt: string;           // ISO timestamp
  createdBy: 'user' | 'ai';    // How it was created
  
  // Statistics (optional, for AI suggestions)
  matchCount?: number;         // How many transactions matched this pattern
  lastMatchedAt?: string;      // Most recent transaction date
}
```

### Example Documents

**Example 1: Local pub override**
```json
{
  "patternId": "mp_001",
  "uid": "3L3nnXSuTPfr08c8DTXG5zYX37A2",
  "namePattern": "the four horsemen",
  "matchType": "substring",
  "forcedCategoryKey": "eating_out",
  "forcedBucket": "discretionary",
  "rationale": "Local Belfast pub - always eating out, never mandatory",
  "createdAt": "2026-05-03T18:30:00Z",
  "updatedAt": "2026-05-03T18:30:00Z",
  "createdBy": "ai",
  "matchCount": 12,
  "lastMatchedAt": "2026-04-26T19:45:00Z"
}
```

**Example 2: Coffee shop chain**
```json
{
  "patternId": "mp_002",
  "uid": "3L3nnXSuTPfr08c8DTXG5zYX37A2",
  "namePattern": "works coffee",
  "matchType": "substring",
  "forcedCategoryKey": "coffee",
  "forcedBucket": "discretionary",
  "rationale": "Starbucks subsidiary - discretionary coffee spend",
  "createdAt": "2026-05-03T18:30:00Z",
  "updatedAt": "2026-05-03T18:30:00Z",
  "createdBy": "user",
  "matchCount": 8,
  "lastMatchedAt": "2026-04-29T08:15:00Z"
}
```

**Example 3: CrossFit gym (not generic gym)**
```json
{
  "patternId": "mp_003",
  "uid": "3L3nnXSuTPfr08c8DTXG5zYX37A2",
  "namePattern": "crossfit",
  "matchType": "substring",
  "forcedCategoryKey": "crossfit",
  "forcedBucket": "discretionary",
  "rationale": "CrossFit membership - track separately from general gym",
  "createdAt": "2026-05-03T18:30:00Z",
  "updatedAt": "2026-05-03T18:30:00Z",
  "createdBy": "user",
  "matchCount": 4,
  "lastMatchedAt": "2026-04-01T06:00:00Z"
}
```

## Query Patterns

### Get all patterns for a user
```typescript
query(collection(db, 'merchant_pattern_overrides'), 
      where('uid', '==', currentUser.uid))
```

### Find patterns matching a transaction name
```typescript
// Client-side filtering after fetch (no index on pattern text yet)
const matchingPatterns = userPatterns.filter(p => {
  if (p.matchType === 'substring') {
    return txnName.toLowerCase().includes(p.namePattern.toLowerCase());
  } else if (p.matchType === 'regex') {
    return new RegExp(p.namePattern).test(txnName);
  }
  return false;
});
```

## Implementation Notes

### Priority Resolution

When multiple patterns match:
1. **Exact match** takes priority over substring
2. **Substring** takes priority over regex (unless regex is more specific)
3. **Most recently updated** pattern wins ties
4. Falls back to default `financeCategories.ts` logic if no override matches

### Index Requirements

Create composite index for efficient queries:
```
Collection: merchant_pattern_overrides
Fields:
  - uid: Ascending
  - updatedAt: Descending
```

### Security Rules

```javascript
match /merchant_pattern_overrides/{patternId} {
  allow read: if request.auth != null && resource.data.uid == request.auth.uid;
  allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
  allow update, delete: if request.auth != null && resource.data.uid == request.auth.uid;
}
```

## Migration Path

### Phase 1: Read-only defaults (current state)
- All patterns in `financeCategories.ts` hardcoded
- No runtime overrides possible

### Phase 2: Hybrid mode (implement first)
- Load patterns from Firestore at app startup
- Merge with defaults using priority resolution above
- UI allows manual override creation

### Phase 3: AI-assisted suggestions (future)
- Analyze uncategorised transactions
- Suggest new patterns based on frequency and amount patterns
- User approves/rejects → creates persistent override

## UI Integration Points

### Transaction table inline edit
When user changes category on a transaction:
```typescript
// On save
await createMerchantPatternOverride({
  namePattern: transaction.merchantName,
  forcedCategoryKey: newCategoryKey,
  rationale: `Set from transaction ${transaction.id}`,
});
```

### Merchant Management screen
Dedicated interface showing:
- All active patterns
- Match statistics
- Edit/delete controls
- Create new pattern form

### Bulk import
Support CSV upload of pattern mappings for power users:
```csv
namePattern,forcedCategoryKey,forcedBucket,rationale
madigans,eating_out,discretionary,"Local Belfast pub"
works coffee,coffee,discretionary,
```
