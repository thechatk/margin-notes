import AppKit
import WebKit

final class PanelDragRegion: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}

final class AnnotationPanel: NSPanel {
    override var canBecomeKey: Bool { true }

    func installContent(_ web: WKWebView) {
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        web.underPageBackgroundColor = .clear
        // WebKit's transparency switch is SPI; underPageBackgroundColor only colors overscroll.
        if web.responds(to: NSSelectorFromString("_setDrawsBackground:")) { web.setValue(false, forKey: "drawsBackground") }

        let host = NSView(frame: contentLayoutRect)
        host.wantsLayer = true
        host.layer?.cornerRadius = 28
        host.layer?.masksToBounds = true
        host.autoresizingMask = [.width, .height]
        web.frame = host.bounds
        web.autoresizingMask = [.width, .height]
        host.addSubview(web)
        let drag = PanelDragRegion(frame: NSRect(x: 12, y: host.bounds.height - 42, width: host.bounds.width - 102, height: 30))
        drag.autoresizingMask = [.width, .minYMargin]
        host.addSubview(drag)

        // Keep the material constant when the window gains or loses keyboard focus.
        let frost = NSVisualEffectView(frame: host.bounds)
        frost.material = .hudWindow
        frost.blendingMode = .behindWindow
        frost.state = .active
        frost.isEmphasized = false
        frost.appearance = NSAppearance(named: .aqua)
        let mask = NSImage(size: NSSize(width: 57, height: 57), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: 28, yRadius: 28).fill()
            return true
        }
        mask.capInsets = NSEdgeInsets(top: 28, left: 28, bottom: 28, right: 28)
        mask.resizingMode = .stretch
        frost.maskImage = mask
        frost.addSubview(host)
        contentView = frost
    }
}
