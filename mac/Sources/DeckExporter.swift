import AppKit
import WebKit
import PDFKit

/// A private renderer for export and agent screenshots. It never changes the editor.
final class DeckExporter: NSObject, WKNavigationDelegate {
    let id = UUID().uuidString
    private var host: NSWindow?
    private var view: DekWebView?
    private weak var shell: WKWebView?
    private var manifest: [String: Any] = [:]
    private var indices: [Int] = []
    private var slides: [[String: Any]] = []
    private let pdf = PDFDocument()
    private var position = 0
    private var options: [String: Any] = [:]
    private var output: URL!
    private var complete = false
    private var renderDirectory: URL?
    private var finish: (([String: Any]) -> Void)?
    var status: [String: Any] = ["status": "preparing", "completed": 0, "total": 0, "warnings": [String]()]
    var onProgress: (([String: Any]) -> Void)?

    func start(shell: WKWebView, options: [String: Any], output: URL, done: @escaping ([String: Any]) -> Void) {
        self.shell = shell; self.options = options; self.output = output; self.finish = done
        shell.callAsyncJavaScript("return window.dekShell.prepareExport(options);", arguments: ["options": options], in: nil, in: .page) { [weak self] result in
            guard let self, !self.complete else { return }
            switch result {
            case .failure(let error): self.fail(error.localizedDescription)
            case .success(let value):
                guard let m = value as? [String: Any], let html = m["html"] as? String,
                      let size = m["size"] as? [String: Any], let w = size["w"] as? Double, let h = size["h"] as? Double,
                      let ids = m["indices"] as? [Int], w > 0, h > 0, w <= 10000, h <= 10000 else { self.fail("The export document is invalid"); return }
                self.manifest = m
                if let requested = options["slideIndex"] as? Int { self.indices = [requested] } else { self.indices = ids }
                self.status["total"] = self.indices.count
                let config = WKWebViewConfiguration()
                config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
                config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
                let frame = NSRect(x: 0, y: 0, width: w, height: h)
                let web = DekWebView(frame: frame, configuration: config)
                web.navigationDelegate = self
                let host = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: w, height: h), styleMask: [.borderless], backing: .buffered, defer: false)
                host.contentView = web; host.isReleasedWhenClosed = false; host.orderBack(nil)
                self.host = host; self.view = web; web.keepRenderingWhenOccluded()
                do {
                    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("dek-export-" + self.id, isDirectory: true)
                    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    let file = dir.appendingPathComponent("render.html")
                    try html.write(to: file, atomically: true, encoding: .utf8)
                    self.renderDirectory = dir
                    web.loadFileURL(file, allowingReadAccessTo: URL(fileURLWithPath: "/"))
                } catch { self.fail("Could not prepare export: \(error.localizedDescription)") }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in
            guard let self, !self.complete else { return }; self.fail("Export timed out. Check fonts, images, and embedded content.")
        }
    }
    func cancel() { end(["status": "cancelled", "completed": position, "total": indices.count]) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if !complete { next() } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    private func next() {
        guard !complete, let view else { return }
        if position >= indices.count { save(); return }
        status["status"] = "rendering"
        onProgress?(status)
        guard let inspector = manifest["inspector"] as? String else { fail("Export inspector is missing"); return }
        view.callAsyncJavaScript("return await (\(inspector))(index, step);", arguments: ["index": indices[position], "step": options["step"] ?? "last"], in: nil, in: .page) { [weak self] result in
            guard let self, !self.complete else { return }
            switch result {
            case .failure(let error): self.fail("Slide \(self.indices[self.position] + 1): \((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)")
            case .success(let value):
                guard var slide = value as? [String: Any], let rect = self.rect(slide["rect"]) else { self.fail("Slide did not return render bounds"); return }
                let notes = self.manifest["notes"] as? [String] ?? []
                slide["notes"] = self.position < notes.count ? notes[self.position] : ""
                var warnings = self.status["warnings"] as? [String] ?? []
                if self.options["format"] as? String == "pptx" && self.options["mode"] as? String != "image" { warnings += (slide["warnings"] as? [String] ?? []).map { "Slide \(self.indices[self.position] + 1): \($0)" } }
                self.status["warnings"] = warnings
                let format = self.options["format"] as? String ?? "pdf"
                if format == "pdf" {
                    let cfg = WKPDFConfiguration(); cfg.rect = rect
                    view.createPDF(configuration: cfg) { [weak self] res in
                        guard let self, !self.complete else { return }
                        guard case .success(let data) = res, let page = PDFDocument(data: data)?.page(at: 0) else { self.fail("Could not render PDF page \(self.position + 1)"); return }
                        self.pdf.insert(page, at: self.pdf.pageCount); self.advance()
                    }
                } else if format == "png" || format == "overview" || self.options["mode"] as? String == "image" {
                    self.capture(rect) { data in
                        guard !self.complete else { return }
                        guard let data else { self.fail("Could not capture slide \(self.position + 1)"); return }
                        if format == "png" { self.write(data); return }
                        slide["image"] = data.base64EncodedString(); self.slides.append(slide); self.advance()
                    }
                } else {
                    self.captureNodes(slide, at: 0)
                }
            }
        }
    }
    private func captureNodes(_ slide: [String: Any], at: Int) {
        guard !complete else { return }
        var slide = slide
        var nodes = slide["nodes"] as? [[String: Any]] ?? []
        if at >= nodes.count { slides.append(slide); advance(); return }
        guard nodes[at]["type"] as? String == "image", let rect = rect(nodes[at]["capture"]) else { captureNodes(slide, at: at + 1); return }
        capture(rect) { [weak self] data in
            guard let self, !self.complete else { return }
            guard let data else { self.fail("Could not capture an image on slide \(self.position + 1)"); return }
            nodes[at]["image"] = data.base64EncodedString(); nodes[at].removeValue(forKey: "capture")
            slide["nodes"] = nodes; self.captureNodes(slide, at: at + 1)
        }
    }
    private func rect(_ obj: Any?) -> CGRect? {
        guard let r = obj as? [String: Any], let x = r["x"] as? Double, let y = r["y"] as? Double,
              let w = r["w"] as? Double, let h = r["h"] as? Double, w > 0, h > 0 else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }
    private func capture(_ rect: CGRect, done: @escaping (Data?) -> Void) {
        guard let view else { done(nil); return }
        let cfg = WKSnapshotConfiguration(); cfg.rect = rect; cfg.snapshotWidth = NSNumber(value: min(rect.width, 1920) / 2); cfg.afterScreenUpdates = true
        view.takeSnapshot(with: cfg) { image, _ in
            guard let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { done(nil); return }
            done(rep.representation(using: .png, properties: [:]))
        }
    }
    private func advance() { position += 1; status["completed"] = position; next() }
    private func save() {
        guard !complete else { return }; status["status"] = "writing"
        onProgress?(status)
        if options["format"] as? String == "overview" { saveOverview();return }
        if options["format"] as? String == "pdf" {
            guard pdf.pageCount == indices.count, let data = pdf.dataRepresentation() else { fail("PDF is incomplete; no file was saved"); return }
            write(data); return
        }
        guard let shell else { fail("The editor closed before export finished"); return }
        let payload: [String: Any] = ["title": manifest["title"] ?? "Deck", "size": manifest["size"] ?? [:], "slides": slides, "mode": options["mode"] ?? "editable"]
        shell.callAsyncJavaScript("return await window.dekShell.writePowerPoint(payload);", arguments: ["payload": payload], in: nil, in: .page) { [weak self] result in
            guard let self, !self.complete else { return }
            guard case .success(let value) = result, let base64 = value as? String, let data = Data(base64Encoded: base64) else { self.fail("PowerPoint could not be assembled"); return }
            self.write(data)
        }
    }
    private func saveOverview() {
        let width = 1280, gap = 24.0, tileWidth = 394.0
        let size = manifest["size"] as? [String: Double] ?? ["w": 1920, "h": 1080]
        let tileHeight = tileWidth * (size["h"] ?? 1080) / (size["w"] ?? 1920)
        let height = Int(ceil(Double((slides.count + 2) / 3) * (tileHeight + 42) + gap))
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let context = NSGraphicsContext(bitmapImageRep: rep) else { fail("Could not allocate overview image");return }
        NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current = context
        NSColor(calibratedWhite: 0.08, alpha: 1).setFill();NSRect(x: 0, y: 0, width: width, height: height).fill()
        for (i, slide) in slides.enumerated() {
            guard let raw = slide["image"] as? String, let data = Data(base64Encoded: raw), let image = NSImage(data: data) else { NSGraphicsContext.restoreGraphicsState();fail("Overview image is incomplete");return }
            let x = gap + Double(i % 3) * (tileWidth + gap), y = Double(height) - gap - Double(i / 3) * (tileHeight + 42) - tileHeight
            image.draw(in: NSRect(x: x, y: y, width: tileWidth, height: tileHeight))
            let titles = manifest["titles"] as? [String] ?? []
            let label = "\(indices[i] + 1) · " + (i < titles.count ? titles[i] : "Slide")
            (label as NSString).draw(in: NSRect(x: x, y: y - 24, width: tileWidth, height: 18), withAttributes: [.font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.white])
        }
        NSGraphicsContext.restoreGraphicsState()
        guard let data = rep.representation(using: .png, properties: [:]) else { fail("Could not encode overview");return };write(data)
    }
    private func write(_ data: Data) {
        guard !complete else { return }
        do {
            try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: output, options: .atomic)
            end(["status": "completed", "path": output.path, "completed": indices.count, "total": indices.count, "warnings": status["warnings"] ?? []])
        } catch { fail("Could not save export: \(error.localizedDescription)") }
    }
    private func fail(_ message: String) { end(["status": "failed", "error": message, "completed": position, "total": indices.count]) }
    private func end(_ result: [String: Any]) {
        guard !complete else { return }; complete = true; status = result
        view?.stopLoading(); host?.close(); host = nil; view = nil
        slides.removeAll(); manifest.removeAll()
        if let dir = renderDirectory { try? FileManager.default.removeItem(at: dir) }; renderDirectory = nil
        let done = finish; finish = nil; onProgress = nil; done?(result)
    }
}
