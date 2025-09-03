//
//  SettingsView.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var firebaseService: FirebaseService
    @State private var showingSignOutAlert = false
    
    var body: some View {
        NavigationView {
            List {
                Section(header: Text("Account")) {
                    HStack {
                        Image(systemName: "person.circle")
                            .foregroundColor(.blue)
                        
                        VStack(alignment: .leading) {
                            Text("Signed in as")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            Text(firebaseService.currentUser?.email ?? "Unknown")
                                .font(.subheadline)
                        }
                        
                        Spacer()
                    }
                    .padding(.vertical, 4)
                    
                    Button("Sign Out") {
                        showingSignOutAlert = true
                    }
                    .foregroundColor(.red)
                }
                
                Section(header: Text("Sync Settings")) {
                    HStack {
                        Image(systemName: "arrow.2.circlepath")
                            .foregroundColor(.green)
                        
                        Text("Auto Sync")
                        
                        Spacer()
                        
                        Text("Enabled")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                
                Section(header: Text("About")) {
                    HStack {
                        Image(systemName: "info.circle")
                            .foregroundColor(.blue)
                        
                        Text("Version")
                        
                        Spacer()
                        
                        Text("1.0.0")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                    
                    HStack {
                        Image(systemName: "brain.head.profile")
                            .foregroundColor(.purple)
                        
                        Text("BOB AI")
                        
                        Spacer()
                        
                        Text("Active")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Settings")
        }
        .alert("Sign Out", isPresented: $showingSignOutAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Sign Out", role: .destructive) {
                do {
                    try firebaseService.signOut()
                } catch {
                    print("Failed to sign out: \(error)")
                }
            }
        } message: {
            Text("Are you sure you want to sign out?")
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(FirebaseService.shared)
}
