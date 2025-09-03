//
//  ContentView.swift
//  BOBReminderSync
//
//  Created by jim on 03/09/2025.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var firebaseService = FirebaseService.shared
    @StateObject private var reminderSyncManager = ReminderSyncManager.shared
    @StateObject private var aiService = AIService.shared
    
    var body: some View {
        Group {
            if firebaseService.isAuthenticated {
                MainTabView()
                    .environmentObject(firebaseService)
                    .environmentObject(reminderSyncManager)
                    .environmentObject(aiService)
            } else {
                LoginView()
                    .environmentObject(firebaseService)
            }
        }
        .onAppear {
            // Firebase configuration is handled in FirebaseService.init()
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject var reminderSyncManager: ReminderSyncManager
    
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Image(systemName: "house.fill")
                    Text("Home")
                }
            
            TasksListView()
                .tabItem {
                    Image(systemName: "checkmark.circle.fill")
                    Text("Tasks")
                }
            
            RemindersListView()
                .tabItem {
                    Image(systemName: "bell.fill")
                    Text("Reminders")
                }
            
            SyncStatusView()
                .tabItem {
                    Image(systemName: "arrow.2.circlepath")
                    Text("Sync")
                }
            
            SettingsView()
                .tabItem {
                    Image(systemName: "gear")
                    Text("Settings")
                }
        }
        .accentColor(.blue)
    }
}

struct HomeView: View {
    @EnvironmentObject var reminderSyncManager: ReminderSyncManager
    @EnvironmentObject var aiService: AIService
    @State private var recentTasks: [BOBTask] = []
    @State private var productivityInsights: ProductivityInsights?
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Welcome Section
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Welcome to BOB")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        
                        Text("Your intelligent task and reminder companion")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                    
                    // Quick Stats
                    if let insights = productivityInsights {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Today's Insights")
                                .font(.headline)
                                .padding(.horizontal)
                            
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 16) {
                                    StatCard(
                                        title: "Completion Rate",
                                        value: "\(Int(insights.completionRate * 100))%",
                                        icon: "chart.line.uptrend.xyaxis",
                                        color: .green
                                    )
                                    
                                    StatCard(
                                        title: "Avg Task Time",
                                        value: "\(insights.averageTaskTime, specifier: "%.1f")h",
                                        icon: "clock.fill",
                                        color: .blue
                                    )
                                    
                                    StatCard(
                                        title: "Best Time",
                                        value: insights.mostProductiveTime,
                                        icon: "sun.max.fill",
                                        color: .orange
                                    )
                                }
                                .padding(.horizontal)
                            }
                        }
                    }
                    
                    // Recent Tasks
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Recent Tasks")
                                .font(.headline)
                            
                            Spacer()
                            
                            Button("View All") {
                                // Navigate to tasks view
                            }
                            .font(.caption)
                            .foregroundColor(.blue)
                        }
                        .padding(.horizontal)
                        
                        if recentTasks.isEmpty {
                            Text("No recent tasks")
                                .foregroundColor(.secondary)
                                .padding(.horizontal)
                        } else {
                            ForEach(recentTasks.prefix(3)) { task in
                                TaskRowView(task: task)
                                    .padding(.horizontal)
                            }
                        }
                    }
                    
                    // AI Suggestions
                    if let suggestion = aiService.lastSuggestion {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("AI Suggestion")
                                .font(.headline)
                                .padding(.horizontal)
                            
                            Text(suggestion)
                                .padding()
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(12)
                                .padding(.horizontal)
                        }
                    }
                    
                    // Quick Actions
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Quick Actions")
                            .font(.headline)
                            .padding(.horizontal)
                        
                        HStack(spacing: 16) {
                            QuickActionButton(
                                title: "Add Task",
                                icon: "plus.circle.fill",
                                color: .blue
                            ) {
                                // Add task action
                            }
                            
                            QuickActionButton(
                                title: "Sync Now",
                                icon: "arrow.2.circlepath",
                                color: .green
                            ) {
                                Task {
                                    await reminderSyncManager.performFullSync()
                                }
                            }
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.vertical)
            }
            .navigationBarHidden(true)
        }
        .onAppear {
            loadData()
        }
    }
    
    private func loadData() {
        recentTasks = reminderSyncManager.bobTasks
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(5)
            .map { $0 }
        
        Task {
            do {
                productivityInsights = try await aiService.getProductivityInsights(tasks: reminderSyncManager.bobTasks)
            } catch {
                print("Failed to load productivity insights: \(error)")
            }
        }
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                
                Spacer()
            }
            
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
            
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .frame(width: 120, height: 80)
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct TaskRowView: View {
    let task: BOBTask
    
    var body: some View {
        HStack {
            Circle()
                .fill(Color(task.priority.color))
                .frame(width: 8, height: 8)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.subheadline)
                    .lineLimit(1)
                
                Text(task.status.displayName)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            if task.isOverdue {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.red)
                    .font(.caption)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}

struct QuickActionButton: View {
    let title: String
    let icon: String
    let color: Color
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .font(.title2)
                
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .foregroundColor(.white)
            .padding()
            .frame(maxWidth: .infinity)
            .background(color)
            .cornerRadius(12)
        }
    }
}

#Preview {
    ContentView()
}
