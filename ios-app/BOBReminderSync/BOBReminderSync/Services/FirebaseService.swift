//
//  FirebaseService.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import Foundation
import FirebaseCore
import FirebaseFirestore
import FirebaseAuth

@MainActor
class FirebaseService: ObservableObject {
    static let shared = FirebaseService()
    
    private let db = Firestore.firestore()
    private let auth = Auth.auth()
    
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    
    private init() {
        setupFirebase()
        setupAuthListener()
    }
    
    private func setupFirebase() {
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
    }
    
    private func setupAuthListener() {
        auth.addStateDidChangeListener { [weak self] _, user in
            DispatchQueue.main.async {
                self?.currentUser = user
                self?.isAuthenticated = user != nil
            }
        }
    }
    
    // MARK: - Authentication
    
    func signIn(email: String, password: String) async throws {
        try await auth.signIn(withEmail: email, password: password)
    }
    
    func signUp(email: String, password: String) async throws {
        try await auth.createUser(withEmail: email, password: password)
    }
    
    func signOut() throws {
        try auth.signOut()
    }
    
    // MARK: - BOB Tasks Management
    
    func saveBOBTask(_ task: BOBTask) async throws {
        guard let userId = auth.currentUser?.uid else {
            throw FirebaseError.notAuthenticated
        }
        
        let taskData: [String: Any] = [
            "id": task.id.uuidString,
            "title": task.title,
            "description": task.description,
            "status": task.status.rawValue,
            "priority": task.priority.rawValue,
            "createdAt": task.createdAt,
            "updatedAt": task.updatedAt,
            "dueDate": task.dueDate as Any,
            "estimatedHours": task.estimatedHours as Any,
            "tags": task.tags,
            "userId": userId
        ]
        
        try await db.collection("users").document(userId).collection("tasks").document(task.id.uuidString).setData(taskData)
    }
    
    func fetchBOBTasks() async throws -> [BOBTask] {
        guard let userId = auth.currentUser?.uid else {
            throw FirebaseError.notAuthenticated
        }
        
        let snapshot = try await db.collection("users").document(userId).collection("tasks").getDocuments()
        
        return snapshot.documents.compactMap { document in
            let data = document.data()
            return BOBTask.fromFirebaseData(data)
        }
    }
    
    func deleteBOBTask(_ taskId: UUID) async throws {
        guard let userId = auth.currentUser?.uid else {
            throw FirebaseError.notAuthenticated
        }
        
        try await db.collection("users").document(userId).collection("tasks").document(taskId.uuidString).delete()
    }
    
    // MARK: - User Preferences
    
    func saveUserPreferences(_ preferences: [String: Any]) async throws {
        guard let userId = auth.currentUser?.uid else {
            throw FirebaseError.notAuthenticated
        }
        
        try await db.collection("users").document(userId).updateData(["preferences": preferences])
    }
    
    func fetchUserPreferences() async throws -> [String: Any] {
        guard let userId = auth.currentUser?.uid else {
            throw FirebaseError.notAuthenticated
        }
        
        let document = try await db.collection("users").document(userId).getDocument()
        return document.data()?["preferences"] as? [String: Any] ?? [:]
    }
}

enum FirebaseError: Error, LocalizedError {
    case notAuthenticated
    case invalidData
    case networkError
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "User is not authenticated"
        case .invalidData:
            return "Invalid data format"
        case .networkError:
            return "Network connection error"
        }
    }
}
