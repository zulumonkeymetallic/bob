//
//  TaskFilter.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import Foundation

enum TaskFilter: String, CaseIterable {
    case all = "all"
    case todo = "todo"
    case inProgress = "inProgress"
    case completed = "completed"
    case overdue = "overdue"
    
    var displayName: String {
        switch self {
        case .all:
            return "All"
        case .todo:
            return "To Do"
        case .inProgress:
            return "In Progress"
        case .completed:
            return "Completed"
        case .overdue:
            return "Overdue"
        }
    }
}
