#!/bin/bash
# BOB Release Backup Script
# Usage: ./backup-release.sh v2.1.3

set -e

VERSION=$1
if [ -z "$VERSION" ]; then
    echo "❌ Error: Version required"
    echo "Usage: ./backup-release.sh v2.1.3"
    exit 1
fi

echo "🚀 Starting BOB release backup for $VERSION"

# Create backup directory if it doesn't exist
BACKUP_DIR="../bob-backups"
mkdir -p $BACKUP_DIR

# Pre-release backup
echo "📦 Creating pre-release backup..."
BACKUP_TAG="${VERSION}-backup"

# Check if tag already exists
if git rev-parse "$BACKUP_TAG" >/dev/null 2>&1; then
    echo "⚠️  Tag $BACKUP_TAG already exists, skipping tag creation"
else
    git tag -a $BACKUP_TAG -m "Backup before $VERSION deployment - $(date)"
    git push origin $BACKUP_TAG
    echo "✅ Created and pushed backup tag: $BACKUP_TAG"
fi

# Clone backup
BACKUP_PATH="$BACKUP_DIR/bob-backup-$VERSION"
if [ -d "$BACKUP_PATH" ]; then
    echo "⚠️  Backup directory already exists: $BACKUP_PATH"
    echo "🗑️  Removing existing backup..."
    rm -rf "$BACKUP_PATH"
fi

echo "📥 Cloning backup repository..."
git clone https://github.com/zulumonkeymetallic/bob.git "$BACKUP_PATH"
cd "$BACKUP_PATH"
git checkout $BACKUP_TAG

# Verify backup
echo "🔍 Verifying backup..."
if [ -f "package.json" ] && [ -d "react-app" ]; then
    echo "✅ Backup verification successful"
else
    echo "❌ Backup verification failed"
    exit 1
fi

# Test build capability
echo "🏗️  Testing backup build capability..."
cd react-app
if npm install --silent && npm run build --silent; then
    echo "✅ Backup build test successful"
else
    echo "⚠️  Backup build test failed (may need manual intervention)"
fi

# Return to original directory
cd ../../..

# Create backup summary
BACKUP_SUMMARY="$BACKUP_DIR/backup-summary.txt"
echo "BOB Backup Summary - $(date)" >> $BACKUP_SUMMARY
echo "Version: $VERSION" >> $BACKUP_SUMMARY
echo "Backup Tag: $BACKUP_TAG" >> $BACKUP_SUMMARY
echo "Backup Path: $BACKUP_PATH" >> $BACKUP_SUMMARY
echo "Size: $(du -sh $BACKUP_PATH | cut -f1)" >> $BACKUP_SUMMARY
echo "---" >> $BACKUP_SUMMARY

echo "🎉 Pre-release backup complete!"
echo "📁 Backup location: $BACKUP_PATH"
echo "🏷️  Backup tag: $BACKUP_TAG"
echo ""
echo "Next steps:"
echo "1. Deploy to staging and test"
echo "2. Deploy to production"
echo "3. Run: ./production-tag.sh $VERSION"
