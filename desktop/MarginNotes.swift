import AppKit
import WebKit
import ApplicationServices
import UniformTypeIdentifiers

final class Worker {
    let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["MARGIN_NOTES_DATA"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Margin Notes").path)
    let process = Process(), input = Pipe(), output = Pipe()
    let io = DispatchQueue(label: "margin.worker.io"), writes = DispatchQueue(label: "margin.worker.writes")
    var buffer = Data(), nextID = 0
    var pending: [Int: (Any?, String?) -> Void] = [:]
    func start(resources: URL) throws {
        process.executableURL = resources.appendingPathComponent("node")
        process.arguments = [resources.appendingPathComponent("desktop-worker.mjs").path]
        process.environment = ["MARGIN_NOTES_DATA": directory.path, "PATH": "/usr/bin:/bin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path]
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { handle.readabilityHandler = nil; return }
            self?.io.async { [weak self] in
                guard let self else { return }
                self.buffer.append(data)
                while let newline = self.buffer.firstIndex(of: 10) {
                    let line = self.buffer.prefix(upTo: newline)
                    self.buffer.removeSubrange(...newline)
                    guard let result = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let id = result["id"] as? Int else { continue }
                    DispatchQueue.main.async { self.pending.removeValue(forKey: id)?(result["value"], result["error"] as? String) }
                }
            }
        }
        process.terminationHandler = { [weak self] _ in DispatchQueue.main.async {
            guard let self else { return }
            let callbacks = self.pending.values; self.pending.removeAll()
            callbacks.forEach { $0(nil, "The note storage process stopped. Export visible notes, then reopen Margin Notes.") }
        } }
        try process.run()
    }
    func call(_ name: String, _ args: [String: Any] = [:], reply: @escaping (Any?, String?) -> Void) {
        guard process.isRunning else { reply(nil, "Note storage is unavailable. Reopen Margin Notes."); return }
        nextID += 1; let id = nextID
        guard var data = try? JSONSerialization.data(withJSONObject: ["id": id, "name": name, "arguments": args]) else { reply(nil, "Invalid request."); return }
        data.append(10); pending[id] = reply
        writes.async { [weak self] in
            do { try self?.input.fileHandleForWriting.write(contentsOf: data) }
            catch { DispatchQueue.main.async { self?.pending.removeValue(forKey: id)?(nil, "Saving failed. Export visible notes before reopening.") } }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    let worker = Worker()
    var captureWindow: AnnotationPanel!, capture: WKWebView!
    var statusItem: NSStatusItem!
    let selectionCapture = SelectionCapture()
    var gesture = ShiftGesture(), globalMonitor: Any?, localMonitor: Any?
    var captureReady = false, delivering = false
    var pendingCaptures: [[String: Any]] = []
    var previousApp: NSRunningApplication?
    var activationObserver: NSObjectProtocol?
    let resources = Bundle.main.resourceURL!

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { try worker.start(resources: resources) }
        catch { alert("Margin Notes could not start", "The included runtime could not be opened. Rebuild or reinstall the complete app."); NSApp.terminate(nil); return }
        buildMenus()
        captureWindow = AnnotationPanel(contentRect: NSRect(x: 0, y: 0, width: 328, height: 404), styleMask: [.borderless], backing: .buffered, defer: false)
        captureWindow.appearance = NSAppearance(named: .aqua)
        captureWindow.title = "Annotations"; captureWindow.level = .floating; captureWindow.hidesOnDeactivate = false
        captureWindow.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        captureWindow.setFrameAutosaveName("AnnotationPanel"); captureWindow.setContentSize(NSSize(width: 328, height: 404)); captureWindow.center(); captureWindow.delegate = self; captureWindow.isReleasedWhenClosed = false
        capture = makeWebView()
        captureWindow.installContent(capture)
        previousApp = NSWorkspace.shared.frontmostApplication
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, app.processIdentifier != ProcessInfo.processInfo.processIdentifier { self?.previousApp = app }
        }
        installHotKey()
        showCapture()
    }
    func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "margin")
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.loadFileURL(resources.appendingPathComponent("capture.html"), allowingReadAccessTo: resources)
        return web
    }
    func buildMenus() {
        let main = NSMenu(), app = NSMenu(), file = NSMenu(), edit = NSMenu(), window = NSMenu()
        for (title, menu) in [("Margin Notes", app), ("File", file), ("Edit", edit), ("Window", window)] { let item = NSMenuItem(title: title, action: nil, keyEquivalent: ""); item.submenu = menu; main.addItem(item) }
        app.addItem(withTitle: "About Margin Notes", action: #selector(about), keyEquivalent: "")
        app.addItem(.separator()); app.addItem(withTitle: "Accessibility settings…", action: #selector(accessibility), keyEquivalent: "")
        app.addItem(.separator()); app.addItem(withTitle: "Hide Margin Notes", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Quit Margin Notes", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        file.addItem(withTitle: "Annotations", action: #selector(showCapture), keyEquivalent: "")
        file.addItem(withTitle: "Close window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        for (title, action, key) in [("Undo", Selector(("undo:")), "z"), ("Cut", #selector(NSText.cut(_:)), "x"), ("Copy", #selector(NSText.copy(_:)), "c"), ("Paste", #selector(NSText.paste(_:)), "v"), ("Select All", #selector(NSText.selectAll(_:)), "a")] { edit.addItem(withTitle: title, action: action, keyEquivalent: key) }
        window.addItem(withTitle: "Annotations", action: #selector(showCapture), keyEquivalent: "2")
        NSApp.mainMenu = main; NSApp.windowsMenu = window
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "text.bubble", accessibilityDescription: "Margin Notes")
        let menu = NSMenu()
        menu.addItem(withTitle: "Capture selection  ⇧ ⇧", action: #selector(captureSelection), keyEquivalent: "")
        menu.addItem(withTitle: "Annotations", action: #selector(showCapture), keyEquivalent: "")
        menu.addItem(.separator()); menu.addItem(withTitle: "Quit Margin Notes", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        statusItem.menu = menu
        for menu in [app, file, window, statusItem.menu!] { for item in menu.items { if let action = item.action, [#selector(about), #selector(accessibility), #selector(showCapture), #selector(captureSelection)].contains(action) { item.target = self } } }
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Margin Notes", .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", .credits: NSAttributedString(string: "Select text, press Shift twice, and add a comment.\nMIT licensed. Dependency licenses are included in the app bundle.")]) }
    @objc func showCapture() {
        captureWindow?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        capture?.evaluateJavaScript("window.CaptureNotes?.focus()", completionHandler: nil)
        deliverCapture()
    }
    func dismissCapture() { captureWindow.orderOut(nil); previousApp?.activate() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showCapture(); return true }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        flushCapture { [weak self] success in
            if success { self?.dismissCapture(); self?.resumeCapture() }
            else { self?.alert("Finish saving first", "Save or cancel the open annotation, or export your notes if saving failed.") }
        }
        return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard captureReady else { return .terminateNow }
        flushCapture { [weak self] success in
            if !success { self?.resumeCapture(); self?.alert("Notes need attention", "Finish the open annotation or export notes whose save failed before quitting.") }
            sender.reply(toApplicationShouldTerminate: success)
        }
        return .terminateLater
    }
    func flushCapture(_ completion: @escaping (Bool) -> Void) {
        capture.callAsyncJavaScript("return await window.CaptureNotes.flush(true);", arguments: [:], in: nil, in: .page) { result in
            if case .success = result { completion(true) } else { completion(false) }
        }
    }
    func resumeCapture() { capture.callAsyncJavaScript("window.CaptureNotes?.resume();", arguments: [:], in: nil, in: .page, completionHandler: nil) }
    func applicationWillTerminate(_ notification: Notification) {
        if worker.process.isRunning { worker.process.terminate() }
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }; if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        if let activationObserver { NSWorkspace.shared.notificationCenter.removeObserver(activationObserver) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler reply: @escaping (Any?, String?) -> Void) {
        guard message.webView === capture, message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == resources.appendingPathComponent("capture.html").standardizedFileURL,
              let body = message.body as? [String: Any], let name = body["name"] as? String, let args = body["arguments"] as? [String: Any] else { reply(nil, "Invalid native request."); return }
        switch name {
        case "ready":
            captureReady = true; deliverCapture()
            reply(true, nil)
        case "tool":
            guard let tool = args["name"] as? String, let input = args["arguments"] as? [String: Any] else { reply(nil, "Invalid storage request."); return }
            let allowed = ["read_captures", "save_captures", "archive_captures"]
            guard allowed.contains(tool) else { reply(nil, "Operation is unavailable in this window."); return }
            worker.call(tool, input, reply: reply)
        case "copyAttachment":
            guard let text = args["text"] as? String else { reply(nil, "Invalid annotation attachment."); return }
            do { try copyAnnotationAttachment(text, directory: worker.directory); reply(true, nil) }
            catch { reply(nil, "The attachment could not be prepared. Your notes remain saved. " + error.localizedDescription) }
        case "resize":
            guard let requested = args["height"] as? Double, requested.isFinite else { reply(nil, "Invalid panel size."); return }
            let maximum = min(600, captureWindow.screen?.visibleFrame.height ?? 600)
            let height = min(maximum, max(404, requested))
            if abs(captureWindow.frame.height - height) > 1 {
                var frame = captureWindow.frame; frame.origin.y += frame.height - height; frame.size.height = height
                captureWindow.setFrame(frame, display: true); captureWindow.invalidateShadow()
            }
            reply(true, nil)
        case "dismiss":
            dismissCapture(); reply(true, nil)
        case "returnToSource":
            previousApp?.activate(); reply(true, nil)
        case "export":
            guard let text = args["text"] as? String, text.utf8.count <= 8 * 1024 * 1024, let filename = args["filename"] as? String else { reply(nil, "Invalid export."); return }
            let panel = NSSavePanel(); panel.nameFieldStringValue = URL(fileURLWithPath: filename).lastPathComponent; panel.allowedContentTypes = [.json]
            panel.beginSheetModal(for: message.webView!.window!) { response in
                guard response == .OK, let url = panel.url else { reply(["isError": true], nil); return }
                do { try text.write(to: url, atomically: true, encoding: .utf8); reply([:], nil) }
                catch { reply(nil, "The export could not be saved. Choose another location.") }
            }
        case "accessibility": accessibility(); reply(true, nil)
        case "link":
            guard let value = args["url"] as? String, let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { reply(nil, "Unsupported link."); return }
            NSWorkspace.shared.open(url); reply(true, nil)
        default: reply(nil, "Unknown native operation.")
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let expected = resources.appendingPathComponent("capture.html")
        decisionHandler(url?.standardizedFileURL == expected.standardizedFileURL && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel)
    }
    @objc func accessibility() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }
    func installHotKey() {
        let mask: NSEvent.EventTypeMask = [.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown]
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in self?.handleGesture(event) }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in self?.handleGesture(event); return event }
    }
    func handleGesture(_ event: NSEvent) {
        selectionCapture.observe(event)
        if event.cgEvent?.getIntegerValueField(.eventSourceUserData) == SelectionCapture.copyEventTag { return }
        let shiftEvent = event.type == .flagsChanged && [56, 60].contains(Int(event.keyCode))
        let otherModifier = !event.modifierFlags.intersection([.command, .option, .control]).isEmpty
        let interrupted = otherModifier || event.type == .keyDown || event.type == .leftMouseDown || event.type == .rightMouseDown || (event.type == .flagsChanged && !shiftEvent)
        if gesture.step(time: event.timestamp, shiftDown: shiftEvent ? event.modifierFlags.contains(.shift) : nil, interrupted: interrupted) { captureSelection() }
    }
    @objc func captureSelection() {
        guard let front = NSWorkspace.shared.frontmostApplication else { showCapture(); return }
        if front.processIdentifier == ProcessInfo.processInfo.processIdentifier { showCapture(); return }
        previousApp = front
        selectionCapture.capture(from: front) { [weak self] value in
            self?.pendingCaptures.append(value); self?.showCapture()
        }
    }
    func deliverCapture() {
        guard captureReady, !delivering, let value = pendingCaptures.first else { return }
        delivering = true
        capture.callAsyncJavaScript("return await window.CaptureNotes.receive(value);", arguments: ["value": value], in: nil, in: .page) { [weak self] result in
            guard let self else { return }; self.delivering = false
            if case .success(let accepted) = result, accepted as? Bool == true {
                self.pendingCaptures.removeFirst(); self.deliverCapture()
            }
        }
    }
    func alert(_ title: String, _ message: String) { let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.addButton(withTitle: "OK"); alert.runModal() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
