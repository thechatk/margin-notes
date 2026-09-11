import AppKit
import Foundation

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager().createDirectory(at: root, withIntermediateDirectories: true)
guard let artwork = NSImage(contentsOfFile: "desktop/AppIcon.png") else {
    fatalError("The approved app icon is missing or unreadable.")
}
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high
    artwork.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    let data = bitmap.representation(using: .png, properties: [:])!
    let names: [String] = size == 16 ? ["icon_16x16.png"] : size == 32 ? ["icon_16x16@2x.png", "icon_32x32.png"] : size == 64 ? ["icon_32x32@2x.png"] : size == 128 ? ["icon_128x128.png"] : size == 256 ? ["icon_128x128@2x.png", "icon_256x256.png"] : size == 512 ? ["icon_256x256@2x.png", "icon_512x512.png"] : ["icon_512x512@2x.png"]
    for name in names { try data.write(to: root.appendingPathComponent(name)) }
}
