//
//  SyncStatusView.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import SwiftUI

struct SyncStatusView: View {
    @EnvironmentObject var reminderSyncManager: ReminderSyncManager
    
    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                // Status Card
                VStack(spacing: 16) {
                    Image(systemName: syncStatusIcon)
                        .font(.system(size: 60))
                        .foregroundColor(syncStatusColor)
                    
                    Text(reminderSyncManager.syncStatus.displayText)
                        .font(.headline)
                        .multilineTextAlignment(.center)
                    
                    if let lastSync = reminderSyncManager.lastSyncDate {
                        Text("Last sync: \(lastSync, formatter: dateFormatter)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(16)
                .padding(.horizontal)
                
                // Stats
                VStack(spacing: 16) {
                    Text("Sync Statistics")
                        .font(.headline)
                    
                    HStack(spacing: 20) {
                        StatView(
                            title: "BOB Tasks",
                            value: "\(reminderSyncManager.bobTasks.count)",
                            color: .blue
                        )
                        
                        StatView(
                            title: "iOS Reminders",
                            value: "\(reminderSyncManager.reminders.count)",
                            color: .green
                        )
                    }
                }
                .padding(.horizontal)
                
                // Sync Button
                Button(action: {
                    Task {
                        await reminderSyncManager.performFullSync()
                    }
                }) {
                    HStack {
                        if reminderSyncManager.syncStatus == .syncing {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.2.circlepath")
                        }
                        
                        Text("Sync Now")
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(reminderSyncManager.syncStatus == .syncing)
                .padding(.horizontal)
                
                Spacer()
            }
            .padding(.top)
            .navigationTitle("Sync")
        }
    }
    
    private var syncStatusIcon: String {
        switch reminderSyncManager.syncStatus {
        case .idle:
            return "clock"
        case .syncing:
            return "arrow.2.circlepath"
        case .completed:
            return "checkmark.circle.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        }
    }
    
    private var syncStatusColor: Color {
        switch reminderSyncManager.syncStatus {
        case .idle:
            return .orange
        case .syncing:
            return .blue
        case .completed:
            return .green
        case .failed:
            return .red
        }
    }
    
    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }
}

struct StatView: View {
    let title: String
    let value: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 8) {
            Text(value)
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(color)
            
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

#Preview {
    SyncStatusView()
        .environmentObject(ReminderSyncManager.shared)
}
