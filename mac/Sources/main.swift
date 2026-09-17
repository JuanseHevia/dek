import AppKit
import WebKit
import PDFKit
import UniformTypeIdentifiers

// WebKit stops painting (and marks layer memory volatile) when a window is
// occluded. Agents snapshot the stage while Dek sits behind a terminal, so the
// view must keep rendering when covered. Private API, called through a protocol.
@objc private protocol DekWebViewPrivate {
    @objc(_setWindowOcclusionDetectionEnabled:) func _setWindowOcclusionDetectionEnabled(_ enabled: Bool)
}

// MARK: - WebView that accepts deck drops and keeps WebKit's own menu out of the way

final class DekWebView: WKWebView {
    var onFileDrop: ((URL) -> Void)?

    func keepRenderingWhenOccluded() {
        let sel = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if responds(to: sel) {
            unsafeBitCast(self, to: DekWebViewPrivate.self)._setWindowOcclusionDetectionEnabled(false)
        } else {
            NSLog("dek: occlusion detection API unavailable")
        }
        // hidden pages get 1 s timer throttling by default; agents drive the stage while it is covered
        let prefs = configuration.preferences
        if prefs.responds(to: NSSelectorFromString("_setHiddenPageDOMTimerThrottlingEnabled:")) {
            prefs.setValue(false, forKey: "hiddenPageDOMTimerThrottlingEnabled")
        } else {
            NSLog("dek: timer throttling API unavailable")
        }
    }

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        // The shell draws its own menus; keep only the inspector for debugging.
        for item in menu.items where !item.title.localizedCaseInsensitiveContains("inspect") {
            menu.removeItem(item)
        }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if fileURL(from: sender) != nil { return .copy }
        return super.draggingEntered(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if let url = fileURL(from: sender) {
            onFileDrop?(url)
            return true
        }
        return super.performDragOperation(sender)
    }

    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "avif"]

    private func fileURL(from info: NSDraggingInfo) -> URL? {
        guard let urls = info.draggingPasteboard.readObjects(forClasses: [NSURL.self]) as? [URL] else { return nil }
        return urls.first { ["html", "htm"].contains($0.pathExtension.lowercased()) || Self.imageExtensions.contains($0.pathExtension.lowercased()) }
    }
}

// MARK: - App delegate

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {

    var window: NSWindow!
    var webView: DekWebView!
    var presenterWindow: NSWindow?
    var presenterView: DekWebView?
    var currentURL: URL?
    var jsReady = false
    var presenterReady = false
    var pendingOpen: [URL] = []
    var watcher: DispatchSourceFileSystemObject?
    var watchedPath: String?
    var lastWrite: [String: Date] = [:]
    private var lastWrittenContent: [String:String] = [:]
    var lastDoc: [String: Any]?
    var lastState: [String: Any] = [:]
    let agentServer = AgentServer()
    var selftestPath: String?
    var exports: [String: DeckExporter] = [:]

    // MARK: lifecycle

    private var activity: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Agents talk to Dek while it sits behind other windows: no App Nap.
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep], reason: "Dek serves agents over MCP")
        applyAppearance(UserDefaults.standard.string(forKey: "appearance") ?? "dark")
        buildMenu()
        buildWindow()
        loadUI()
        agentServer.evalJS = { [weak self] script, done in
            self?.webView.evaluateJavaScript(script) { result, _ in done(result as? String) }
        }
        agentServer.rpcJS = { [weak self] json, done in
            guard let self else { done(nil); return }
            // callAsyncJavaScript awaits the promise the shell's rpc returns
            self.webView.callAsyncJavaScript("return await window.dekShell.rpc(req);", arguments: ["req": json], in: nil, in: .page) { result in
                switch result {
                case .success(let value): done(value as? String)
                case .failure(let error): NSLog("dek rpc: \(error)"); done(nil)
                }
            }
        }
        agentServer.prepareCopy = { [weak self] content, source in
            guard let self, let destination = self.currentURL else { throw NSError(domain: "Dek", code: 1, userInfo: [NSLocalizedDescriptionKey: "Open a destination deck first"]) }; return try self.copyAssets(in: content, from: URL(fileURLWithPath: source), to: destination)
        }
        agentServer.prepareImage = { [weak self] path in self?.imageAsset(URL(fileURLWithPath: path)) }
        agentServer.writeFile = { [weak self] path, content in self?.write(path, content) ?? false }
        agentServer.openFile = { [weak self] path in self?.openDocument(URL(fileURLWithPath: path)) }
        agentServer.snapshot = { [weak self] rect, out, done in self?.snapshot(rect: rect, to: out, done: done) }
        agentServer.snapshotWindow = { [weak self] which, out, done in
            guard let self else { done(false); return }
            let view: WKWebView? = which == "presenter" ? self.presenterView : self.webView
            guard let view, view.window != nil else { done(false); return }
            self.snapshot(view: view, rect: nil, to: out, done: done)
        }
        agentServer.nativeTool = { [weak self] tool, args, done in self?.nativeAgentTool(tool, args: args, done: done) }
        agentServer.start()
        if let out = selftestPath {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in self?.runSelftest(out) }
        }
    }

    private func runSelftest(_ out: String) {
        openSample()
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            guard let self else { return }
            self.webView.evaluateJavaScript("window.dekShell.state()") { result, err in
                NSLog("SELFTEST state=%@ err=%@", (result as? String) ?? "nil", err.map(String.init(describing:)) ?? "none")
            }
            self.snapshot(rect: nil, to: out) { ok in
                NSLog("SELFTEST snapshot=%@ %@", ok ? "ok" : "fail", out)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NSApp.terminate(nil) }
            }
        }
    }

    private var departureReady = false
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if departureReady || !jsReady || currentURL == nil { return .terminateNow }
        flushBeforeLeaving { ok in self.departureReady = ok; sender.reply(toApplicationShouldTerminate: ok) }
        return .terminateLater
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === window && !departureReady { NSApp.terminate(nil); return false }; return true
    }
    private func flushBeforeLeaving(_ done: @escaping (Bool) -> Void) {
        guard jsReady, currentURL != nil else { done(true); return }
        webView.callAsyncJavaScript("return await window.dekShell.flushForDeparture();", arguments: [:], in: nil, in: .page) { result in
            if case .success = result { done(true) }
            else { self.callJS(self.webView, "window.dekShell.toast('Your edits could not be saved. Save a copy or resolve the disk change before closing.')");done(false) }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if jsReady { openDocument(url) } else { pendingOpen.append(url) }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        agentServer.stop()
    }

    // MARK: window + webview

    private var readRoot: URL { URL(fileURLWithPath: "/", isDirectory: true) }
    private var indexURL: URL { Bundle.main.resourceURL!.appendingPathComponent("web/index.html") }

    private func makeConfig() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        if ProcessInfo.processInfo.environment["DEK_SUPPORT_DIR"] != nil { config.websiteDataStore = .nonPersistent() }
        config.userContentController.add(self, name: "dek")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.mediaTypesRequiringUserActionForPlayback = []
        return config
    }

    private var theatreColor: NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(red: 0.075, green: 0.077, blue: 0.087, alpha: 1)
                : NSColor(red: 0.882, green: 0.875, blue: 0.862, alpha: 1)
        }
    }

    private func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1180, height: 760)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.center()
        window.setFrameAutosaveName("DekMain")
        window.minSize = NSSize(width: 640, height: 420)
        window.delegate = self
        window.tabbingMode = .disallowed
        window.collectionBehavior.insert(.fullScreenPrimary)

        webView = DekWebView(frame: frame, configuration: makeConfig())
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        webView.keepRenderingWhenOccluded()
        webView.registerForDraggedTypes([.fileURL])
        webView.onFileDrop = { [weak self] url in
            guard let self else { return }
            if DekWebView.imageExtensions.contains(url.pathExtension.lowercased()) {
                self.callJS(self.webView, "window.dekShell.imageDropped(\(self.json(["path": url.path])))")
            } else {
                self.openDocument(url)
            }
        }

        window.contentView = webView
        window.backgroundColor = theatreColor
        window.makeKeyAndOrderFront(nil)
    }

    private func loadUI() {
        webView.loadFileURL(indexURL, allowingReadAccessTo: readRoot)
    }

    // MARK: presenter window

    private func openPresenter() {
        if presenterWindow == nil {
            let frame = NSRect(x: 0, y: 0, width: 1100, height: 700)
            let w = NSWindow(
                contentRect: frame,
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered, defer: false)
            w.title = "Presenter"
            w.titleVisibility = .hidden
            w.titlebarAppearsTransparent = true
            w.setFrameAutosaveName("DekPresenter")
            w.minSize = NSSize(width: 720, height: 460)
            w.isReleasedWhenClosed = false
            w.tabbingMode = .disallowed
            w.delegate = self
            let v = DekWebView(frame: frame, configuration: makeConfig())
            v.navigationDelegate = self
            v.autoresizingMask = [.width, .height]
            v.setValue(false, forKey: "drawsBackground")
            v.keepRenderingWhenOccluded()
            w.contentView = v
            w.backgroundColor = theatreColor
            presenterWindow = w
            presenterView = v
            v.loadFileURL(Bundle.main.resourceURL!.appendingPathComponent("web/presenter.html"), allowingReadAccessTo: readRoot)
            // land it on the other screen when there is one
            if let other = NSScreen.screens.first(where: { $0 != window.screen }) {
                let f = other.visibleFrame
                w.setFrame(NSRect(x: f.midX - frame.width / 2, y: f.midY - frame.height / 2, width: frame.width, height: frame.height), display: false)
            } else {
                w.center()
            }
        }
        presenterWindow?.makeKeyAndOrderFront(nil)
    }

    /// Fullscreen the deck on the second display and keep the presenter here.
    @objc func presentOnSecondDisplay(_ sender: Any?) {
        guard NSScreen.screens.count > 1 else {
            callJS(webView, "window.dekShell.command('present')")
            return
        }
        let main = NSScreen.main ?? NSScreen.screens[0]
        let other = NSScreen.screens.first { $0 != main } ?? main
        if window.screen != other {
            let f = other.visibleFrame
            window.setFrame(NSRect(x: f.midX - window.frame.width / 2, y: f.midY - window.frame.height / 2, width: window.frame.width, height: window.frame.height), display: true)
        }
        callJS(webView, "window.dekShell.command('present')")
        openPresenter()
    }

    // MARK: menu

    private func item(_ title: String, _ command: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: #selector(runCommand(_:)), keyEquivalent: key)
        it.keyEquivalentModifierMask = mods
        it.representedObject = command
        it.target = self
        return it
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Dek", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(item("Settings…", "settings", ","))
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Dek", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Dek", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "New Deck…", action: #selector(newDeck(_:)), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "Open…", action: #selector(openDialog(_:)), keyEquivalent: "o")
        let recentItem = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        let recentMenu = NSMenu(title: "Open Recent")
        recentMenu.perform(NSSelectorFromString("_setMenuName:"), with: "NSRecentDocumentsMenu")
        recentItem.submenu = recentMenu
        fileMenu.addItem(recentItem)
        fileMenu.addItem(withTitle: "Open the Welcome Deck", action: #selector(openSampleAction(_:)), keyEquivalent: "")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Reload From Disk", action: #selector(reloadDeck(_:)), keyEquivalent: "r")
        let dup = NSMenuItem(title: "Duplicate Deck…", action: #selector(saveAsDialog(_:)), keyEquivalent: "S")
        dup.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(dup)
        let pdf = NSMenuItem(title: "Export PDF…", action: #selector(exportPdf(_:)), keyEquivalent: "E")
        pdf.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(pdf)
        fileMenu.addItem(item("Export PowerPoint…", "export"))
        fileMenu.addItem(withTitle: "Reveal in Finder", action: #selector(revealInFinder(_:)), keyEquivalent: "")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(item("Undo", "undo", "z"))
        editMenu.addItem(item("Redo", "redo", "z", [.command, .shift]))
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: NSSelectorFromString("cut:"), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: NSSelectorFromString("copy:"), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: NSSelectorFromString("paste:"), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: NSSelectorFromString("selectAll:"), keyEquivalent: "a")
        editMenu.addItem(.separator())
        editMenu.addItem(item("New Slide After Current", "newSlide", "n", [.command, .shift]))
        editMenu.addItem(item("Duplicate Slide", "duplicate", "d"))
        editMenu.addItem(item("Delete Slide", "delete", "\u{8}"))
        editMenu.addItem(item("Move Slide Up", "moveUp", String(UnicodeScalar(NSUpArrowFunctionKey)!), [.command, .option]))
        editMenu.addItem(item("Move Slide Down", "moveDown", String(UnicodeScalar(NSDownArrowFunctionKey)!), [.command, .option]))
        editMenu.addItem(item("Copy Slide HTML", "copyHtml", "c", [.command, .option]))
        editMenu.addItem(item("Hide / Show Slide", "skip", "", []))
        editMenu.addItem(.separator())
        editMenu.addItem(item("Edit Slide Elements", "edit", "e"))
        editMenu.addItem(item("Insert Text", "insertText", "t", [.command, .option]))
        editMenu.addItem(item("Insert Heading", "insertHeading", "h", [.command, .option]))
        editMenu.addItem(item("Insert Image…", "insertImage", "i", [.command, .option]))
        editMenu.addItem(item("Delete Selected Element", "deleteElement", "", []))
        editItem.submenu = editMenu

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(item("Command Palette…", "palette", "p", [.command, .shift]))
        viewMenu.addItem(item("Go to Slide…", "goto", "p"))
        viewMenu.addItem(item("Light Table", "overview", "o", [.command, .shift]))
        viewMenu.addItem(.separator())
        viewMenu.addItem(item("Slide Navigator", "nav", "\\"))
        viewMenu.addItem(item("Agent Panel", "agent", "j"))
        viewMenu.addItem(item("Design Systems", "themes", "d", [.command, .option]))
        viewMenu.addItem(item("Keyboard Shortcuts", "shortcuts", "/"))
        viewMenu.addItem(.separator())
        let fullScreen = NSMenuItem(title: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(fullScreen)
        viewItem.submenu = viewMenu

        let playItem = NSMenuItem(); main.addItem(playItem)
        let playMenu = NSMenu(title: "Play")
        playMenu.addItem(item("Present", "present", "\r"))
        playMenu.addItem(item("Present From Start", "presentStart", "\r", [.command, .option]))
        playMenu.addItem(withTitle: "Present on Second Display", action: #selector(presentOnSecondDisplay(_:)), keyEquivalent: "")
        playMenu.addItem(item("Presenter View", "presenter", "p", [.command, .option]))
        playMenu.addItem(.separator())
        playMenu.addItem(item("Next", "next", "", []))
        playMenu.addItem(item("Previous", "prev", "", []))
        playMenu.addItem(item("First Slide", "first", "", []))
        playMenu.addItem(item("Last Slide", "last", "", []))
        playMenu.addItem(.separator())
        playMenu.addItem(item("Black Screen", "blackout", "", []))
        playMenu.addItem(item("Stop Presenting", "stop", ".", [.command]))
        playItem.submenu = playMenu

        let winItem = NSMenuItem(); main.addItem(winItem)
        let winMenu = NSMenu(title: "Window")
        winMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winMenu.addItem(.separator())
        winMenu.addItem(item("Presenter", "presenter", "", []))
        winItem.submenu = winMenu
        NSApp.windowsMenu = winMenu

        let helpItem = NSMenuItem(); main.addItem(helpItem)
        let helpMenu = NSMenu(title: "Help")
        helpMenu.addItem(withTitle: "Deck Format Guide", action: #selector(openGuideAction(_:)), keyEquivalent: "")
        helpMenu.addItem(withTitle: "Open the Welcome Deck", action: #selector(openSampleAction(_:)), keyEquivalent: "")
        helpItem.submenu = helpMenu
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = main
    }

    @objc func runCommand(_ sender: NSMenuItem) {
        guard let cmd = sender.representedObject as? String else { return }
        if cmd == "presenter" { openPresenter(); return }
        callJS(webView, "window.dekShell.command(\(AgentServer.jsonString(cmd)))")
    }

    // MARK: documents

    func openDocument(_ url: URL) {
        if jsReady && currentURL != nil {
            flushBeforeLeaving { ok in if ok { self.loadDocument(url) } }; return
        }
        loadDocument(url)
    }
    private func loadDocument(_ url: URL) {
        guard let content = try? String(contentsOf: url, encoding: .utf8) else {
            NSSound.beep(); return
        }
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        currentURL = url
        let doc: [String: Any] = [
            "name": url.lastPathComponent, "path": url.path, "content": content,
            "baseHref": url.deletingLastPathComponent().absoluteString,
        ]
        lastDoc = doc
        callJS(webView, "window.dekShell.load(\(json(doc)))")
        if presenterReady, let pv = presenterView {
            var pdoc = doc
            pdoc["index"] = lastState["index"] ?? 0
            pdoc["step"] = lastState["step"] ?? 0
            callJS(pv, "window.dekShell.load(\(json(pdoc)))")
        }
        startWatching(url)
        window.title = url.lastPathComponent
        window.representedURL = url
        if !NSApp.isActive { NSApp.activate(ignoringOtherApps: true) }
    }

    @discardableResult
    private func write(_ path: String, _ content: String) -> Bool {
        do {
            try FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
            try content.write(toFile: path, atomically: true, encoding: .utf8)
            lastWrite[path] = Date()
            lastWrittenContent[path] = content
            updatePresenter(path: path, content: content)
            return true
        } catch {
            NSLog("dek: write failed for \(path): \(error)")
            return false
        }
    }

    // MARK: file watching (reload when the deck changes on disk)

    private func startWatching(_ url: URL) {
        stopWatching()
        let path = url.path
        let fd = open(path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete, .extend], queue: .main)
        src.setEventHandler { [weak self] in
            guard let self else { return }
            self.stopWatching()
            // editors and agents often write via rename; give the new file a moment to land
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                guard FileManager.default.fileExists(atPath: path) else { return }
                self.pushFileChange(url)
                self.startWatching(url)
            }
        }
        src.setCancelHandler { close(fd) }
        src.resume()
        watcher = src
        watchedPath = path
    }

    private func stopWatching() {
        watcher?.cancel()
        watcher = nil
        watchedPath = nil
    }

    private func pushFileChange(_ url: URL) {
        guard let content = try? String(contentsOf: url, encoding: .utf8) else { return }
        if lastWrittenContent[url.path] == content { return }
        let info: [String: Any] = ["name": url.lastPathComponent, "path": url.path, "content": content]
        callJS(webView, "window.dekShell.fileChanged(\(json(info)))")
        if presenterReady, let pv = presenterView { callJS(pv, "window.dekShell.fileChanged(\(json(info)))") }
    }

    // MARK: bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let fromPresenter = message.webView === presenterView
        switch type {
        case "ready":
            if fromPresenter {
                presenterReady = true
                if var doc = lastDoc, let pv = presenterView {
                    doc["index"] = lastState["index"] ?? 0
                    doc["step"] = lastState["step"] ?? 0
                    callJS(pv, "window.dekShell.load(\(json(doc)))")
                    callJS(pv, "window.dekShell.follow(\(json(lastState)))")
                }
            } else {
                jsReady = true
                sendRecents()
                sendAgentInfo()
                let queued = pendingOpen
                pendingOpen = []
                queued.forEach(openDocument)
            }
        case "save":
            if let path = body["path"] as? String, let content = body["content"] as? String {
                let expected = body["expected"] as? String
                let disk = try? String(contentsOfFile: path, encoding: .utf8)
                let conflict = expected != nil && disk != expected && disk != content
                let ok = !conflict && write(path, content)
                if !ok { let recovery = AgentServer.supportDir.appendingPathComponent("Recovery-" + UUID().uuidString + ".html"); try? content.write(to: recovery, atomically: true, encoding: .utf8) }
                callJS(webView, "window.dekShell.saved(\(json(["path": path, "ok": ok, "conflict": conflict, "content": content])))")
            }
        case "active":
            if let path = body["path"] as? String {
                currentURL = URL(fileURLWithPath: path)
                window.title = (body["name"] as? String) ?? currentURL!.lastPathComponent
                window.representedURL = currentURL
            }
        case "state":
            lastState = body
            if presenterReady, let pv = presenterView {
                callJS(pv, "window.dekShell.follow(\(json(body)))")
            }
        case "nav":
            if let action = body["action"] as? String {
                callJS(webView, "window.dekShell.nav(\(AgentServer.jsonString(action)))")
            }
        case "appearance":
            if let value = body["value"] as? String {
                applyAppearance(value)
                UserDefaults.standard.set(value, forKey: "appearance")
            }
        case "fullscreen":
            let on = body["on"] as? Bool ?? false
            let isFull = window.styleMask.contains(.fullScreen)
            if on != isFull { window.toggleFullScreen(nil) }
        case "presenter":
            if body["open"] as? Bool ?? true { openPresenter() } else { presenterWindow?.orderOut(nil) }
        case "themesLoad":
            let content = (try? String(contentsOf: AgentServer.themesURL, encoding: .utf8)) ?? ""
            callJS(webView, "window.dekShell.themesLoaded(\(AgentServer.jsonString(content)))")
        case "themesSave":
            if let content = body["content"] as? String {
                if !write(AgentServer.themesURL.path, content) { NSLog("dek: could not write the design system library") }
            }
        case "desktopStatus": sendDesktopStatus()
        case "desktopInstall": configureDesktop(install: true)
        case "desktopRemove": configureDesktop(install: false)
        case "openDialog": openDialog(nil)
        case "newDeck": newDeck(nil)
        case "saveAs": saveAsDialog(nil)
        case "revealInFinder": revealInFinder(nil)
        case "reload": reloadDeck(nil)
        case "exportPdf": exportPdf(nil)
        case "exportDeck": exportDialog(options: body)
        case "cancelExport": if let id = body["id"] as? String { exports[id]?.cancel() }
        case "revealExport": if let path = body["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath:path)]) }
        case "importImageData":
            if let raw = body["data"] as? String, let data = Data(base64Encoded: String(raw.split(separator: ",", maxSplits: 1).last ?? "")) {
                let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + ((body["name"] as? String) ?? "Image.png"))
                do { try data.write(to: temp); importImage(temp); try? FileManager.default.removeItem(at: temp) } catch { callJS(webView, "window.dekShell.toast('Could not import image')") }
            }
        case "preparePaste":
            if var payload = body["payload"] as? [String: Any], let html = payload["html"] as? String, let source = payload["source"] as? String, let destination = body["destination"] as? String {
                do { let content = "<head>" + (payload["head"] as? String ?? "") + "</head><body>" + html + "</body>"; let copied = try copyAssets(in: content, from: URL(fileURLWithPath: source), to: URL(fileURLWithPath: destination)); payload["document"] = copied; callJS(webView, "window.dekShell.pasteContent(\(json(payload)))") }
                catch { callJS(webView, "window.dekShell.toast('Could not copy slide assets. The original is unchanged.')") }
            }
        case "openSample": openSample()
        case "pickImage": pickImage()
        case "importImage":
            if let path = body["path"] as? String { importImage(URL(fileURLWithPath: path)) }
        case "openGuide": openGuideAction(nil)
        case "openPath":
            if let path = body["path"] as? String { openDocument(URL(fileURLWithPath: path)) }
        case "saveAndOpen":
            // An import result: keep an existing (possibly edited) Dek copy unless the source is newer.
            if let path = body["path"] as? String, let content = body["content"] as? String {
                let fm = FileManager.default
                var reused = false
                if fm.fileExists(atPath: path), let source = body["source"] as? String,
                   let a = try? fm.attributesOfItem(atPath: path)[.modificationDate] as? Date,
                   let b = try? fm.attributesOfItem(atPath: source)[.modificationDate] as? Date, a >= b {
                    reused = true
                } else if !write(path, content) {
                    callJS(webView, "window.dekShell.imported(\(json(["reused": false, "failed": true])))")
                    NSSound.beep()
                    return
                }
                openDocument(URL(fileURLWithPath: path))
                callJS(webView, "window.dekShell.imported(\(json(["reused": reused, "path": path])))")
            }
        case "openExternal":
            if let raw = body["url"] as? String, let url = URL(string: raw),
               ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
            }
        default:
            break
        }
    }

    private func sendRecents() {
        let recents = NSDocumentController.shared.recentDocumentURLs.prefix(6).map {
            ["name": $0.lastPathComponent, "dir": $0.deletingLastPathComponent().lastPathComponent, "path": $0.path]
        }
        callJS(webView, "window.dekShell.setRecents(\(json(Array(recents))))")
    }

    // MARK: window delegate

    func windowDidEnterFullScreen(_ notification: Notification) {
        if (notification.object as? NSWindow) === window { callJS(webView, "window.dekShell.fullscreenChanged(true)") }
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        if (notification.object as? NSWindow) === window { callJS(webView, "window.dekShell.fullscreenChanged(false)") }
    }

    // MARK: actions

    @objc func openDialog(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.html]
        panel.allowsOtherFileTypes = true
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { [weak self] response in
            if response == .OK, let url = panel.url { self?.openDocument(url) }
        }
    }

    @objc func newDeck(_ sender: Any?) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.html]
        panel.nameFieldStringValue = "Untitled.html"
        panel.directoryURL = decksFolder()
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK, let url = panel.url else { return }
            let templateURL = Bundle.main.resourceURL!.appendingPathComponent("templates/blank.html")
            var content = (try? String(contentsOf: templateURL, encoding: .utf8)) ?? "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>Untitled deck</title></head><body>\n<section><h1>Untitled deck</h1></section>\n</body></html>\n"
            let title = url.deletingPathExtension().lastPathComponent
            content = content.replacingOccurrences(of: "Untitled deck", with: title.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;"))
            self.write(url.path, content)
            self.openDocument(url)
        }
    }

    private func decksFolder() -> URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Dek", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func openSample() {
        let src = Bundle.main.resourceURL!.appendingPathComponent("decks/Welcome.html")
        let dst = decksFolder().appendingPathComponent("Welcome to Dek.html")
        if !FileManager.default.fileExists(atPath: dst.path) {
            try? FileManager.default.copyItem(at: src, to: dst)
        }
        openDocument(FileManager.default.fileExists(atPath: dst.path) ? dst : src)
    }

    @objc func openSampleAction(_ sender: Any?) { openSample() }

    @objc func openGuideAction(_ sender: Any?) {
        let guide = Bundle.main.resourceURL!.appendingPathComponent("docs/DECK_FORMAT.md")
        NSWorkspace.shared.open(guide)
    }

    @objc func reloadDeck(_ sender: Any?) {
        guard let url = currentURL else { return }
        pushFileChange(url)
    }

    @objc func saveAsDialog(_ sender: Any?) {
        webView.evaluateJavaScript("window.dekShell.getContent()") { [weak self] result, _ in
            guard let self, result is String else { return }
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.html]
            panel.nameFieldStringValue = self.currentURL.map { $0.deletingPathExtension().lastPathComponent + " copy.html" } ?? "Untitled.html"
            panel.directoryURL = self.currentURL?.deletingLastPathComponent()
            panel.beginSheetModal(for: self.window) { response in
                guard response == .OK, let url = panel.url else { return }
                self.webView.evaluateJavaScript("window.dekShell.getContent()") { result, _ in
                    guard let content = result as? String else { return }
                    do {
                        let portable = try self.copyAssets(in: content, from: self.currentURL ?? url, to: url)
                        if self.write(url.path, portable) { self.loadDocument(url) }
                    } catch { self.callJS(self.webView, "window.dekShell.toast('Could not duplicate deck assets')") }
                }
            }
        }
    }

    private func updatePresenter(path: String, content: String) {
        guard path == currentURL?.path else { return }
        if var doc = lastDoc { doc["content"] = content; lastDoc = doc }
        if presenterReady, let pv = presenterView { callJS(pv, "window.dekShell.fileChanged(\(json(["path": path, "content": content])))") }
    }

    /// Transfer referenced local assets before writing the new document.
    private func copyAssets(in html: String, from source: URL, to destination: URL) throws -> String {
        if source.deletingLastPathComponent() == destination.deletingLastPathComponent() { return html }
        let fm = FileManager.default
        let assets = destination.deletingLastPathComponent().appendingPathComponent("assets", isDirectory: true)
        var copied: [String: URL] = [:]
        func rewrite(_ text: String, relativeTo file: URL, outputFile: URL) throws -> String {
            let patterns = [#"(?:src|href|poster)\s*=\s*["']([^"']+)["']"#, #"url\(\s*["']?([^)'"\s]+)["']?\s*\)"#, #"@import\s*["']([^"']+)["']"#]
            var changes: [(NSRange, String)] = []
            for pattern in patterns {
                let re = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
                for match in re.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                    guard let range = Range(match.range(at: 1), in: text) else { continue }
                    let ref = String(text[range]).replacingOccurrences(of: "&amp;", with: "&")
                    if ref.hasPrefix("#") { continue }
                    guard let url = URL(string: ref, relativeTo: file.deletingLastPathComponent())?.absoluteURL, url.isFileURL else { continue }
                    let key = url.standardizedFileURL.path
                    guard fm.fileExists(atPath: key) else { throw NSError(domain: "Dek", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing asset: \(ref)"]) }
                    let dst: URL
                    if let cached = copied[key] { dst = cached }
                    else {
                        try fm.createDirectory(at: assets, withIntermediateDirectories: true)
                        dst = assets.appendingPathComponent(String(UUID().uuidString.prefix(8)) + "-" + url.lastPathComponent)
                        copied[key] = dst
                        if url.pathExtension.lowercased() == "css" {
                            let css = try String(contentsOf: url, encoding: .utf8)
                            try rewrite(css, relativeTo: url, outputFile: dst).write(to: dst, atomically: true, encoding: .utf8)
                        } else { try fm.copyItem(at: URL(fileURLWithPath: key), to: dst) }
                    }
                    let name = (outputFile.deletingLastPathComponent() == assets ? "" : "assets/") + dst.lastPathComponent
                    var replacement = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
                    if let query = url.query { replacement += "?" + query }; if let fragment = url.fragment { replacement += "#" + fragment }
                    changes.append((match.range(at: 1), replacement))
                }
            }
            let srcset = try NSRegularExpression(pattern: #"srcset\s*=\s*["']([^"']+)["']"#, options: [.caseInsensitive])
            for match in srcset.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                guard let range = Range(match.range(at: 1), in: text) else { continue }
                let value = String(text[range]);if value.contains("data:") {continue}
                let candidates = try value.split(separator: ",").map { candidate -> String in
                    let parts = candidate.split(whereSeparator: { $0.isWhitespace });guard let ref=parts.first else{return ""}
                    let wrapped = try rewrite("<img src=\"" + String(ref) + "\">",relativeTo:file,outputFile:outputFile)
                    let copiedRef = String(wrapped.dropFirst(10).dropLast(2))
                    return ([copiedRef] + parts.dropFirst().map(String.init)).joined(separator:" ")
                }
                changes.append((match.range(at:1),candidates.joined(separator:", ")))
            }
            var result = text
            for (range, replacement) in changes.sorted(by: { $0.0.location > $1.0.location }) {
                if let r = Range(range, in: result) { result.replaceSubrange(r, with: replacement) }
            }
            return result
        }
        return try rewrite(html, relativeTo: source, outputFile: destination)
    }

    // MARK: images (copied next to the deck so it stays portable)

    private func pickImage() {
        guard currentURL != nil else { NSSound.beep(); return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP, .svg, .heic, .image]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Insert"
        panel.beginSheetModal(for: window) { [weak self] response in
            if response == .OK, let url = panel.url { self?.importImage(url) }
        }
    }

    private func importImage(_ src: URL) {
        if let info = imageAsset(src) { callJS(webView, "window.dekShell.imagePicked(\(json(info)))") }
        else { callJS(webView, "window.dekShell.toast(\(AgentServer.jsonString("Could not import the image. Check that the file is readable.")))") }
    }

    private func imageAsset(_ src: URL) -> [String: Any]? {
        guard let deck = currentURL else { return nil }
        let fm = FileManager.default
        let assets = deck.deletingLastPathComponent().appendingPathComponent("assets", isDirectory: true)
        try? fm.createDirectory(at: assets, withIntermediateDirectories: true)
        var name = src.lastPathComponent.replacingOccurrences(of: " ", with: "-")
        var dst = assets.appendingPathComponent(name)
        var n = 2
        while fm.fileExists(atPath: dst.path), (try? Data(contentsOf: dst)) != (try? Data(contentsOf: src)) {
            name = src.deletingPathExtension().lastPathComponent.replacingOccurrences(of: " ", with: "-") + "-\(n)." + src.pathExtension
            dst = assets.appendingPathComponent(name)
            n += 1
        }
        if !fm.fileExists(atPath: dst.path) {
            do { try fm.copyItem(at: src, to: dst) } catch { NSLog("dek: image copy failed \(error)"); NSSound.beep(); return nil }
        }
        var size: [String: Any] = [:]
        if let img = NSImage(contentsOf: dst), let rep = img.representations.first {
            size = ["width": rep.pixelsWide, "height": rep.pixelsHigh]
        }
        return ["src": "assets/\(name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name)", "size": size]
    }

    @objc func revealInFinder(_ sender: Any?) {
        if let url = currentURL { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    // MARK: PDF export (one page per slide, vector)

    @objc func exportPdf(_ sender: Any?) { exportDialog(options: ["format": "pdf"]) }
    func exportDialog(options: [String: Any]) {
        guard currentURL != nil else { return }
        let format = options["format"] as? String ?? "pdf"
        let panel = NSSavePanel()
        panel.allowedContentTypes = format == "pdf" ? [.pdf] : [UTType(filenameExtension: "pptx") ?? .data]
        panel.nameFieldStringValue = (currentURL?.deletingPathExtension().lastPathComponent ?? "Deck") + "." + format
        panel.directoryURL = currentURL?.deletingLastPathComponent()
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK, let out = panel.url else { return }
            var args = options; args["path"] = out.path; args["ui"] = true
            _ = self.startExport(args) { result in
                self.callJS(self.webView, "window.dekShell.exportResult(\(self.json(result)))")
            }
        }
    }
    @discardableResult
    func startExport(_ args: [String: Any], done: @escaping ([String: Any]) -> Void) -> String {
        let job = DeckExporter(); exports[job.id] = job
        let jobID=job.id
        if args["ui"] as? Bool == true { job.onProgress = { [weak self] status in guard let self else {return};var info=status;info["id"]=jobID;self.callJS(self.webView,"window.dekShell.exportProgress(\(self.json(info)))") } }
        let out = URL(fileURLWithPath: args["path"] as? String ?? FileManager.default.temporaryDirectory.appendingPathComponent("Dek-\(job.id).pdf").path)
        job.start(shell: webView, options: args, output: out, done: done)
        return job.id
    }
    func nativeAgentTool(_ tool: String, args: [String: Any], done: @escaping ([String: Any]) -> Void) {
        if tool == "snapshot_overview" {
            var opts = args;opts["format"]="overview";opts["includeHidden"]=true;opts["path"]=args["out"] ?? AgentServer.snapshotDir.appendingPathComponent("overview-\(UUID().uuidString).png").path
            _ = startExport(opts) { status in if let path=status["path"] {done(["ok":true,"result":["path":path]])} else {done(["ok":false,"error":status["error"] ?? "Overview failed"])} };return
        }
        if tool == "get_export_status" || tool == "cancel_export" {
            guard let id = args["job_id"] as? String, let job = exports[id] else { done(["ok": false, "error": "Export job not found"]); return }
            if tool == "cancel_export" { job.cancel() }
            done(["ok": true, "result": job.status]); return
        }
        if tool == "export_deck" {
            guard let path = args["path"] as? String, path.hasPrefix("/"), let format = args["format"] as? String, ["pdf", "pptx"].contains(format), path.lowercased().hasSuffix("." + format) else { done(["ok": false, "error": "Provide an absolute path ending in .pdf or .pptx and matching format"]); return }
            if FileManager.default.fileExists(atPath: path) && args["overwrite"] as? Bool != true { done(["ok": false, "error": "File exists. Choose a new path or pass overwrite=true."]); return }
            let id = startExport(args) { _ in }; done(["ok": true, "result": ["job_id": id, "status": "preparing"]]); return
        }
        if tool == "snapshot_slide" {
            webView.callAsyncJavaScript("const m=window.__dek.model(); if(!m)throw new Error('No deck open'); const a=ref; const i=a==null?window.__dek.state.index:typeof a==='number'?a-1:m.slides.findIndex(s=>s.id===a);if(!m.slides[i])throw new Error('Slide not found');return {index:i,title:m.slides[i].title};", arguments: ["ref": args["slide"] ?? NSNull()], in: nil, in: .page) { [weak self] result in
                guard let self, case .success(let value) = result, let slide = value as? [String: Any], let i = slide["index"] as? Int else { done(["ok": false, "error": "Slide not found"]); return }
                var opts = args; opts["format"] = "png"; opts["includeHidden"] = true; opts["slideIndex"] = i
                opts["path"] = args["out"] ?? AgentServer.snapshotDir.appendingPathComponent("slide-\(UUID().uuidString).png").path
                _ = self.startExport(opts) { status in
                    if let path = status["path"] { done(["ok": true, "result": ["path": path, "n": i + 1, "title": slide["title"] ?? "", "step": args["step"] ?? "last"]]) }
                    else { done(["ok": false, "error": status["error"] ?? "Snapshot failed"]) }
                }
            }
            return
        }
        done(["ok": false, "error": "Unknown native tool"])
    }

    // MARK: snapshots (agents look at the stage)

    func snapshot(rect: CGRect?, to out: String, done: @escaping (Bool) -> Void) {
        snapshot(view: webView, rect: rect, to: out, done: done)
    }

    func snapshot(view: WKWebView, rect: CGRect?, to out: String, done: @escaping (Bool) -> Void) {
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = true
        let scale = (view.window?.backingScaleFactor ?? 0) > 0 ? view.window!.backingScaleFactor : 2
        if let rect {
            config.rect = rect
            config.snapshotWidth = NSNumber(value: min(rect.width, 1600 / scale))
        } else {
            config.snapshotWidth = NSNumber(value: min(view.bounds.width, 1800 / scale))
        }
        view.takeSnapshot(with: config) { image, _ in
            guard let image, let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else { done(false); return }
            done((try? png.write(to: URL(fileURLWithPath: out))) != nil)
        }
    }

    // MARK: appearance

    private func applyAppearance(_ value: String) {
        switch value {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: NSApp.appearance = nil
        }
    }

    // MARK: agent / Claude Desktop integration

    private var bridgePath: String {
        Bundle.main.resourceURL!.appendingPathComponent("mcp/dek-mcp.js").path
    }

    /// Claude Desktop spawns MCP servers with a minimal PATH, so its config needs an absolute node path.
    private func nodePath() -> String {
        var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node",
                          NSHomeDirectory() + "/.volta/bin/node"]
        let nvmDir = NSHomeDirectory() + "/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmDir) {
            for v in versions.sorted(by: { $0.compare($1, options: .numeric) == .orderedDescending }) {
                candidates.append("\(nvmDir)/\(v)/bin/node")
            }
        }
        for c in candidates where FileManager.default.isExecutableFile(atPath: c) { return c }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-lc", "command -v node"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = Pipe()
        if (try? proc.run()) != nil {
            proc.waitUntilExit()
            if let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines), !out.isEmpty, out.hasPrefix("/") {
                return out
            }
        }
        return "node"
    }

    private var desktopConfigURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Claude/claude_desktop_config.json")
    }

    private func sendAgentInfo() {
        let info: [String: Any] = ["port": Int(agentServer.port), "bridge": bridgePath, "themes": AgentServer.themesURL.path,
                                   "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "0.1.0"]
        callJS(webView, "window.dekShell.agentInfo(\(json(info)))")
    }

    private func sendDesktopStatus() {
        let fm = FileManager.default
        let claudeDir = desktopConfigURL.deletingLastPathComponent()
        let found = fm.fileExists(atPath: claudeDir.path)
        var installed = false
        if let data = try? Data(contentsOf: desktopConfigURL),
           let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let servers = cfg["mcpServers"] as? [String: Any] {
            installed = servers["dek"] != nil
        }
        callJS(webView, "window.dekShell.desktopStatus(\(json(["found": found, "installed": installed])))")
    }

    private func configureDesktop(install: Bool) {
        let fm = FileManager.default
        var cfg: [String: Any] = [:]
        if let data = try? Data(contentsOf: desktopConfigURL),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            cfg = parsed
            let backup = desktopConfigURL.appendingPathExtension("bak-dek")
            if !fm.fileExists(atPath: backup.path) { try? fm.copyItem(at: desktopConfigURL, to: backup) }
        }
        var servers = cfg["mcpServers"] as? [String: Any] ?? [:]
        if install {
            servers["dek"] = ["command": nodePath(), "args": [bridgePath]]
        } else {
            servers.removeValue(forKey: "dek")
        }
        cfg["mcpServers"] = servers
        try? fm.createDirectory(at: desktopConfigURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: cfg, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: desktopConfigURL)
        }
        sendDesktopStatus()
    }

    // MARK: helpers

    private func callJS(_ view: WKWebView?, _ script: String) {
        view?.evaluateJavaScript(script, completionHandler: nil)
    }

    private func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let str = String(data: data, encoding: .utf8) else { return "null" }
        return str
    }
}

// MARK: - main

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// `dek path/to/deck.html` from the command line; `--selftest out.png` for CI-style smoke tests.
let rawArgs = Array(CommandLine.arguments.dropFirst())
if let i = rawArgs.firstIndex(of: "--selftest"), i + 1 < rawArgs.count {
    delegate.selftestPath = rawArgs[i + 1]
}
let args = rawArgs.filter { !$0.hasPrefix("-") && $0 != (delegate.selftestPath ?? "") }
delegate.pendingOpen = args.map { URL(fileURLWithPath: $0) }

app.activate(ignoringOtherApps: true)
app.run()
