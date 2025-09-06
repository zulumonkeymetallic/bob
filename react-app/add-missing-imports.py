#!/usr/bin/env python3
"""
Add missing useTheme imports to BOB components
"""

import os
import re
import glob

def add_missing_theme_import(file_path):
    """Add useTheme import if missing but theme is used"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        
        # Check if theme is used but import is missing
        uses_theme = 'const { theme }' in content or '{ theme' in content
        has_import = 'useTheme' in content and 'ModernThemeContext' in content
        
        if uses_theme and not has_import:
            print(f"Adding useTheme import to {file_path}")
            
            lines = content.split('\n')
            import_added = False
            
            # Find the last import line
            for i, line in enumerate(lines):
                if line.startswith('import ') and not line.startswith('import type'):
                    # This is a good place to add our import
                    continue
                elif lines[i-1].startswith('import ') if i > 0 else False:
                    # Previous line was an import, insert here
                    lines.insert(i, "import { useTheme } from '../contexts/ModernThemeContext';")
                    import_added = True
                    break
            
            if import_added:
                new_content = '\n'.join(lines)
                with open(file_path, 'w') as f:
                    f.write(new_content)
                print(f"  ✅ Added import to {file_path}")
                return True
        
        return False
        
    except Exception as e:
        print(f"  ❌ Error processing {file_path}: {e}")
        return False

def main():
    """Main script"""
    print("📦 Adding missing useTheme imports...")
    print("=" * 50)
    
    files_processed = 0
    files_fixed = 0
    
    # Process all component files
    for file_path in glob.glob("/Users/jim/Github/bob/react-app/src/components/**/*.tsx", recursive=True):
        files_processed += 1
        if add_missing_theme_import(file_path):
            files_fixed += 1
    
    print("\n" + "=" * 50)
    print(f"📦 Import Addition Complete!")
    print(f"📁 Files processed: {files_processed}")
    print(f"✅ Files fixed: {files_fixed}")

if __name__ == "__main__":
    main()
