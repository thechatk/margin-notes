import Foundation

// Two short, isolated Shift taps. Typing and modifier chords reset the gesture.
struct ShiftGesture {
    private var pressedAt: TimeInterval?
    private var lastTap: TimeInterval?
    mutating func step(time: TimeInterval, shiftDown: Bool? = nil, interrupted: Bool = false) -> Bool {
        if interrupted { pressedAt = nil; lastTap = nil; return false }
        guard let shiftDown else { return false }
        if shiftDown {
            if pressedAt != nil { lastTap = nil }
            pressedAt = time
            return false
        }
        defer { pressedAt = nil }
        guard let start = pressedAt, time >= start, time - start <= 0.25 else { lastTap = nil; return false }
        if let previous = lastTap, start >= previous, time - previous <= 0.45 {
            lastTap = nil
            return true
        }
        lastTap = time
        return false
    }
}
