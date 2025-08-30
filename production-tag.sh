#!/bin/bash
# BOB Production Release Tagging Script
# Usage: ./production-tag.sh v2.1.3

set -e

VERSION=$1
if [ -z "$VERSION" ]; then
    echo "❌ Error: Version required"
    echo "Usage: ./production-tag.sh v2.1.3"
    exit 1
fi

echo "🏷️  Creating production tag for BOB $VERSION"

# Verify current deployment is working
echo "🌐 Verifying production deployment..."
if curl -s -f https://bob20250810.web.app/ > /dev/null; then
    echo "✅ Production site is accessible"
else
    echo "❌ Production site verification failed"
    echo "⚠️  Proceeding anyway, but please verify manually"
fi

# Create production tag
PROD_TAG="$VERSION"
RELEASE_MESSAGE="BOB $VERSION - Production Release

Features:
- Navigation menu restructuring and cleanup
- Settings consolidation with Material UI styling  
- Steam Connect integration framework
- White text visibility fixes
- Notion AI inspired typography and layout
- Git backup strategy implementation

Defects Fixed:
- C24: Settings page implementation
- C28: Dark mode banner visibility
- E11: Navigation menu logical grouping

Deployed: $(date)
URL: https://bob20250810.web.app/"

# Check if production tag exists
if git rev-parse "$PROD_TAG" >/dev/null 2>&1; then
    echo "⚠️  Production tag $PROD_TAG already exists"
    read -p "🤔 Overwrite existing tag? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d $PROD_TAG
        git push origin :refs/tags/$PROD_TAG
        echo "🗑️  Removed existing tag"
    else
        echo "❌ Aborted"
        exit 1
    fi
fi

# Create and push production tag
git tag -a $PROD_TAG -m "$RELEASE_MESSAGE"
git push origin $PROD_TAG
echo "✅ Created and pushed production tag: $PROD_TAG"

# Create production backup
BACKUP_DIR="../bob-backups"
mkdir -p $BACKUP_DIR

PROD_BACKUP_PATH="$BACKUP_DIR/bob-production-$VERSION"
if [ -d "$PROD_BACKUP_PATH" ]; then
    echo "🗑️  Removing existing production backup..."
    rm -rf "$PROD_BACKUP_PATH"
fi

echo "📥 Creating production backup..."
git clone https://github.com/zulumonkeymetallic/bob.git "$PROD_BACKUP_PATH"
cd "$PROD_BACKUP_PATH"
git checkout $PROD_TAG

# Update backup summary
BACKUP_SUMMARY="$BACKUP_DIR/backup-summary.txt"
echo "Production Backup - $(date)" >> $BACKUP_SUMMARY
echo "Version: $VERSION" >> $BACKUP_SUMMARY
echo "Production Tag: $PROD_TAG" >> $BACKUP_SUMMARY
echo "Production Path: $PROD_BACKUP_PATH" >> $BACKUP_SUMMARY
echo "Size: $(du -sh $PROD_BACKUP_PATH | cut -f1)" >> $BACKUP_SUMMARY
echo "URL: https://bob20250810.web.app/" >> $BACKUP_SUMMARY
echo "===" >> $BACKUP_SUMMARY

# Return to original directory
cd ..

echo "🎉 Production release complete!"
echo "🏷️  Production tag: $PROD_TAG"
echo "📁 Production backup: $PROD_BACKUP_PATH"
echo "🌐 Live URL: https://bob20250810.web.app/"
echo ""
echo "Release artifacts created:"
echo "- Git tag: $PROD_TAG"
echo "- Production backup: $PROD_BACKUP_PATH"
echo "- Backup summary: $BACKUP_SUMMARY"
