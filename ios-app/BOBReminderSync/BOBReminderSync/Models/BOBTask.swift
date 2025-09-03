//
//  BOBTask.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import Foundation

struct BOBTask: Identifiable, Codable, Equatable {
    var id: UUID
    var title: String
    var description: String
    var status: TaskStatus
    var priority: TaskPriority
    var createdAt: Date
    var updatedAt: Date
    var dueDate: Date?
    var estimatedHours: Double?
    var tags: [String]
    
    init(title: String, description: String = "", status: TaskStatus = .todo, priority: TaskPriority = .medium, dueDate: Date? = nil, estimatedHours: Double? = nil, tags: [String] = []) {
        self.id = UUID()
        self.title = title
        self.description = description
        self.status = status
        self.priority = priority
        self.createdAt = Date()
        self.updatedAt = Date()
        self.dueDate = dueDate
        self.estimatedHours = estimatedHours
        self.tags = tags
    }
    
    mutating func updateStatus(_ newStatus: TaskStatus) {
        self.status = newStatus
        self.updatedAt = Date()
    }
    
    mutating func updateTitle(_ newTitle: String) {
        self.title = newTitle
        self.updatedAt = Date()
    }
    
    mutating func updateDescription(_ newDescription: String) {
        self.description = newDescription
        self.updatedAt = Date()
    }
    
    mutating func updatePriority(_ newPriority: TaskPriority) {
        self.priority = newPriority
        self.updatedAt = Date()
    }
    
    var isOverdue: Bool {
        guard let dueDate = dueDate else { return false }
        return Date() > dueDate && status != .completed
    }
    
    var progressPercentage: Double {
        switch status {
        case .todo:
            return 0.0
        case .inProgress:
            return 0.5
        case .completed:
            return 1.0
        case .blocked:
            return 0.25
        }
    }
    
    static func fromFirebaseData(_ data: [String: Any]) -> BOBTask? {
        guard 
            let idString = data["id"] as? String,
            let id = UUID(uuidString: idString),
            let title = data["title"] as? String,
            let description = data["description"] as? String,
            let statusString = data["status"] as? String,
            let status = TaskStatus(rawValue: statusString),
            let priorityString = data["priority"] as? String,
            let priority = TaskPriority(rawValue: priorityString),
            let createdAt = data["createdAt"] as? Date,
            let updatedAt = data["updatedAt"] as? Date
        else {
            return nil
        }
        
        var task = BOBTask(title: title, description: description, status: status, priority: priority)
        task.id = id
        task.createdAt = createdAt
        task.updatedAt = updatedAt
        task.dueDate = data["dueDate"] as? Date
        task.estimatedHours = data["estimatedHours"] as? Double
        task.tags = data["tags"] as? [String] ?? []
        
        return task
    }
}

enum TaskStatus: String, CaseIterable, Codable {
    case todo = "todo"
    case inProgress = "in_progress"
    case completed = "completed"
    case blocked = "blocked"
    
    var displayName: String {
        switch self {
        case .todo:
            return "To Do"
        case .inProgress:
            return "In Progress"
        case .completed:
            return "Completed"
        case .blocked:
            return "Blocked"
        }
    }
    
    var color: String {
        switch self {
        case .todo:
            return "blue"
        case .inProgress:
            return "orange"
        case .completed:
            return "green"
        case .blocked:
            return "red"
        }
    }
}

enum TaskPriority: String, CaseIterable, Codable {
    case low = "low"
    case medium = "medium"
    case high = "high"
    case urgent = "urgent"
    
    var displayName: String {
        switch self {
        case .low:
            return "Low"
        case .medium:
            return "Medium"
        case .high:
            return "High"
        case .urgent:
            return "Urgent"
        }
    }
    
    var color: String {
        switch self {
        case .low:
            return "gray"
        case .medium:
            return "blue"
        case .high:
            return "orange"
        case .urgent:
            return "red"
        }
    }
    
    var weight: Int {
        switch self {
        case .low:
            return 1
        case .medium:
            return 2
        case .high:
            return 3
        case .urgent:
            return 4
        }
    }
}
