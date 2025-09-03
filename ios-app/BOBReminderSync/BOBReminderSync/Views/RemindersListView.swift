//
//  RemindersListView.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import SwiftUI
import EventKit

struct RemindersListView: View {
    @EnvironmentObject var reminderSyncManager: ReminderSyncManager
    
    var body: some View {
        NavigationView {
            List {
                ForEach(reminderSyncManager.reminders, id: \.calendarItemIdentifier) { reminder in
                    ReminderRowView(reminder: reminder)
                }
            }
            .navigationTitle("Reminders")
            .refreshable {
                await reminderSyncManager.performFullSync()
            }
        }
    }
}

struct ReminderRowView: View {
    let reminder: EKReminder
    
    var body: some View {
        HStack {
            Image(systemName: reminder.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundColor(reminder.isCompleted ? .green : .gray)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(reminder.title ?? "Untitled")
                    .strikethrough(reminder.isCompleted)
                
                if let notes = reminder.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }
            
            Spacer()
            
            if let alarm = reminder.alarms?.first, let date = alarm.absoluteDate {
                Text(date, style: .date)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

#Preview {
    RemindersListView()
        .environmentObject(ReminderSyncManager.shared)
}
