#!/bin/bash

# Script to add Firebase SDK to BOB iOS project
# This script will modify the Xcode project to include Firebase dependencies

PROJECT_PATH="/Users/jim/Github/bob/ios-app/BOBReminderSync/BOBReminderSync.xcodeproj"
FIREBASE_SDK_URL="https://github.com/firebase/firebase-ios-sdk"

echo "🔥 Adding Firebase SDK to BOB iOS project..."

# Create a temporary Package.swift approach by creating a workspace
cd /Users/jim/Github/bob/ios-app/BOBReminderSync

# Method 1: Try to create a Package.swift file temporarily
cat > Package.swift << 'EOF'
// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "BOBReminderSync",
    platforms: [
        .iOS(.v15)
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk", from: "10.0.0")
    ],
    targets: [
        .target(
            name: "BOBReminderSync",
            dependencies: [
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk")
            ]
        )
    ]
)
EOF

echo "✅ Package.swift created with Firebase dependencies"

# Try to resolve dependencies
echo "📦 Resolving Firebase dependencies..."
swift package resolve

echo "🎯 Firebase SDK setup script completed!"
echo "Next: Open Xcode and manually add Firebase SDK via File > Add Package Dependencies"
echo "URL: https://github.com/firebase/firebase-ios-sdk"
