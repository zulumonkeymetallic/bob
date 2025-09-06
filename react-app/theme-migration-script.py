#!/usr/bin/env python3
"""
Comprehensive Theme Migration Script for BOB
Systematically replaces hardcoded theme values with ModernThemeContext references
"""

import os
import re
import glob

# Define replacement patterns
REPLACEMENTS = [
    # Background colors
    (r"backgroundColor:\s*['\"]#f8f9fa['\"]", "backgroundColor: theme.colors.background"),
    (r"backgroundColor:\s*['\"]#ffffff['\"]", "backgroundColor: theme.colors.surface"),
    (r"backgroundColor:\s*['\"]white['\"]", "backgroundColor: theme.colors.surface"),
    (r"backgroundColor:\s*['\"]#fff['\"]", "backgroundColor: theme.colors.surface"),
    
    # Text colors
    (r"color:\s*['\"]#374151['\"]", "color: theme.colors.onSurface"),
    (r"color:\s*['\"]#111827['\"]", "color: theme.colors.onBackground"),
    (r"color:\s*['\"]#1f2937['\"]", "color: theme.colors.onBackground"),
    (r"color:\s*['\"]#6b7280['\"]", "color: theme.colors.onSurface"),
    (r"color:\s*['\"]#9ca3af['\"]", "color: theme.colors.onSurface"),
    (r"color:\s*['\"]#495057['\"]", "color: theme.colors.onSurface"),
    (r"color:\s*['\"]#6c757d['\"]", "color: theme.colors.onSurface"),
    
    # Border colors
    (r"border:\s*['\"]1px\s+solid\s+#e9ecef['\"]", "border: `1px solid ${theme.colors.border}`"),
    (r"border:\s*['\"]1px\s+solid\s+#d1d5db['\"]", "border: `1px solid ${theme.colors.border}`"),
    (r"border:\s*['\"]1px\s+solid\s+#e5e7eb['\"]", "border: `1px solid ${theme.colors.border}`"),
    (r"border:\s*['\"]1px\s+solid\s+#f3f4f6['\"]", "border: `1px solid ${theme.colors.border}`"),
    (r"borderBottom:\s*['\"]1px\s+solid\s+#e5e7eb['\"]", "borderBottom: `1px solid ${theme.colors.border}`"),
    (r"borderRight:\s*['\"]1px\s+solid\s+#f3f4f6['\"]", "borderRight: `1px solid ${theme.colors.border}`"),
]

# Files to process (React component files)
COMPONENT_PATHS = [
    "/Users/jim/Github/bob/react-app/src/components/**/*.tsx",
    "/Users/jim/Github/bob/react-app/src/hooks/**/*.ts",
    "/Users/jim/Github/bob/react-app/src/utils/**/*.ts"
]

def add_theme_import(file_path):
    """Add useTheme import if not present"""
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Check if useTheme is already imported
    if 'useTheme' in content and 'ModernThemeContext' in content:
        return content
    
    # Check if this file needs theme (has hardcoded colors)
    has_hardcoded = any(re.search(pattern, content) for pattern, _ in REPLACEMENTS)
    if not has_hardcoded:
        return content
    
    # Add import statement
    import_line = "import { useTheme } from '../contexts/ModernThemeContext';"
    
    # Find existing imports and add after them
    lines = content.split('\n')
    import_index = -1
    
    for i, line in enumerate(lines):
        if line.startswith('import ') and not line.startswith('import type'):
            import_index = i
    
    if import_index >= 0:
        lines.insert(import_index + 1, import_line)
        content = '\n'.join(lines)
    
    return content

def add_theme_hook(content):
    """Add const { theme } = useTheme(); to component"""
    if 'const { theme } = useTheme();' in content:
        return content
    
    # Find component function and add theme hook
    pattern = r'(const\s+\w+.*?:\s*React\.FC.*?\s*=.*?\s*\(\s*[^)]*\s*\)\s*=>\s*{)'
    
    def replace_func(match):
        return f"{match.group(1)}\n  const {{ theme }} = useTheme();"
    
    return re.sub(pattern, replace_func, content)

def apply_theme_replacements(content):
    """Apply all theme-related replacements"""
    for pattern, replacement in REPLACEMENTS:
        content = re.sub(pattern, replacement, content)
    return content

def process_file(file_path):
    """Process a single file for theme migration"""
    try:
        print(f"Processing: {file_path}")
        
        # Read file
        with open(file_path, 'r') as f:
            original_content = f.read()
        
        # Apply transformations
        content = add_theme_import(file_path)
        content = add_theme_hook(content)
        content = apply_theme_replacements(content)
        
        # Only write if content changed
        if content != original_content:
            with open(file_path, 'w') as f:
                f.write(content)
            print(f"  ✅ Updated {file_path}")
            return True
        else:
            print(f"  ⏭️  No changes needed for {file_path}")
            return False
            
    except Exception as e:
        print(f"  ❌ Error processing {file_path}: {e}")
        return False

def main():
    """Main migration script"""
    print("🎨 Starting BOB Theme Migration...")
    print("=" * 50)
    
    files_processed = 0
    files_updated = 0
    
    # Process all component files
    for pattern in COMPONENT_PATHS:
        for file_path in glob.glob(pattern, recursive=True):
            if file_path.endswith(('.tsx', '.ts')):
                files_processed += 1
                if process_file(file_path):
                    files_updated += 1
    
    print("\n" + "=" * 50)
    print(f"🎨 Theme Migration Complete!")
    print(f"📁 Files processed: {files_processed}")
    print(f"✅ Files updated: {files_updated}")
    print(f"⏭️  Files unchanged: {files_processed - files_updated}")

if __name__ == "__main__":
    main()
