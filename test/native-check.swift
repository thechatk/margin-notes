import AppKit
import WebKit

var gesture = ShiftGesture()
assert(!gesture.step(time: 1, shiftDown: true))
assert(!gesture.step(time: 1.1, shiftDown: false))
assert(!gesture.step(time: 1.2, shiftDown: true))
assert(gesture.step(time: 1.3, shiftDown: false))
assert(!gesture.step(time: 2, shiftDown: true))
assert(!gesture.step(time: 2.5, shiftDown: false))
assert(!gesture.step(time: 2.6, shiftDown: true))
assert(!gesture.step(time: 2.7, shiftDown: false))
_ = gesture.step(time: 3, interrupted: true)
_ = gesture.step(time: 3.1, shiftDown: true)
_ = gesture.step(time: 3.15, interrupted: true) // Shift + letter must not trigger capture.
_ = gesture.step(time: 3.2, shiftDown: false)
_ = gesture.step(time: 3.3, shiftDown: true)
assert(!gesture.step(time: 3.4, shiftDown: false))

let board = NSPasteboard.withUniqueName()
defer { board.releaseGlobally() }
let item = NSPasteboardItem()
item.setString("Original clipboard 🧭", forType: .string)
let custom = NSPasteboard.PasteboardType("org.marginnotes.test")
item.setData(Data([0, 1, 127, 255]), forType: custom)
assert(board.writeObjects([item]))
let original = ClipboardSnapshot(board)!
board.clearContents(); board.setString("Selected passage", forType: .string)
assert(original.restore(board, ifUnchanged: board.changeCount))
assert(board.string(forType: .string) == "Original clipboard 🧭")
assert(board.data(forType: custom) == Data([0, 1, 127, 255]))
let version = board.changeCount
board.clearContents(); board.setString("A newer clipboard", forType: .string)
assert(!original.restore(board, ifUnchanged: version))
assert(board.string(forType: .string) == "A newer clipboard")
print("Double-Shift and clipboard preservation checks passed.")

let attachmentDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: attachmentDirectory) }
let feedback = "<response-annotations>\n[{\"text\":\"Повтор 🧭\",\"annotation\":\"Explain it.\"}]\n</response-annotations>"
let attachment = try copyAnnotationAttachment(feedback, directory: attachmentDirectory, board: board)
let savedFeedback = try String(contentsOf: attachment, encoding: .utf8)
assert(savedFeedback == feedback)
assert(board.pasteboardItems?.count == 1 && board.types?.contains(.fileURL) == true)
assert(board.string(forType: .string) == nil)
assert((board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) == [attachment])
let repeatedAttachment = try copyAnnotationAttachment(feedback, directory: attachmentDirectory, board: board)
assert(repeatedAttachment == attachment)
let editedAttachment = try copyAnnotationAttachment(feedback + "\nEdited", directory: attachmentDirectory, board: board)
assert(editedAttachment != attachment)
let retainedFeedback = try String(contentsOf: attachment, encoding: .utf8)
assert(retainedFeedback == feedback)
let attachmentClipboardVersion = board.changeCount
for invalid in ["", String(repeating: "x", count: 8 * 1024 * 1024 + 1)] {
    do { try copyAnnotationAttachment(invalid, directory: attachmentDirectory, board: board); assertionFailure("Invalid attachments must fail.") } catch {}
    assert(board.changeCount == attachmentClipboardVersion)
}
do { try copyAnnotationAttachment(feedback, directory: attachment, board: board); assertionFailure("A file cannot contain the attachment directory.") } catch {}
assert(board.changeCount == attachmentClipboardVersion)
print("Annotation file pasteboard, exact Unicode, snapshot retention, reuse, and failure checks passed.")

_ = NSApplication.shared
let panel = AnnotationPanel(contentRect: NSRect(x: 0, y: 0, width: 328, height: 404), styleMask: .borderless, backing: .buffered, defer: false)
let web = WKWebView()
panel.installContent(web)
assert(!panel.isOpaque && panel.backgroundColor.alphaComponent == 0 && !panel.hasShadow)
assert(web.value(forKey: "drawsBackground") as? Bool == false)
let root = panel.contentView!
guard let frost = root as? NSVisualEffectView else { print("The panel material still follows window focus."); exit(1) }
assert(frost.maskImage != nil && frost.blendingMode == .behindWindow && frost.material == .hudWindow)
for focused in [true, false, true, false] {
    if focused { panel.becomeKey() } else { panel.resignKey() }
    root.layoutSubtreeIfNeeded()
    assert(frost.state == .active && !frost.isEmphasized)
    assert(frost.appearance?.name == .aqua)
}
for height in [404.0, 580.0] {
    panel.setContentSize(NSSize(width: 328, height: height))
    root.layoutSubtreeIfNeeded()
    assert(web.bounds.size == NSSize(width: 328, height: height))
    assert(root.hitTest(NSPoint(x: 100, y: height - 22)) is PanelDragRegion)
    assert(!(root.hitTest(NSPoint(x: 276, y: height - 22)) is PanelDragRegion))
    assert(!(root.hitTest(NSPoint(x: 302, y: height - 22)) is PanelDragRegion))
    assert(!(root.hitTest(NSPoint(x: 100, y: 100)) is PanelDragRegion))
}
final class DragCheckWindow: NSWindow {
    var received: NSEvent?
    override func performDrag(with event: NSEvent) { received = event }
}
let dragWindow = DragCheckWindow(contentRect: NSRect(x: 0, y: 0, width: 100, height: 30), styleMask: .borderless, backing: .buffered, defer: false)
let drag = PanelDragRegion(frame: dragWindow.contentLayoutRect)
dragWindow.contentView = drag
let event = NSEvent.mouseEvent(with: .leftMouseDown, location: NSPoint(x: 10, y: 10), modifierFlags: [], timestamp: 1, windowNumber: dragWindow.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
assert(drag.acceptsFirstMouse(for: event))
drag.mouseDown(with: event)
assert(dragWindow.received === event)
print("Focus-independent frost, resized hit areas, and original-event drag checks passed.")
