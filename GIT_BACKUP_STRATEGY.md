# BOB - Git Backup and Release Strategy

## 📋 **Git Backup Protocol for Major Releases**

### **Phase 1: Pre-Release Backup**
```bash
# 1. Create release tag with current state
git tag -a v2.1.2-backup -m "Backup before v2.1.3 deployment - $(date)"

# 2. Push tag to remote
git push origin v2.1.2-backup

# 3. Create full backup clone
git clone https://github.com/zulumonkeymetallic/bob.git ../bob-backup-v2.1.2
cd ../bob-backup-v2.1.2
git checkout v2.1.2-backup
```

### **Phase 2: Release Tagging**
```bash
# After successful deployment and testing
git tag -a v2.1.3 -m "BOB v2.1.3 - Navigation cleanup, settings consolidation, Steam Connect integration"
git push origin v2.1.3

# Create production backup
git clone https://github.com/zulumonkeymetallic/bob.git ../bob-production-v2.1.3
cd ../bob-production-v2.1.3
git checkout v2.1.3
```

### **Phase 3: Backup Archive Structure**
```
/Users/jim/Github/
├── bob/                    # Active development
├── bob-backups/
│   ├── bob-backup-v2.1.2/  # Pre-release backup
│   ├── bob-production-v2.1.3/ # Post-release backup
│   └── README.md           # Backup index
```

## 🔄 **Automated Backup Script**

```bash
#!/bin/bash
# File: backup-release.sh

VERSION=$1
if [ -z "$VERSION" ]; then
    echo "Usage: ./backup-release.sh v2.1.3"
    exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p ../bob-backups

# Pre-release backup
echo "Creating pre-release backup..."
BACKUP_TAG="${VERSION}-backup"
git tag -a $BACKUP_TAG -m "Backup before $VERSION deployment - $(date)"
git push origin $BACKUP_TAG

# Clone backup
git clone https://github.com/zulumonkeymetallic/bob.git ../bob-backups/bob-backup-$VERSION
cd ../bob-backups/bob-backup-$VERSION
git checkout $BACKUP_TAG

echo "Pre-release backup created: ../bob-backups/bob-backup-$VERSION"
```

## 📅 **Release Schedule Integration**

### **Before Each Release:**
1. Run backup script: `./backup-release.sh v2.1.3`
2. Deploy to staging
3. Test all critical paths
4. Deploy to production
5. Create production tag
6. Archive production backup

### **Backup Retention:**
- Keep last 5 major release backups
- Keep last 10 minor release backups
- Archive older backups to cloud storage

## 🚨 **Emergency Recovery Process**

```bash
# Quick rollback to last known good state
cd ../bob-backups/bob-production-v2.1.2
cp -r . ../../bob/
cd ../../bob
git reset --hard v2.1.2
firebase deploy --only hosting
```

## 📊 **Backup Verification**

After each backup:
1. Verify backup directory exists
2. Test npm install && npm run build
3. Confirm Firebase deployment works
4. Validate core user journeys
5. Document backup location and size

---
**Next Action**: Implement backup script before next deployment
