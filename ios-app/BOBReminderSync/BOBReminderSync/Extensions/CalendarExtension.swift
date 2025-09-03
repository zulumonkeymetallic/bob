//
//  CalendarExtension.swift
//  BOBReminderSync
//
//  Created by GitHub Copilot
//

import Foundation

extension Calendar {
    func isToday(_ date: Date) -> Bool {
        return self.isDate(date, inSameDayAs: Date())
    }
    
    func isTomorrow(_ date: Date) -> Bool {
        guard let tomorrow = self.date(byAdding: .day, value: 1, to: Date()) else {
            return false
        }
        return self.isDate(date, inSameDayAs: tomorrow)
    }
    
    func isYesterday(_ date: Date) -> Bool {
        guard let yesterday = self.date(byAdding: .day, value: -1, to: Date()) else {
            return false
        }
        return self.isDate(date, inSameDayAs: yesterday)
    }
}
