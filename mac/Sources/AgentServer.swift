import AppKit
import Foundation
import Network

/// Loopback-only HTTP API for agents. The MCP bridge (mcp/dek-mcp.js) is the
/// only intended client. Auth: bearer token written to
/// ~/Library/Application Support/Dek/agent.json (0600), rotated per launch.
///
/// Almost everything is one endpoint, POST /rpc {tool, args, author}, which is
/// forwarded to the web shell (window.dekShell.rpc). The shell returns the
/// result plus any file writes it wants performed; the server writes them
/// before answering, so the agent never reads a stale file. Snapshots need the
/// native layer and are handled here.
final class AgentServer {

    typealias JSHandler = (_ script: String, _ done: @escaping (String?) -> Void) -> Void

    private var listener: NWListener?
    private let queue = DispatchQueue(label: "dek.agent.server")
    let token = UUID().uuidString
    private(set) var port: UInt16 = 0

    var evalJS: JSHandler?
    /// Runs the shell's async rpc and returns its JSON string.
    var rpcJS: ((_ requestJSON: String, _ done: @escaping (String?) -> Void) -> Void)?
    var writeFile: ((_ path: String, _ content: String) -> Bool)?
    var openFile: ((_ path: String) -> Void)?
    var snapshot: ((_ rect: CGRect?, _ outPath: String, _ done: @escaping (Bool) -> Void) -> Void)?
    var snapshotWindow: ((_ which: String, _ outPath: String, _ done: @escaping (Bool) -> Void) -> Void)?

    // MARK: lifecycle

    func start() {
        for candidate in UInt16(43217)...43227 {
            let params = NWParameters.tcp
            params.requiredLocalEndpoint = NWEndpoint.hostPort(
                host: NWEndpoint.Host("127.0.0.1"),
                port: NWEndpoint.Port(rawValue: candidate)!)
            if let l = try? NWListener(using: params) {
                listener = l
                port = candidate
                break
            }
        }
        guard let listener else {
            NSLog("dek agent: no port available")
            return
        }
        listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        listener.start(queue: queue)
        writeStateFile()
        NSLog("dek agent: listening on 127.0.0.1:%d", Int(port))
    }

    func stop() {
        listener?.cancel()
        try? FileManager.default.removeItem(at: Self.stateURL)
    }

    static var supportDir: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Dek", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var stateURL: URL { supportDir.appendingPathComponent("agent.json") }

    /// The design-system library: one JSON file shared by every deck.
    static var themesURL: URL { supportDir.appendingPathComponent("design-systems.json") }

    static var snapshotDir: URL {
        let dir = supportDir.appendingPathComponent("snapshots", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func writeStateFile() {
        let state: [String: Any] = ["port": Int(port), "token": token, "pid": Int(ProcessInfo.processInfo.processIdentifier), "version": "0.1.0"]
        if let data = try? JSONSerialization.data(withJSONObject: state) {
            try? data.write(to: Self.stateURL)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Self.stateURL.path)
        }
    }

    // MARK: connection handling

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        readRequest(conn, buffer: Data())
    }

    private func readRequest(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, complete, error in
            guard let self else { return }
            var buf = buffer
            if let data { buf.append(data) }
            if error != nil { conn.cancel(); return }
            if let headerEnd = buf.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = buf.subdata(in: 0..<headerEnd.lowerBound)
                guard let head = String(data: headerData, encoding: .utf8) else { conn.cancel(); return }
                let contentLength = Self.contentLength(head)
                let bodyStart = headerEnd.upperBound
                let haveBody = buf.count - bodyStart
                if haveBody >= contentLength || complete {
                    let body = buf.subdata(in: bodyStart..<min(bodyStart + contentLength, buf.count))
                    self.route(conn, head: head, body: body)
                } else if buf.count > (16 << 20) {
                    conn.cancel()
                } else {
                    self.readRequest(conn, buffer: buf)
                }
            } else if complete || buf.count > (16 << 20) {
                conn.cancel()
            } else {
                self.readRequest(conn, buffer: buf)
            }
        }
    }

    private static func contentLength(_ head: String) -> Int {
        for line in head.components(separatedBy: "\r\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            if parts.count == 2, parts[0].lowercased() == "content-length" {
                return Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        return 0
    }

    private func respond(_ conn: NWConnection, status: String, json: String) {
        let body = Data(json.utf8)
        let head = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    private func respondJSON(_ conn: NWConnection, _ obj: [String: Any], status: String = "200 OK") {
        if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
            respond(conn, status: status, json: s)
        } else {
            respond(conn, status: "500 Internal Server Error", json: #"{"ok":false,"error":"encode"}"#)
        }
    }

    // MARK: routing

    private func route(_ conn: NWConnection, head: String, body: Data) {
        let requestLine = head.components(separatedBy: "\r\n").first ?? ""
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { respond(conn, status: "400 Bad Request", json: #"{"ok":false,"error":"bad request"}"#); return }
        let method = String(parts[0])
        let path = String(parts[1])

        guard head.lowercased().contains("authorization: bearer \(token.lowercased())") else {
            respond(conn, status: "401 Unauthorized", json: #"{"ok":false,"error":"bad token"}"#)
            return
        }

        let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]

        switch (method, path) {
        case ("GET", "/state"):
            askJS(conn, "window.dekShell.state()")
        case ("POST", "/seen"):
            let author = payload["author"] as? String ?? "Agent"
            DispatchQueue.main.async { self.evalJS?("window.dekShell.agentSeen(\(Self.jsonString(author)))") { _ in } }
            respond(conn, status: "200 OK", json: #"{"ok":true}"#)
        case ("POST", "/rpc"):
            guard let tool = payload["tool"] as? String else {
                respond(conn, status: "400 Bad Request", json: #"{"ok":false,"error":"tool required"}"#)
                return
            }
            let args = payload["args"] as? [String: Any] ?? [:]
            let author = payload["author"] as? String ?? "Agent"
            switch tool {
            case "snapshot_slide": snapshotSlide(conn, args: args, author: author)
            case "snapshot_overview": snapshotOverview(conn, args: args, author: author)
            case "snapshot_window":
                let which = args["window"] as? String ?? "main"
                let out = self.snapshotPath(args, suffix: "window-\(which)")
                // optional: run a shell command first (the same ones the menus run), e.g. "settings", "agent", "edit"
                let command = (args["command"] as? String)?.replacingOccurrences(of: "\"", with: "")
                DispatchQueue.main.async {
                    if let command, !command.isEmpty { self.evalJS?("window.dekShell.command(\(Self.jsonString(command)))") { _ in } }
                    DispatchQueue.main.asyncAfter(deadline: .now() + (command == nil ? 0 : 0.45)) {
                        guard let snap = self.snapshotWindow else { self.queue.async { self.respondJSON(conn, ["ok": false, "error": "no ui"]) }; return }
                        snap(which, out) { ok in self.queue.async { self.respondJSON(conn, ok ? ["ok": true, "result": ["path": out, "window": which]] : ["ok": false, "error": "snapshot failed (is the \(which) window open?)"]) } }
                    }
                }
            default: rpc(conn, tool: tool, args: args, author: author)
            }
        default:
            respond(conn, status: "404 Not Found", json: #"{"ok":false,"error":"unknown endpoint"}"#)
        }
    }

    // MARK: rpc → shell

    /// Run a shell tool and hand back its parsed response (writes and opens already performed).
    private func callShell(tool: String, args: [String: Any], author: String, done: @escaping ([String: Any]) -> Void) {
        var args = args
        if tool == "import_deck", let path = args["path"] as? String {
            // the shell cannot read files; hand it the content of the file to import
            if let content = try? String(contentsOfFile: path, encoding: .utf8) { args["content"] = content }
            else { done(["ok": false, "error": "could not read \(path)"]); return }
        }
        let req: [String: Any] = ["tool": tool, "args": args, "author": author]
        guard let data = try? JSONSerialization.data(withJSONObject: req), let json = String(data: data, encoding: .utf8) else {
            done(["ok": false, "error": "encode"]); return
        }
        DispatchQueue.main.async {
            guard let evalJS = self.evalJS else { done(["ok": false, "error": "ui not ready"]); return }
            var finished = false
            // a stalled web process must fail the tool call, never hang the agent
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
                if !finished { finished = true; done(["ok": false, "error": "Dek's window did not respond within 20s (is it hidden or minimized?)"]) }
            }
            let run: (String, @escaping (String?) -> Void) -> Void = self.rpcJS ?? { js, cb in evalJS("window.dekShell.rpc(\(Self.jsonString(js)))", cb) }
            run(json) { result in
                if finished { return }
                finished = true
                guard let str = result, let d = str.data(using: .utf8),
                      var res = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else {
                    done(["ok": false, "error": "no result from ui"]); return
                }
                var failed: [String] = []
                if let writes = res["writes"] as? [[String: Any]] {
                    for w in writes {
                        if let p = w["path"] as? String, let c = w["content"] as? String {
                            if !(self.writeFile?(p, c) ?? false) { failed.append(p) }
                        }
                    }
                }
                res.removeValue(forKey: "writes")
                if !failed.isEmpty {
                    res["ok"] = false
                    res["error"] = "could not write \(failed.joined(separator: ", "))"
                }
                if let open = res["open"] as? String {
                    self.openFile?(open)
                    res.removeValue(forKey: "open")
                }
                done(res)
            }
        }
    }

    private func rpc(_ conn: NWConnection, tool: String, args: [String: Any], author: String) {
        callShell(tool: tool, args: args, author: author) { res in
            self.queue.async { self.respondJSON(conn, res) }
        }
    }

    // MARK: snapshots

    private func snapshotPath(_ args: [String: Any], suffix: String) -> String {
        if let out = args["out"] as? String, out.hasSuffix(".png") { return out }
        let stamp = Int(Date().timeIntervalSince1970)
        pruneSnapshots()
        return Self.snapshotDir.appendingPathComponent("\(suffix)-\(stamp).png").path
    }

    private func pruneSnapshots() {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: Self.snapshotDir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let sorted = items.sorted {
            let a = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let b = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return a > b
        }
        for old in sorted.dropFirst(40) { try? fm.removeItem(at: old) }
    }

    private func snapshotSlide(_ conn: NWConnection, args: [String: Any], author: String) {
        callShell(tool: "prepare_snapshot", args: args, author: author) { res in
            guard res["ok"] as? Bool == true, let r = res["result"] as? [String: Any],
                  let x = r["x"] as? Double, let y = r["y"] as? Double, let w = r["w"] as? Double, let h = r["h"] as? Double else {
                self.queue.async { self.respondJSON(conn, res) }
                return
            }
            let settle = (args["settle"] as? Double ?? 900) / 1000
            let out = self.snapshotPath(args, suffix: "slide-\(r["n"] as? Int ?? 0)")
            DispatchQueue.main.asyncAfter(deadline: .now() + settle) {
                guard let snapshot = self.snapshot else {
                    self.queue.async { self.respondJSON(conn, ["ok": false, "error": "no ui"]) }
                    return
                }
                var finished = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
                    if !finished { finished = true; self.queue.async { self.respondJSON(conn, ["ok": false, "error": "snapshot timed out (is the Dek window hidden or minimized?)"]) } }
                }
                snapshot(CGRect(x: x, y: y, width: w, height: h), out) { ok in
                    if finished { return }
                    finished = true
                    var result: [String: Any] = r
                    result["path"] = out
                    self.queue.async {
                        self.respondJSON(conn, ok ? ["ok": true, "result": result] : ["ok": false, "error": "snapshot failed"])
                    }
                }
            }
        }
    }

    private func snapshotOverview(_ conn: NWConnection, args: [String: Any], author: String) {
        callShell(tool: "overview", args: ["open": true], author: author) { res in
            guard res["ok"] as? Bool == true else { self.queue.async { self.respondJSON(conn, res) }; return }
            let out = self.snapshotPath(args, suffix: "overview")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
                guard let snapshot = self.snapshot else {
                    self.queue.async { self.respondJSON(conn, ["ok": false, "error": "no ui"]) }
                    return
                }
                snapshot(nil, out) { ok in
                    self.callShell(tool: "overview", args: ["open": false], author: author) { _ in
                        self.queue.async {
                            self.respondJSON(conn, ok ? ["ok": true, "result": ["path": out]] : ["ok": false, "error": "snapshot failed"])
                        }
                    }
                }
            }
        }
    }

    // MARK: helpers

    private func askJS(_ conn: NWConnection, _ script: String) {
        DispatchQueue.main.async {
            guard let evalJS = self.evalJS else {
                self.respond(conn, status: "503 Service Unavailable", json: #"{"ok":false,"error":"ui not ready"}"#)
                return
            }
            var finished = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
                if !finished { finished = true; self.queue.async { self.respond(conn, status: "504 Gateway Timeout", json: #"{"ok":false,"error":"Dek's window did not respond within 20s"}"#) } }
            }
            evalJS(script) { result in
                if finished { return }
                finished = true
                self.queue.async {
                    self.respond(conn, status: "200 OK", json: result ?? #"{"ok":false,"error":"no result"}"#)
                }
            }
        }
    }

    static func jsonString(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]),
              let arr = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(arr.dropFirst().dropLast())
    }
}
