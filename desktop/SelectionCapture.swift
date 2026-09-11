import AppKit
import ApplicationServices

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    AXUIElementSetMessagingTimeout(element, 0.08)
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
private func axElement(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

struct ClipboardSnapshot {
    let items: [NSPasteboardItem]
    let version: Int
    init?(_ board: NSPasteboard) {
        let version = board.changeCount
        var items: [NSPasteboardItem] = [], bytes = 0
        for original in board.pasteboardItems ?? [] {
            let item = NSPasteboardItem()
            for type in original.types {
                guard let data = original.data(forType: type) else { return nil }
                bytes += data.count
                // ponytail: cap clipboard snapshots at 32 MB; streaming is needed for larger payloads.
                guard bytes <= 32 * 1024 * 1024, item.setData(data, forType: type) else { return nil }
            }
            items.append(item)
        }
        guard board.changeCount == version else { return nil }
        self.items = items; self.version = version
    }
    @discardableResult func restore(_ board: NSPasteboard, ifUnchanged version: Int) -> Bool {
        guard board.changeCount == version else { return false }
        board.clearContents()
        return items.isEmpty || board.writeObjects(items)
    }
}

final class SelectionCapture {
    private let queue = DispatchQueue(label: "margin.selection", qos: .userInitiated)
    private var busy = false, interrupted = false
    static let copyEventTag: Int64 = 0x4D4E434F5059
    func observe(_ event: NSEvent) {
        if busy, event.cgEvent?.getIntegerValueField(.eventSourceUserData) != Self.copyEventTag { interrupted = true }
    }
    func capture(from app: NSRunningApplication, completion: @escaping ([String: Any]) -> Void) {
        guard !busy else { return }
        busy = true; interrupted = false
        let pid = app.processIdentifier
        var value: [String: Any] = ["id": UUID().uuidString, "quote": "", "source": app.localizedName ?? "Application", "trusted": AXIsProcessTrusted()]
        var context: [String: Any] = ["capturedAt": ISO8601DateFormatter().string(from: Date()), "bundleId": app.bundleIdentifier ?? "", "locationStatus": "unresolved"]
        func finish(_ result: [String: Any]) { self.busy = false; completion(result) }
        guard AXIsProcessTrusted() else {
            value["message"] = "Enable Accessibility for Margin Notes to capture your selection."
            finish(value); return
        }
        queue.async {
            let application = AXUIElementCreateApplication(pid)
            let focused = axElement(attribute(application, kAXFocusedUIElementAttribute))
            let window = axElement(attribute(application, kAXFocusedWindowAttribute))
            if let window, let title = attribute(window, kAXTitleAttribute) as? String { context["windowTitle"] = String(title.prefix(2048)) }
            var quote = "", secure = false, chain: [AXUIElement] = []
            var cursor = focused
            for _ in 0..<8 {
                guard let element = cursor else { break }
                chain.append(element)
                if (attribute(element, kAXSubroleAttribute) as? String) == kAXSecureTextFieldSubrole { secure = true; break }
                cursor = axElement(attribute(element, kAXParentAttribute))
            }
            if !secure {
                if let focused { quote = attribute(focused, kAXSelectedTextAttribute) as? String ?? "" }
                let containers = chain + (window.map { [$0] } ?? [])
                for name in [kAXDocumentAttribute, kAXURLAttribute] {
                    for element in containers {
                        if context["document"] != nil { break }
                        let role = attribute(element, kAXRoleAttribute) as? String
                        if name == kAXURLAttribute, role != "AXWebArea", role != "AXDocument" { continue }
                        let raw = attribute(element, name)
                        let location = (raw as? URL)?.absoluteString ?? (raw as? String)
                        guard let location, location.utf16.count <= 8192 else { continue }
                        let url = location.hasPrefix("/") ? URL(fileURLWithPath: location) : URL(string: location)
                        guard let url, ["file", "http", "https"].contains(url.scheme?.lowercased() ?? "") else { continue }
                        context["document"] = ["value": url.isFileURL ? url.path : url.absoluteString, "kind": url.isFileURL ? "file" : "url", "observedFrom": "accessibility"]
                        context["locationStatus"] = "partial"
                    }
                }
            }
            // AX ranges refer to the focused element, which may be a rendered view rather than file bytes.
            if !secure, let focused, let raw = attribute(focused, kAXSelectedTextRangeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() {
                var range = CFRange()
                if AXValueGetValue(raw as! AXValue, .cfRange, &range), range.location >= 0, range.length > 0 {
                    if let text = attribute(focused, kAXValueAttribute) as? String, text.utf16.count <= 2 * 1024 * 1024 {
                        let full = text as NSString
                        if range.location <= full.length, range.length <= full.length - range.location {
                            let selection = full.substring(with: NSRange(location: range.location, length: range.length))
                            if !quote.isEmpty, selection == quote {
                                context["range"] = ["start": range.location, "length": range.length, "unit": "utf16", "scope": "element"]
                                let before = full.substring(to: range.location), after = full.substring(from: range.location + range.length)
                                context["prefix"] = String(before.suffix(64)); context["suffix"] = String(after.prefix(64))
                                if context["document"] != nil { context["locationStatus"] = "verified" }
                            }
                        }
                    }
                }
            }
            DispatchQueue.main.async {
                guard !self.interrupted, NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { value["message"] = "The active app changed during capture. Select the passage and press Shift twice again."; finish(value); return }
                guard !secure else { value["message"] = "Password fields cannot be annotated."; finish(value); return }
                if !quote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    context["captureMethod"] = "accessibility"; value["context"] = context; value["quote"] = quote; finish(value); return
                }
                self.copySelection(pid: pid) { copied, error in
                    context["captureMethod"] = "copy"; value["context"] = context; value["quote"] = copied ?? ""; value["message"] = error
                    finish(value)
                }
            }
        }
    }
    private func copySelection(pid: pid_t, completion: @escaping (String?, String?) -> Void) {
        let board = NSPasteboard.general
        guard CGPreflightPostEventAccess(), let snapshot = ClipboardSnapshot(board) else {
            completion(nil, "The clipboard could not be preserved. Try selecting the passage again."); return
        }
        let initial = snapshot.version
        guard board.changeCount == initial, !interrupted else { completion(nil, "Capture was interrupted. Try Shift twice again."); return }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 8, keyDown: true), let up = CGEvent(keyboardEventSource: nil, virtualKey: 8, keyDown: false) else {
            completion(nil, "Selection capture could not start. Try again."); return
        }
        down.flags = .maskCommand; up.flags = .maskCommand
        down.setIntegerValueField(.eventSourceUserData, value: Self.copyEventTag); up.setIntegerValueField(.eventSourceUserData, value: Self.copyEventTag)
        down.postToPid(pid); up.postToPid(pid)
        let deadline = ProcessInfo.processInfo.systemUptime + 0.9
        func poll() {
            guard !self.interrupted, NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
                completion(nil, "Capture was interrupted. Select the passage and press Shift twice again."); return
            }
            let current = board.changeCount
            if current != initial {
                let text = board.string(forType: .string)
                let restored = snapshot.restore(board, ifUnchanged: current)
                guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf16.count <= 100000 else {
                    completion(nil, "Select a text passage under 100,000 characters and press Shift twice."); return
                }
                completion(text, restored ? nil : "Captured. The previous clipboard could not be restored.")
            } else if ProcessInfo.processInfo.systemUptime >= deadline {
                completion(nil, "This app did not provide selected text. Keep the passage selected and try Shift twice again.")
            } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.025, execute: poll) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.025, execute: poll)
    }
}
