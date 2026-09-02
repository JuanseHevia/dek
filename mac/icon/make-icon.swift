// Renders Dek's app icon: a near-black theatre with one lit slide.
// swiftc -O make-icon.swift -o make-icon && ./make-icon out.iconset
import AppKit

func draw(size: CGFloat) -> NSImage {
    let img = NSImage(size: NSSize(width: size, height: size))
    img.lockFocus()
    guard let ctx = NSGraphicsContext.current?.cgContext else { return img }
    let s = size
    // macOS icon grid: the squircle sits inside a 100×100 grid at 10..90
    let plate = CGRect(x: s * 0.098, y: s * 0.098, width: s * 0.804, height: s * 0.804)
    let radius = plate.width * 0.225
    let path = CGPath(roundedRect: plate, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.01), blur: s * 0.03, color: NSColor.black.withAlphaComponent(0.35).cgColor)
    ctx.addPath(path)
    ctx.setFillColor(CGColor(srgbRed: 0.075, green: 0.077, blue: 0.087, alpha: 1))
    ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState()
    ctx.addPath(path)
    ctx.clip()
    // spotlight wash from the top
    let colors = [CGColor(srgbRed: 0.93, green: 0.78, blue: 0.42, alpha: 0.28), CGColor(srgbRed: 0.93, green: 0.78, blue: 0.42, alpha: 0.0)] as CFArray
    if let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 1]) {
        ctx.drawRadialGradient(grad, startCenter: CGPoint(x: s * 0.5, y: s * 0.92), startRadius: 0, endCenter: CGPoint(x: s * 0.5, y: s * 0.92), endRadius: s * 0.62, options: [])
    }
    // the slide: a cream 16:9 card, lit
    let cardW = plate.width * 0.62
    let cardH = cardW * 9 / 16
    let card = CGRect(x: plate.midX - cardW / 2, y: plate.midY - cardH / 2 - s * 0.01, width: cardW, height: cardH)
    ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.02), blur: s * 0.05, color: NSColor.black.withAlphaComponent(0.55).cgColor)
    ctx.addPath(CGPath(roundedRect: card, cornerWidth: s * 0.012, cornerHeight: s * 0.012, transform: nil))
    ctx.setFillColor(CGColor(srgbRed: 0.975, green: 0.965, blue: 0.94, alpha: 1))
    ctx.fillPath()
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
    // a title line and a body line on the slide, in ink
    let ink = CGColor(srgbRed: 0.16, green: 0.14, blue: 0.13, alpha: 1)
    ctx.setFillColor(ink)
    let m = card.width * 0.11
    ctx.fill(CGRect(x: card.minX + m, y: card.maxY - m - card.height * 0.19, width: card.width * 0.46, height: card.height * 0.19))
    ctx.setFillColor(CGColor(srgbRed: 0.16, green: 0.14, blue: 0.13, alpha: 0.45))
    ctx.fill(CGRect(x: card.minX + m, y: card.maxY - m - card.height * 0.19 - card.height * 0.16, width: card.width * 0.66, height: card.height * 0.07))
    // the spot: a gold dot, bottom right of the slide
    ctx.setFillColor(CGColor(srgbRed: 0.93, green: 0.72, blue: 0.30, alpha: 1))
    let d = card.height * 0.13
    ctx.fillEllipse(in: CGRect(x: card.maxX - m - d, y: card.minY + m * 0.9, width: d, height: d))
    ctx.restoreGState()
    img.unlockFocus()
    return img
}

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Dek.iconset"
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
for (name, px) in [("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64), ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512), ("icon_512x512", 512), ("icon_512x512@2x", 1024)] {
    let img = draw(size: CGFloat(px))
    guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { continue }
    // force pixel size (lockFocus renders at the screen's scale factor)
    let final = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: final)
    NSGraphicsContext.current?.imageInterpolation = .high
    rep.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
    NSGraphicsContext.restoreGraphicsState()
    if let png = final.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: out).appendingPathComponent("\(name).png"))
    }
}
print("wrote \(out)")
