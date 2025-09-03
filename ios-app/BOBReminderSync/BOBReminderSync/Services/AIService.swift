//
//  AIService.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import Foundation

@MainActor
class AIService: ObservableObject {
    static let shared = AIService()
    
    private let baseURL = "https://us-central1-bob-reminder-sync.cloudfunctions.net"
    private let session = URLSession.shared
    
    @Published var isProcessing = false
    @Published var lastSuggestion: String?
    
    private init() {}
    
    // MARK: - Task Analysis
    
    func analyzeTaskPriority(title: String, description: String, dueDate: Date?) async throws -> TaskPriority {
        isProcessing = true
        defer { isProcessing = false }
        
        let requestData = TaskAnalysisRequest(
            title: title,
            description: description,
            dueDate: dueDate
        )
        
        let response: TaskAnalysisResponse = try await makeAPICall(
            endpoint: "/analyzeTaskPriority",
            method: "POST",
            body: requestData
        )
        
        return TaskPriority(rawValue: response.priority) ?? .medium
    }
    
    func suggestTaskBreakdown(title: String, description: String) async throws -> [String] {
        isProcessing = true
        defer { isProcessing = false }
        
        let requestData = TaskBreakdownRequest(
            title: title,
            description: description
        )
        
        let response: TaskBreakdownResponse = try await makeAPICall(
            endpoint: "/suggestTaskBreakdown",
            method: "POST",
            body: requestData
        )
        
        return response.subtasks
    }
    
    func generateTaskSuggestions(context: [BOBTask]) async throws -> [String] {
        isProcessing = true
        defer { isProcessing = false }
        
        let requestData = TaskSuggestionsRequest(
            existingTasks: context.map { task in
                TaskContext(
                    title: task.title,
                    description: task.description,
                    status: task.status.rawValue,
                    priority: task.priority.rawValue,
                    tags: task.tags
                )
            }
        )
        
        let response: TaskSuggestionsResponse = try await makeAPICall(
            endpoint: "/generateTaskSuggestions",
            method: "POST",
            body: requestData
        )
        
        lastSuggestion = response.suggestions.first
        return response.suggestions
    }
    
    // MARK: - Productivity Insights
    
    func getProductivityInsights(tasks: [BOBTask]) async throws -> ProductivityInsights {
        isProcessing = true
        defer { isProcessing = false }
        
        let requestData = ProductivityAnalysisRequest(
            tasks: tasks.map { task in
                TaskAnalysisData(
                    id: task.id.uuidString,
                    title: task.title,
                    status: task.status.rawValue,
                    priority: task.priority.rawValue,
                    createdAt: ISO8601DateFormatter().string(from: task.createdAt),
                    updatedAt: ISO8601DateFormatter().string(from: task.updatedAt),
                    dueDate: task.dueDate.map { ISO8601DateFormatter().string(from: $0) },
                    estimatedHours: task.estimatedHours,
                    tags: task.tags
                )
            }
        )
        
        let response: ProductivityInsightsResponse = try await makeAPICall(
            endpoint: "/getProductivityInsights",
            method: "POST",
            body: requestData
        )
        
        return ProductivityInsights(
            completionRate: response.completionRate,
            averageTaskTime: response.averageTaskTime,
            mostProductiveTime: response.mostProductiveTime,
            recommendations: response.recommendations,
            trends: response.trends
        )
    }
    
    // MARK: - Smart Scheduling
    
    func suggestOptimalSchedule(tasks: [BOBTask], availableHours: Double) async throws -> [ScheduleSuggestion] {
        isProcessing = true
        defer { isProcessing = false }
        
        let requestData = SchedulingRequest(
            tasks: tasks.filter { $0.status != .completed }.map { task in
                ScheduleTaskData(
                    id: task.id.uuidString,
                    title: task.title,
                    priority: task.priority.rawValue,
                    estimatedHours: task.estimatedHours ?? 1.0,
                    dueDate: task.dueDate.map { ISO8601DateFormatter().string(from: $0) }
                )
            },
            availableHours: availableHours
        )
        
        let response: SchedulingSuggestionResponse = try await makeAPICall(
            endpoint: "/suggestOptimalSchedule",
            method: "POST",
            body: requestData
        )
        
        return response.suggestions.compactMap { suggestion in
            let formatter = ISO8601DateFormatter()
            guard let startTime = formatter.date(from: suggestion.startTime),
                  let endTime = formatter.date(from: suggestion.endTime),
                  let taskId = UUID(uuidString: suggestion.taskId) else {
                return nil
            }
            
            return ScheduleSuggestion(
                taskId: taskId,
                title: suggestion.title,
                startTime: startTime,
                endTime: endTime,
                reason: suggestion.reason
            )
        }
    }
    
    // MARK: - Generic API Call
    
    private func makeAPICall<Request: Codable, Response: Codable>(
        endpoint: String,
        method: String,
        body: Request
    ) async throws -> Response {
        guard let url = URL(string: "\(baseURL)\(endpoint)") else {
            throw AIServiceError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Add authentication token if available
        if let token = await getAuthToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIServiceError.invalidResponse
        }
        
        guard 200...299 ~= httpResponse.statusCode else {
            throw AIServiceError.serverError(httpResponse.statusCode)
        }
        
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Response.self, from: data)
    }
    
    private func getAuthToken() async -> String? {
        // Get Firebase Auth token
        guard let user = FirebaseService.shared.currentUser else { return nil }
        
        do {
            let token = try await user.getIDToken()
            return token
        } catch {
            print("Failed to get auth token: \(error)")
            return nil
        }
    }
}

// MARK: - Request/Response Models

struct TaskAnalysisRequest: Codable {
    let title: String
    let description: String
    let dueDate: Date?
}

struct TaskAnalysisResponse: Codable {
    let priority: String
    let reasoning: String
}

struct TaskBreakdownRequest: Codable {
    let title: String
    let description: String
}

struct TaskBreakdownResponse: Codable {
    let subtasks: [String]
}

struct TaskSuggestionsRequest: Codable {
    let existingTasks: [TaskContext]
}

struct TaskContext: Codable {
    let title: String
    let description: String
    let status: String
    let priority: String
    let tags: [String]
}

struct TaskSuggestionsResponse: Codable {
    let suggestions: [String]
}

struct ProductivityAnalysisRequest: Codable {
    let tasks: [TaskAnalysisData]
}

struct TaskAnalysisData: Codable {
    let id: String
    let title: String
    let status: String
    let priority: String
    let createdAt: String
    let updatedAt: String
    let dueDate: String?
    let estimatedHours: Double?
    let tags: [String]
}

struct ProductivityInsightsResponse: Codable {
    let completionRate: Double
    let averageTaskTime: Double
    let mostProductiveTime: String
    let recommendations: [String]
    let trends: [String]
}

struct SchedulingRequest: Codable {
    let tasks: [ScheduleTaskData]
    let availableHours: Double
}

struct ScheduleTaskData: Codable {
    let id: String
    let title: String
    let priority: String
    let estimatedHours: Double
    let dueDate: String?
}

struct SchedulingSuggestionResponse: Codable {
    let suggestions: [ScheduleSuggestionData]
}

struct ScheduleSuggestionData: Codable {
    let taskId: String
    let title: String
    let startTime: String
    let endTime: String
    let reason: String
}

// MARK: - Data Models

struct ProductivityInsights {
    let completionRate: Double
    let averageTaskTime: Double
    let mostProductiveTime: String
    let recommendations: [String]
    let trends: [String]
}

struct ScheduleSuggestion {
    let taskId: UUID
    let title: String
    let startTime: Date
    let endTime: Date
    let reason: String
}

enum AIServiceError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case serverError(Int)
    case decodingError
    case authenticationRequired
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .serverError(let code):
            return "Server error: \(code)"
        case .decodingError:
            return "Failed to decode response"
        case .authenticationRequired:
            return "Authentication required"
        }
    }
}
