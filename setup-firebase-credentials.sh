#!/bin/bash

# Firebase Admin SDK Setup Helper
# This script helps you configure Firebase credentials for test user creation

echo "🔐 Firebase Admin SDK Setup Helper"
echo "=================================="
echo

# Check if already configured
if [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    echo "✅ GOOGLE_APPLICATION_CREDENTIALS is set: $GOOGLE_APPLICATION_CREDENTIALS"
    if [ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
        echo "✅ Service account file exists"
    else
        echo "❌ Service account file not found"
    fi
elif [ -n "$FIREBASE_PRIVATE_KEY" ] && [ -n "$FIREBASE_CLIENT_EMAIL" ]; then
    echo "✅ Firebase environment variables are set"
    echo "   CLIENT_EMAIL: $FIREBASE_CLIENT_EMAIL"
    echo "   PROJECT_ID: ${FIREBASE_PROJECT_ID:-bob20250810}"
else
    echo "❌ Firebase credentials not configured"
    echo
    echo "📋 Setup Options:"
    echo
    echo "Option 1: Service Account Key File (Recommended)"
    echo "------------------------------------------------"
    echo "1. Go to: https://console.firebase.google.com/project/bob20250810/settings/serviceaccounts/adminsdk"
    echo "2. Click 'Generate Private Key'"
    echo "3. Save the file as 'firebase-service-account.json'"
    echo "4. Run: export GOOGLE_APPLICATION_CREDENTIALS=\"$(pwd)/firebase-service-account.json\""
    echo
    echo "Option 2: Environment Variables"
    echo "-------------------------------"
    echo "Set these environment variables with your service account details:"
    echo "export FIREBASE_PROJECT_ID=\"bob20250810\""
    echo "export FIREBASE_PRIVATE_KEY=\"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n\""
    echo "export FIREBASE_CLIENT_EMAIL=\"firebase-adminsdk-xxxxx@bob20250810.iam.gserviceaccount.com\""
    echo
fi

echo
echo "🧪 Test the configuration:"
echo "node create-secure-test-users.js --dry-run --env development --secret test-secret-2025"
echo
