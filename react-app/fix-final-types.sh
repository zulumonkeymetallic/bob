#!/bin/bash

echo "🔧 Final TypeScript fixes..."

# Fix priority string to number conversions in forms
echo "Fixing priority form conversions..."

# Fix ModernStoriesTable - priority field should be converted to number
sed -i '' 's/priority: "P3"/priority: 3/g' src/components/ModernStoriesTable.tsx
sed -i '' 's/priority: "P2"/priority: 2/g' src/components/ModernStoriesTable.tsx  
sed -i '' 's/priority: "P1"/priority: 1/g' src/components/ModernStoriesTable.tsx

# Fix task priority conversions
sed -i '' 's/priority: "high"/priority: 1/g' src/components/*.tsx
sed -i '' 's/priority: "med"/priority: 2/g' src/components/*.tsx
sed -i '' 's/priority: "low"/priority: 3/g' src/components/*.tsx

# Fix task form interfaces that incorrectly exclude priority
sed -i '' 's/extends interface .Omit<Task, "priority">/extends interface Task/g' src/components/ModernTaskTable*.tsx

# Fix string to number conversions in form submissions
echo "Fixing form submission conversions..."

# Find and fix priority form value conversions - need to convert P1/P2/P3 to numbers
sed -i '' 's/priority: editStory\.priority/priority: editStory.priority === "P1" ? 1 : editStory.priority === "P2" ? 2 : 3/g' src/components/ModernKanbanPage.tsx

echo "✅ Final fixes complete!"
