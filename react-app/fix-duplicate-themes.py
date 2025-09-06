#!/usr/bin/env python3
"""
Fix duplicate theme declarations in BOB components
"""

import os
import re
import glob

def fix_duplicate_theme_declarations(file_path):
    """Fix duplicate theme declarations in a file"""
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        
        original_content = content
        lines = content.split('\n')
        
        # Track which lines have theme declarations
        theme_declaration_lines = []
        for i, line in enumerate(lines):
            if re.search(r'const\s*{\s*theme', line.strip()):
                theme_declaration_lines.append(i)
        
        if len(theme_declaration_lines) > 1:
            print(f"Found {len(theme_declaration_lines)} theme declarations in {file_path}")
            
            # Find the most comprehensive declaration
            best_line = 0
            best_declaration = ""
            for line_num in theme_declaration_lines:
                declaration = lines[line_num].strip()
                if len(declaration) > len(best_declaration):
                    best_declaration = declaration
                    best_line = line_num
            
            # Remove duplicate declarations
            new_lines = []
            for i, line in enumerate(lines):
                if i in theme_declaration_lines and i != best_line:
                    print(f"  Removing duplicate: {line.strip()}")
                    continue
                new_lines.append(line)
            
            content = '\n'.join(new_lines)
            
            # Write back if changed
            if content != original_content:
                with open(file_path, 'w') as f:
                    f.write(content)
                print(f"  ✅ Fixed duplicates in {file_path}")
                return True
        
        return False
        
    except Exception as e:
        print(f"  ❌ Error processing {file_path}: {e}")
        return False

def main():
    """Main script"""
    print("🔧 Fixing duplicate theme declarations...")
    print("=" * 50)
    
    files_processed = 0
    files_fixed = 0
    
    # Process all component files
    for file_path in glob.glob("/Users/jim/Github/bob/react-app/src/components/**/*.tsx", recursive=True):
        files_processed += 1
        if fix_duplicate_theme_declarations(file_path):
            files_fixed += 1
    
    print("\n" + "=" * 50)
    print(f"🔧 Fix Complete!")
    print(f"📁 Files processed: {files_processed}")
    print(f"✅ Files fixed: {files_fixed}")

if __name__ == "__main__":
    main()
