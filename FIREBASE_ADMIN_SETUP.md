# Firebase Admin SDK Setup Instructions

## Prerequisites

1. **Service Account Key**
   ```bash
   # Download service account key from Firebase Console
   # Project Settings > Service Accounts > Generate Private Key
   ```

2. **Environment Variables**
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
   export FIREBASE_PROJECT_ID="bob20250810"
   export TEST_SECRET="your-secure-test-secret"
   ```

3. **Alternative: Service Account JSON directly**
   ```bash
   export FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   export FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxxx@bob20250810.iam.gserviceaccount.com"
   export FIREBASE_PROJECT_ID="bob20250810"
   ```

## Setup Instructions

### Option 1: Service Account Key File (Recommended)
1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate Private Key" 
3. Save the JSON file securely
4. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/bob-firebase-adminsdk.json"
   ```

### Option 2: Environment Variables
Set these environment variables with your service account details:
```bash
export FIREBASE_PROJECT_ID="bob20250810"
export FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
export FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxxx@bob20250810.iam.gserviceaccount.com"
```

## Usage

### Create Test Users
```bash
# With service account file
GOOGLE_APPLICATION_CREDENTIALS="./firebase-key.json" \
TEST_SECRET="your-secret" \
node create-secure-test-users.js --env development

# Dry run first
node create-secure-test-users.js --dry-run --env development --secret your-secret

# Create specific users
node create-secure-test-users.js --env development --secret your-secret --users "test@example.com,admin@example.com"
```

### Security Notes
- Never commit service account keys to version control
- Use environment variables or secure key management
- Rotate keys regularly
- Restrict service account permissions to minimum required

## Verification

Test the setup:
```bash
node create-secure-test-users.js --list-existing --env development --secret your-secret
```
