#!/bin/bash

# Fix imports for statusHelpers functions
cd "/Users/jim/Github/bob/react-app/src"

FILES_TO_FIX="./components/BacklogManager.tsx ./components/ComprehensiveTest.tsx ./components/DetailsSidebar.tsx ./components/MobilePriorityDashboard.tsx ./components/MobileView.tsx ./components/ModernKanbanBoard-v3.0.8.tsx ./components/ModernKanbanBoard.tsx ./components/ModernKanbanPage.tsx ./components/NewDashboard.tsx ./components/PlanningDashboard.tsx ./components/PriorityPane.tsx ./components/TasksList-Original.tsx"

for file in $FILES_TO_FIX; do
    echo "Fixing imports in: $file"
    
    if grep -q "import.*isStatus.*from.*statusHelpers" "$file"; then
        # Replace existing import with complete import
        sed -i "" 's/import { isStatus[^}]* } from .\+statusHelpers.\+/import { isStatus, isTheme, isPriority, getThemeClass, getPriorityBadge } from '\''..\/utils\/statusHelpers'\'';/' "$file"
    fi
done

echo "Import fixes complete!"
