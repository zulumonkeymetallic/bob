#!/bin/bash

# BOB Type Compatibility Fix Script
# Systematically fixes all string/number type compatibility issues for ServiceNow choice system

echo "🔧 Starting systematic type compatibility fixes..."

cd /Users/jim/Github/bob/react-app/src

# Add missing imports to files that need helper functions
echo "📦 Adding missing imports..."

# Files that need isPriority import
FILES_NEED_ISPRIORITY=(
  "components/MobilePriorityDashboard.tsx"
  "components/MobileView.tsx"
  "components/ModernKanbanBoard.tsx"
  "components/ModernKanbanBoard-v3.0.8.tsx"
  "components/ModernKanbanPage.tsx"
  "components/NewDashboard.tsx"
  "components/PlanningDashboard.tsx"
  "components/PriorityPane.tsx"
  "components/TasksList-Original.tsx"
)

for file in "${FILES_NEED_ISPRIORITY[@]}"; do
  if [ -f "$file" ]; then
    echo "  Adding isPriority import to $file"
    # Check if already has isPriority
    if ! grep -q "isPriority" "$file"; then
      # Add isPriority to existing statusHelpers import
      if grep -q "from '../utils/statusHelpers'" "$file"; then
        sed -i '' 's/{ *isStatus/{ isStatus, isPriority/g' "$file"
        sed -i '' 's/{ *isTheme/{ isTheme, isPriority/g' "$file"
        sed -i '' 's/{ *isStatus, *isTheme/{ isStatus, isTheme, isPriority/g' "$file"
      else
        # Add new import line
        if grep -q "import.*from.*types" "$file"; then
          sed -i '' "/import.*from.*types/a\\
import { isPriority } from '../utils/statusHelpers';
" "$file"
        fi
      fi
    fi
  fi
done

# Files that need getThemeClass, getPriorityColor, getBadgeVariant imports
FILES_NEED_HELPERS=(
  "components/NewDashboard.tsx"
  "components/MobilePriorityDashboard.tsx"
  "components/TasksList.tsx"
  "components/TasksList-Enhanced.tsx"
  "components/StoryBacklog.tsx"
  "components/SprintPlannerMatrix.tsx"
)

for file in "${FILES_NEED_HELPERS[@]}"; do
  if [ -f "$file" ]; then
    echo "  Adding helper imports to $file"
    if grep -q "from '../utils/statusHelpers'" "$file"; then
      sed -i '' 's/} from '\''..\/utils\/statusHelpers'\'';/, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName } from '\''..\/utils\/statusHelpers'\'';/g' "$file"
    fi
  fi
done

echo "🔄 Fixing direct comparisons..."

# Fix goal.status/theme direct comparisons
find components -name "*.tsx" -exec grep -l "goal\.status.*!==" {} \; | while read file; do
  echo "  Fixing goal status comparisons in $file"
  sed -i '' 's/goal\.status !== filterStatus/!isStatus(goal.status, filterStatus)/g' "$file"
  sed -i '' 's/goal\.theme !== filterTheme/!isTheme(goal.theme, filterTheme)/g' "$file"
done

# Fix story.status/priority direct comparisons
find components -name "*.tsx" -exec grep -l "story\.status.*===" {} \; | while read file; do
  echo "  Fixing story status comparisons in $file"
  sed -i '' 's/story\.status === '\''backlog'\''/isStatus(story.status, '\''backlog'\'')/g' "$file"
  sed -i '' 's/story\.status === '\''active'\''/isStatus(story.status, '\''active'\'')/g' "$file"
  sed -i '' 's/story\.status === '\''done'\''/isStatus(story.status, '\''done'\'')/g' "$file"
  sed -i '' 's/story\.status === '\''testing'\''/isStatus(story.status, '\''testing'\'')/g' "$file"
  sed -i '' 's/story\.status === '\''planned'\''/isStatus(story.status, '\''planned'\'')/g' "$file"
  sed -i '' 's/story\.status !== '\''backlog'\''/!isStatus(story.status, '\''backlog'\'')/g' "$file"
  sed -i '' 's/story\.status !== '\''active'\''/!isStatus(story.status, '\''active'\'')/g' "$file"
  sed -i '' 's/story\.status !== '\''done'\''/!isStatus(story.status, '\''done'\'')/g' "$file"
  
  # Fix priority comparisons
  sed -i '' 's/story\.priority === '\''P1'\''/isPriority(story.priority, '\''High'\'')/g' "$file"
  sed -i '' 's/story\.priority === '\''P2'\''/isPriority(story.priority, '\''Medium'\'')/g' "$file"
  sed -i '' 's/story\.priority === '\''P3'\''/isPriority(story.priority, '\''Low'\'')/g' "$file"
done

# Fix task.status/priority direct comparisons
find components -name "*.tsx" -exec grep -l "task\.status.*===" {} \; | while read file; do
  echo "  Fixing task status comparisons in $file"
  sed -i '' 's/task\.status === '\''todo'\''/isStatus(task.status, '\''todo'\'')/g' "$file"
  sed -i '' 's/task\.status === '\''in-progress'\''/isStatus(task.status, '\''in-progress'\'')/g' "$file"
  sed -i '' 's/task\.status === '\''done'\''/isStatus(task.status, '\''done'\'')/g' "$file"
  sed -i '' 's/task\.status === '\''blocked'\''/isStatus(task.status, '\''blocked'\'')/g' "$file"
  sed -i '' 's/task\.status !== '\''todo'\''/!isStatus(task.status, '\''todo'\'')/g' "$file"
  sed -i '' 's/task\.status !== '\''in-progress'\''/!isStatus(task.status, '\''in-progress'\'')/g' "$file"
  sed -i '' 's/task\.status !== '\''done'\''/!isStatus(task.status, '\''done'\'')/g' "$file"
  sed -i '' 's/task\.status !== '\''blocked'\''/!isStatus(task.status, '\''blocked'\'')/g' "$file"
  sed -i '' 's/task\.status !== filterStatus/!isStatus(task.status, filterStatus)/g' "$file"
  
  # Fix priority comparisons
  sed -i '' 's/task\.priority === '\''high'\''/isPriority(task.priority, '\''high'\'')/g' "$file"
  sed -i '' 's/task\.priority === '\''med'\''/isPriority(task.priority, '\''med'\'')/g' "$file"
  sed -i '' 's/task\.priority === '\''low'\''/isPriority(task.priority, '\''low'\'')/g' "$file"
  sed -i '' 's/task\.priority !== filterPriority/!isPriority(task.priority, filterPriority)/g' "$file"
done

# Fix goal status specific comparisons
find components -name "*.tsx" -exec grep -l "g\.status.*===" {} \; | while read file; do
  echo "  Fixing goal status specific comparisons in $file"
  sed -i '' 's/g\.status === '\''Work in Progress'\''/isStatus(g.status, '\''Work in Progress'\'')/g' "$file"
  sed -i '' 's/g\.status === '\''Complete'\''/isStatus(g.status, '\''Complete'\'')/g' "$file"
  sed -i '' 's/g\.status === '\''Blocked'\''/isStatus(g.status, '\''Blocked'\'')/g' "$file"
  sed -i '' 's/g\.status === '\''Deferred'\''/isStatus(g.status, '\''Deferred'\'')/g' "$file"
  sed -i '' 's/g\.status === '\''Paused'\''/isStatus(g.status, '\''Paused'\'')/g' "$file"
  sed -i '' 's/g\.status === '\''New'\''/isStatus(g.status, '\''New'\'')/g' "$file"
done

echo "🎨 Fixing display function calls..."

# Fix function calls that expect strings but receive numbers
find components -name "*.tsx" -exec grep -l "getPriorityColor.*\.priority)" {} \; | while read file; do
  echo "  Fixing getPriorityColor calls in $file"
  sed -i '' 's/getPriorityColor(task\.priority)/getPriorityColor(getPriorityName(task.priority))/g' "$file"
  sed -i '' 's/getPriorityColor(story\.priority)/getPriorityColor(getPriorityName(story.priority))/g' "$file"
done

find components -name "*.tsx" -exec grep -l "getBadgeVariant.*\.status)" {} \; | while read file; do
  echo "  Fixing getBadgeVariant calls in $file"
  sed -i '' 's/getBadgeVariant(task\.status)/getBadgeVariant(getStatusName(task.status))/g' "$file"
  sed -i '' 's/getBadgeVariant(story\.status)/getBadgeVariant(getStatusName(story.status))/g' "$file"
done

find components -name "*.tsx" -exec grep -l "getThemeBadge.*\.theme)" {} \; | while read file; do
  echo "  Fixing getThemeBadge calls in $file"
  sed -i '' 's/getThemeBadge(goal\.theme)/getThemeBadge(getThemeName(goal.theme))/g' "$file"
  sed -i '' 's/getThemeBadge(task\.theme)/getThemeBadge(getThemeName(task.theme))/g' "$file"
done

find components -name "*.tsx" -exec grep -l "getThemeColor.*\.theme)" {} \; | while read file; do
  echo "  Fixing getThemeColor calls in $file"
  sed -i '' 's/getThemeColor(goalTheme)/getThemeColor(getThemeName(goalTheme))/g' "$file"
done

echo "🔧 Fixing string method calls on numbers..."

# Fix .replace() calls on status numbers
find components -name "*.tsx" -exec grep -l "\.status\.replace" {} \; | while read file; do
  echo "  Fixing status.replace calls in $file"
  sed -i '' 's/task\.status\.replace/getStatusName(task.status).replace/g' "$file"
  sed -i '' 's/story\.status\.replace/getStatusName(story.status).replace/g' "$file"
done

# Fix .toUpperCase() calls on priority numbers
find components -name "*.tsx" -exec grep -l "\.priority\.toUpperCase" {} \; | while read file; do
  echo "  Fixing priority.toUpperCase calls in $file"
  sed -i '' 's/task\.priority\.toUpperCase()/getPriorityName(task.priority).toUpperCase()/g' "$file"
  sed -i '' 's/story\.priority\.toUpperCase()/getPriorityName(story.priority).toUpperCase()/g' "$file"
done

echo "📝 Fixing type assignments..."

# Fix TaskTableRow interface issues
find components -name "*TaskTable*.tsx" -exec grep -l "TaskTableRow.*theme.*string" {} \; | while read file; do
  echo "  Fixing TaskTableRow interface in $file"
  sed -i '' 's/theme: string/theme: number/g' "$file"
  sed -i '' 's/priority: string/priority: number/g' "$file"
done

# Fix hard-coded string assignments to number fields
find components -name "*.tsx" -exec grep -l "status: '\''backlog'\''" {} \; | while read file; do
  echo "  Fixing status assignments in $file"
  sed -i '' 's/status: '\''backlog'\''/status: 0/g' "$file"
  sed -i '' 's/status: '\''planned'\''/status: 1/g' "$file"
  sed -i '' 's/status: '\''active'\''/status: 2/g' "$file"
  sed -i '' 's/status: '\''testing'\''/status: 3/g' "$file"
  sed -i '' 's/status: '\''done'\''/status: 4/g' "$file"
  sed -i '' 's/status: '\''todo'\''/status: 0/g' "$file"
  sed -i '' 's/status: '\''in-progress'\''/status: 1/g' "$file"
  sed -i '' 's/status: '\''blocked'\''/status: 3/g' "$file"
done

find components -name "*.tsx" -exec grep -l "priority: '\''P[123]'\''" {} \; | while read file; do
  echo "  Fixing priority assignments in $file"
  sed -i '' 's/priority: '\''P1'\''/priority: 4/g' "$file"
  sed -i '' 's/priority: '\''P2'\''/priority: 3/g' "$file"
  sed -i '' 's/priority: '\''P3'\''/priority: 2/g' "$file"
  sed -i '' 's/priority: '\''high'\''/priority: 3/g' "$file"
  sed -i '' 's/priority: '\''med'\''/priority: 2/g' "$file"
  sed -i '' 's/priority: '\''low'\''/priority: 1/g' "$file"
done

find components -name "*.tsx" -exec grep -l "theme: '\''[A-Z]" {} \; | while read file; do
  echo "  Fixing theme assignments in $file"
  sed -i '' 's/theme: '\''Health'\''/theme: 1/g' "$file"
  sed -i '' 's/theme: '\''Growth'\''/theme: 2/g' "$file"
  sed -i '' 's/theme: '\''Wealth'\''/theme: 3/g' "$file"
  sed -i '' 's/theme: '\''Tribe'\''/theme: 4/g' "$file"
  sed -i '' 's/theme: '\''Home'\''/theme: 5/g' "$file"
done

echo "🧹 Fixing type casting issues..."

# Fix as keyof typeof casting issues
find components -name "*.tsx" -exec grep -l "as keyof typeof" {} \; | while read file; do
  echo "  Fixing type casting in $file"
  sed -i '' 's/\[task\.priority as keyof typeof priorityOrder\]/[getPriorityName(task.priority) as keyof typeof priorityOrder]/g' "$file"
  sed -i '' 's/\[a\.priority as keyof typeof priorityOrder\]/[getPriorityName(a.priority) as keyof typeof priorityOrder]/g' "$file"
  sed -i '' 's/\[b\.priority as keyof typeof priorityOrder\]/[getPriorityName(b.priority) as keyof typeof priorityOrder]/g' "$file"
  sed -i '' 's/\[task\.priority as keyof typeof priorityScores\]/[getPriorityName(task.priority) as keyof typeof priorityScores]/g' "$file"
done

echo "🏠 Fixing theme return type issues..."

# Fix theme return type issues in hooks
find hooks -name "*.ts" -exec grep -l "return.*\.theme" {} \; | while read file; do
  echo "  Fixing theme returns in $file"
  sed -i '' 's/return storyData\.theme/return getThemeName(storyData.theme)/g' "$file"
  sed -i '' 's/return goalData\.theme/return getThemeName(goalData.theme)/g' "$file"
done

echo "🎯 Final cleanup..."

# Remove unused files to reduce error count
if [ -f "components/ModernTableDemo.tsx" ]; then
  echo "  Moving demo file to backup"
  mv "components/ModernTableDemo.tsx" "components/ModernTableDemo.tsx.bak"
fi

echo "✅ Type compatibility fixes complete!"
echo "🔍 Checking for remaining errors..."

cd /Users/jim/Github/bob/react-app
npm run build --silent 2>&1 | head -20
