#!/bin/bash

# Comprehensive status comparison migration script
# This replaces all string comparisons with statusHelpers function calls

cd "/Users/jim/Github/bob/react-app/src"

echo "Starting comprehensive status comparison migration..."

# Find all TypeScript and TypeScript React files
find . -name "*.ts" -o -name "*.tsx" | while read file; do
    echo "Processing: $file"
    
    # Skip our helper files
    if [[ $file == *"choices.ts"* ]] || [[ $file == *"migration.ts"* ]] || [[ $file == *"statusHelpers.ts"* ]]; then
        continue
    fi
    
    # Check if file needs import
    if grep -q "status === \|\.status === \|priority === \|\.priority === \|theme === \|\.theme ===" "$file"; then
        # Add import if not already present
        if ! grep -q "import.*isStatus.*from.*statusHelpers" "$file"; then
            # Find the last import line
            last_import_line=$(grep -n "^import" "$file" | tail -n 1 | cut -d: -f1)
            if [ ! -z "$last_import_line" ]; then
                sed -i "" "${last_import_line}a\\
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '../utils/statusHelpers';
" "$file"
            fi
        fi
    fi
    
    # Replace status comparisons with isStatus calls
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''New'\''/isStatus(\1.status, '\''New'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "New"/isStatus(\1.status, "New")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''Work in Progress'\''/isStatus(\1.status, '\''Work in Progress'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "Work in Progress"/isStatus(\1.status, "Work in Progress")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''Complete'\''/isStatus(\1.status, '\''Complete'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "Complete"/isStatus(\1.status, "Complete")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''Blocked'\''/isStatus(\1.status, '\''Blocked'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "Blocked"/isStatus(\1.status, "Blocked")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''Deferred'\''/isStatus(\1.status, '\''Deferred'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "Deferred"/isStatus(\1.status, "Deferred")/g' "$file"
    
    # Story statuses
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''backlog'\''/isStatus(\1.status, '\''backlog'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "backlog"/isStatus(\1.status, "backlog")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''planned'\''/isStatus(\1.status, '\''planned'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "planned"/isStatus(\1.status, "planned")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''active'\''/isStatus(\1.status, '\''active'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "active"/isStatus(\1.status, "active")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''in-progress'\''/isStatus(\1.status, '\''in-progress'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "in-progress"/isStatus(\1.status, "in-progress")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''testing'\''/isStatus(\1.status, '\''testing'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "testing"/isStatus(\1.status, "testing")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''done'\''/isStatus(\1.status, '\''done'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "done"/isStatus(\1.status, "done")/g' "$file"
    
    # Task statuses
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''todo'\''/isStatus(\1.status, '\''todo'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "todo"/isStatus(\1.status, "todo")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === '\''in_progress'\''/isStatus(\1.status, '\''in_progress'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status === "in_progress"/isStatus(\1.status, "in_progress")/g' "$file"
    
    # Priority comparisons
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === '\''Critical'\''/isPriority(\1.priority, '\''Critical'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === "Critical"/isPriority(\1.priority, "Critical")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === '\''High'\''/isPriority(\1.priority, '\''High'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === "High"/isPriority(\1.priority, "High")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === '\''Medium'\''/isPriority(\1.priority, '\''Medium'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === "Medium"/isPriority(\1.priority, "Medium")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === '\''Low'\''/isPriority(\1.priority, '\''Low'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === "Low"/isPriority(\1.priority, "Low")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === '\''high'\''/isPriority(\1.priority, '\''high'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === "high"/isPriority(\1.priority, "high")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === '\''med'\''/isPriority(\1.priority, '\''med'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === "med"/isPriority(\1.priority, "med")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === '\''low'\''/isPriority(\1.priority, '\''low'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.priority === "low"/isPriority(\1.priority, "low")/g' "$file"
    
    # Theme comparisons
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === '\''Health'\''/isTheme(\1.theme, '\''Health'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === "Health"/isTheme(\1.theme, "Health")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === '\''Growth'\''/isTheme(\1.theme, '\''Growth'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === "Growth"/isTheme(\1.theme, "Growth")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === '\''Wealth'\''/isTheme(\1.theme, '\''Wealth'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === "Wealth"/isTheme(\1.theme, "Wealth")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === '\''Tribe'\''/isTheme(\1.theme, '\''Tribe'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === "Tribe"/isTheme(\1.theme, "Tribe")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === '\''Home'\''/isTheme(\1.theme, '\''Home'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme === "Home"/isTheme(\1.theme, "Home")/g' "$file"
    
    # Handle !== comparisons for status
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status !== '\''done'\''/!isStatus(\1.status, '\''done'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status !== "done"/!isStatus(\1.status, "done")/g' "$file"
    
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status !== '\''Complete'\''/!isStatus(\1.status, '\''Complete'\'')/g' "$file"
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.status !== "Complete"/!isStatus(\1.status, "Complete")/g' "$file"
    
    # Handle theme.toLowerCase() calls
    sed -i "" 's/\([a-zA-Z_][a-zA-Z0-9_.]*\)\.theme\.toLowerCase()/getThemeClass(\1.theme)/g' "$file"
    
    # Handle priority badge usage
    sed -i "" 's/bg={task\.priority === '\''high'\'' ? '\''danger'\'' : task\.priority === '\''med'\'' ? '\''warning'\'' : '\''secondary'\''}/bg={getPriorityBadge(task.priority).bg}/g' "$file"
    
done

echo "Status comparison migration complete!"
echo "Running TypeScript build to check for remaining errors..."

# Test the build
npm run build
