#!/bin/bash

# Enhanced Type Fix Script
echo "🔧 Running enhanced type fixes..."

cd /Users/jim/Github/bob/react-app/src

# Fix remaining function call issues that expect strings but get numbers
echo "🎯 Fixing function calls with number arguments..."

# Fix getPriorityColor calls
find components -name "*.tsx" -exec grep -l "getPriorityColor.*\.priority)" {} \; | while read file; do
  echo "  Fixing getPriorityColor in $file"
  sed -i '' 's/getPriorityColor(task\.priority)/getPriorityColor(getPriorityName(task.priority))/g' "$file"
  sed -i '' 's/getPriorityColor(story\.priority)/getPriorityColor(getPriorityName(story.priority))/g' "$file"
done

# Fix getPriorityIcon calls  
find components -name "*.tsx" -exec grep -l "getPriorityIcon.*\.priority)" {} \; | while read file; do
  echo "  Fixing getPriorityIcon in $file"
  sed -i '' 's/getPriorityIcon(task\.priority)/getPriorityIcon(getPriorityName(task.priority))/g' "$file"
  sed -i '' 's/getPriorityIcon(story\.priority)/getPriorityIcon(getPriorityName(story.priority))/g' "$file"
done

# Fix getBadgeVariant calls
find components -name "*.tsx" -exec grep -l "getBadgeVariant.*\.status)" {} \; | while read file; do
  echo "  Fixing getBadgeVariant in $file"
  sed -i '' 's/getBadgeVariant(task\.status)/getBadgeVariant(getStatusName(task.status))/g' "$file"
  sed -i '' 's/getBadgeVariant(story\.status)/getBadgeVariant(getStatusName(story.status))/g' "$file"
done

# Fix function calls that need conversion to strings
echo "🔄 Fixing method calls on numbers..."

# Fix all .replace() calls on status
find components -name "*.tsx" -exec grep -l "\.status\.replace" {} \; | while read file; do
  echo "  Fixing status.replace in $file"
  sed -i '' 's/\([a-zA-Z0-9_.]*\)\.status\.replace/getStatusName(\1.status).replace/g' "$file"
done

# Fix all .toUpperCase() calls on priority  
find components -name "*.tsx" -exec grep -l "\.priority\.toUpperCase" {} \; | while read file; do
  echo "  Fixing priority.toUpperCase in $file"
  sed -i '' 's/\([a-zA-Z0-9_.]*\)\.priority\.toUpperCase()/getPriorityName(\1.priority).toUpperCase()/g' "$file"
done

# Fix function signatures that should accept numbers
echo "📝 Fixing function signatures..."

# Find functions that take status/priority as string but should take numbers
find components -name "*.tsx" -exec grep -l "currentStatus: string" {} \; | while read file; do
  echo "  Updating function signature in $file"
  sed -i '' 's/currentStatus: string/currentStatus: number/g' "$file"
  sed -i '' 's/currentPriority: string/currentPriority: number/g' "$file"
done

# Add all necessary imports to files
echo "📦 Adding comprehensive imports..."

# Files that need comprehensive imports
FILES_NEED_ALL_HELPERS=(
  "components/MobilePriorityDashboard.tsx"
  "components/TasksList.tsx" 
  "components/TasksList-Enhanced.tsx"
  "components/TasksList-Original.tsx"
  "components/StoryBacklog.tsx"
  "components/ModernKanbanPage.tsx"
  "components/NewDashboard.tsx"
)

for file in "${FILES_NEED_ALL_HELPERS[@]}"; do
  if [ -f "$file" ]; then
    echo "  Adding comprehensive imports to $file"
    # Replace existing statusHelpers import with comprehensive one
    if grep -q "from '../utils/statusHelpers'" "$file"; then
      sed -i '' 's/import { [^}]* } from '\''\.\.\/utils\/statusHelpers'\'';/import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '\''..\/utils\/statusHelpers'\'';/g' "$file"
    fi
  fi
done

echo "✅ Enhanced fixes complete!"

# Test the build
echo "🔍 Testing build..."
cd /Users/jim/Github/bob/react-app
npm run build --silent 2>&1 | head -10
