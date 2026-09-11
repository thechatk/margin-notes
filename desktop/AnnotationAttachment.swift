import AppKit
import CryptoKit

enum AnnotationAttachmentError: LocalizedError {
    case invalid, clipboard
    var errorDescription: String? {
        switch self {
        case .invalid: return "The annotation attachment is empty or too large."
        case .clipboard: return "The attachment could not be copied. Your notes remain saved."
        }
    }
}

@discardableResult
func copyAnnotationAttachment(_ text: String, directory: URL, board: NSPasteboard = .general) throws -> URL {
    let data = Data(text.utf8)
    guard !data.isEmpty, data.count <= 8 * 1024 * 1024 else { throw AnnotationAttachmentError.invalid }
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let folder = directory.appendingPathComponent("Attachments").appendingPathComponent(digest)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let file = folder.appendingPathComponent("Annotations.md")
    if !FileManager.default.fileExists(atPath: file.path) { try data.write(to: file, options: .atomic) }
    guard try Data(contentsOf: file) == data else { throw CocoaError(.fileReadCorruptFile) }
    let item = NSPasteboardItem()
    guard item.setString(file.absoluteString, forType: .fileURL), let previous = ClipboardSnapshot(board) else { throw AnnotationAttachmentError.clipboard }
    guard board.changeCount == previous.version else { throw AnnotationAttachmentError.clipboard }
    let cleared = board.clearContents()
    guard board.writeObjects([item]) else {
        previous.restore(board, ifUnchanged: cleared)
        throw AnnotationAttachmentError.clipboard
    }
    return file
}
