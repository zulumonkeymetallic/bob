//
//  AISuggestionsView.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import SwiftUI
import Foundation

struct AISuggestionsView: View {
    let suggestions: [String]
    
    var body: some View {
        NavigationView {
            VStack {
                Text("AI Suggestions Coming Soon")
                    .font(.title2)
                Text("Suggestions: \(suggestions.count)")
                    .foregroundColor(.secondary)
            }
            .navigationTitle("AI Suggestions")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

#Preview {
    AISuggestionsView(suggestions: ["Sample suggestion"])
}
