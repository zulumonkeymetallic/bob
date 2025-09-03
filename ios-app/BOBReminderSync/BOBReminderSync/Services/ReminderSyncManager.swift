//
//  ReminderSyncManager.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import Foundation
import EventKit

@MainActor
class ReminderSyncManager: ObservableObject {
    static let shared = ReminderSyncManager()
    
    private let eventStore = EKEventStore()
    private let firebaseService = FirebaseService.shared
    
    @Published var syncStatus: SyncStatus = .idle
    @Published var lastSyncDate: Date?
    @Published var reminders: [EKReminder] = []
    @Published var bobTasks: [BOBTask] = []
    
    private init() {
        requestAccess()
    }
    
    private func requestAccess() {
        eventStore.requestFullAccessToReminders { [weak self] granted, error in
            DispatchQueue.main.async {
                if granted {
                    print("Reminders access granted")
                    Task {
                        await self?.loadReminders()
                        await self?.loadBOBTasks()
                    }
                } else {
                    print("Reminders access denied: \(error?.localizedDescription ?? "Unknown error")")
                }
            }
        }
    }
    
    // MARK: - Sync Operations
    
    func performFullSync() async {
        syncStatus = .syncing
        
        do {
            // Load data from both sources
            await loadReminders()
            await loadBOBTasks()
            
            // Sync BOB tasks to iOS Reminders
            try await syncBOBTasksToReminders()
            
            // Sync iOS Reminders to BOB tasks
            try await syncRemindersToBOBTasks()
            
            lastSyncDate = Date()
            syncStatus = .completed
            
        } catch {
            print("Sync failed: \(error)")
            syncStatus = .failed(error)
        }
    }
    
    private func syncBOBTasksToReminders() async throws {
        for bobTask in bobTasks {
            if let existingReminder = findReminderForBOBTask(bobTask) {
                // Update existing reminder
                updateReminder(existingReminder, with: bobTask)
            } else {
                // Create new reminder
                try createReminderFromBOBTask(bobTask)
            }
        }
        
        try eventStore.commit()
    }
    
    private func syncRemindersToBOBTasks() async throws {
        for reminder in reminders {
            if let existingTask = findBOBTaskForReminder(reminder) {
                // Update existing BOB task
                var updatedTask = existingTask
                updateBOBTask(&updatedTask, with: reminder)
                try await firebaseService.saveBOBTask(updatedTask)
            } else {
                // Create new BOB task
                let newTask = createBOBTaskFromReminder(reminder)
                try await firebaseService.saveBOBTask(newTask)
            }
        }
        
        // Reload BOB tasks after sync
        await loadBOBTasks()
    }
    
    // MARK: - Data Loading
    
    private func loadReminders() async {
        let calendars = eventStore.calendars(for: .reminder)
        let predicate = eventStore.predicateForReminders(in: calendars)
        
        return await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { [weak self] reminders in
                DispatchQueue.main.async {
                    self?.reminders = reminders ?? []
                    continuation.resume()
                }
            }
        }
    }
    
    private func loadBOBTasks() async {
        do {
            bobTasks = try await firebaseService.fetchBOBTasks()
        } catch {
            print("Failed to load BOB tasks: \(error)")
        }
    }
    
    // MARK: - Helper Methods
    
    private func findReminderForBOBTask(_ bobTask: BOBTask) -> EKReminder? {
        return reminders.first { reminder in
            reminder.notes?.contains("BOB-ID:\(bobTask.id.uuidString)") == true
        }
    }
    
    private func findBOBTaskForReminder(_ reminder: EKReminder) -> BOBTask? {
        if let notes = reminder.notes,
           let range = notes.range(of: "BOB-ID:"),
           let endRange = notes.range(of: "\n", range: range.upperBound..<notes.endIndex) {
            let idString = String(notes[range.upperBound..<endRange.lowerBound])
            if let uuid = UUID(uuidString: idString) {
                return bobTasks.first { $0.id == uuid }
            }
        }
        return nil
    }
    
    private func updateReminder(_ reminder: EKReminder, with bobTask: BOBTask) {
        reminder.title = bobTask.title
        reminder.notes = "\(bobTask.description)\n\nBOB-ID:\(bobTask.id.uuidString)"
        reminder.isCompleted = bobTask.status == .completed
        
        if let dueDate = bobTask.dueDate {
            let alarm = EKAlarm(absoluteDate: dueDate)
            reminder.alarms = [alarm]
        }
        
        // Set priority
        switch bobTask.priority {
        case .low:
            reminder.priority = 1
        case .medium:
            reminder.priority = 5
        case .high:
            reminder.priority = 8
        case .urgent:
            reminder.priority = 9
        }
    }
    
    private func createReminderFromBOBTask(_ bobTask: BOBTask) throws {
        let reminder = EKReminder(eventStore: eventStore)
        let calendar = eventStore.defaultCalendarForNewReminders()
        
        reminder.calendar = calendar
        reminder.title = bobTask.title
        reminder.notes = "\(bobTask.description)\n\nBOB-ID:\(bobTask.id.uuidString)"
        reminder.isCompleted = bobTask.status == .completed
        
        if let dueDate = bobTask.dueDate {
            let alarm = EKAlarm(absoluteDate: dueDate)
            reminder.alarms = [alarm]
        }
        
        // Set priority
        switch bobTask.priority {
        case .low:
            reminder.priority = 1
        case .medium:
            reminder.priority = 5
        case .high:
            reminder.priority = 8
        case .urgent:
            reminder.priority = 9
        }
        
        try eventStore.save(reminder, commit: false)
    }
    
    private func updateBOBTask(_ bobTask: inout BOBTask, with reminder: EKReminder) {
        bobTask.updateTitle(reminder.title ?? "")
        
        if let notes = reminder.notes {
            let description = notes.components(separatedBy: "\n\nBOB-ID:").first ?? ""
            bobTask.updateDescription(description)
        }
        
        let newStatus: TaskStatus = reminder.isCompleted ? .completed : .todo
        bobTask.updateStatus(newStatus)
        
        // Convert priority
        let newPriority: TaskPriority
        switch reminder.priority {
        case 1...2:
            newPriority = .low
        case 3...6:
            newPriority = .medium
        case 7...8:
            newPriority = .high
        case 9:
            newPriority = .urgent
        default:
            newPriority = .medium
        }
        bobTask.updatePriority(newPriority)
    }
    
    private func createBOBTaskFromReminder(_ reminder: EKReminder) -> BOBTask {
        let title = reminder.title ?? "Untitled Reminder"
        let description = reminder.notes?.components(separatedBy: "\n\nBOB-ID:").first ?? ""
        let status: TaskStatus = reminder.isCompleted ? .completed : .todo
        
        let priority: TaskPriority
        switch reminder.priority {
        case 1...2:
            priority = .low
        case 3...6:
            priority = .medium
        case 7...8:
            priority = .high
        case 9:
            priority = .urgent
        default:
            priority = .medium
        }
        
        let dueDate = reminder.alarms?.first?.absoluteDate
        
        return BOBTask(
            title: title,
            description: description,
            status: status,
            priority: priority,
            dueDate: dueDate
        )
    }
}

enum SyncStatus: Equatable {
    case idle
    case syncing
    case completed
    case failed(Error)
    
    static func == (lhs: SyncStatus, rhs: SyncStatus) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.syncing, .syncing), (.completed, .completed):
            return true
        case (.failed, .failed):
            return true
        default:
            return false
        }
    }
    
    var displayText: String {
        switch self {
        case .idle:
            return "Ready to sync"
        case .syncing:
            return "Syncing..."
        case .completed:
            return "Sync completed"
        case .failed(let error):
            return "Sync failed: \(error.localizedDescription)"
        }
    }
}
