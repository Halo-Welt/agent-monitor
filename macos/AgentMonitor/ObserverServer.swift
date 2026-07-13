import Foundation
import Network

final class ObserverServer {
    static let defaultPort: UInt16 = 4517
    static let defaultHost = "127.0.0.1"

    private var listener: NWListener?
    private var sseClients: [UUID: SSEClient] = [:]
    private var watchId: UUID?
    private var pingTimer: DispatchSourceTimer?
    private let queue = DispatchQueue(label: "agent-monitor.server", qos: .userInitiated)
    private let assetsDir: URL

    var port: UInt16
    var isRunning = false
    var onReady: ((Bool, String?) -> Void)?

    init(port: UInt16 = ObserverServer.defaultPort) {
        self.port = port
        if let url = Bundle.main.resourceURL?.appendingPathComponent("BundledAssets", isDirectory: true),
           FileManager.default.fileExists(atPath: url.path) {
            assetsDir = url
        } else {
            // Dev fallback: repo assets next to macos/
            let dev = URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("assets", isDirectory: true)
            assetsDir = dev
        }
    }

    func start() {
        queue.async {
            self.startInternal()
        }
    }

    func stop() {
        queue.async {
            self.stopInternal()
        }
    }

    private func startInternal() {
        guard listener == nil else { return }

        let portEnv = ProcessInfo.processInfo.environment["OBSERVER_PORT"].flatMap { UInt16($0) }
        if let portEnv { port = portEnv }

        do {
            let params = NWParameters.tcp
            params.requiredInterfaceType = .loopback
            params.allowLocalEndpointReuse = true
            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        } catch {
            DispatchQueue.main.async { self.onReady?(false, error.localizedDescription) }
            return
        }

        listener?.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.isRunning = true
                DispatchQueue.main.async { self.onReady?(true, nil) }
                self.watchId = EventLogReader.shared.startWatching { lines in
                    self.queue.async {
                        for line in lines { self.broadcastSSE(line) }
                    }
                }
                self.startPingTimer()
            case .failed(let err):
                self.isRunning = false
                DispatchQueue.main.async { self.onReady?(false, err.localizedDescription) }
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] conn in
            self?.handleConnection(conn)
        }
        listener?.start(queue: queue)
    }

    private func stopInternal() {
        pingTimer?.cancel()
        pingTimer = nil
        if let watchId { EventLogReader.shared.stopWatching(watchId) }
        watchId = nil
        for (_, client) in sseClients { client.close() }
        sseClients.removeAll()
        listener?.cancel()
        listener = nil
        isRunning = false
    }

    private func startPingTimer() {
        pingTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 25, repeating: 25)
        timer.setEventHandler { [weak self] in
            let ping = "{\"_event\":\"_ping\",\"_ts\":\"\(ISO8601DateFormatter().string(from: Date()))\"}"
            self?.broadcastSSE(ping)
        }
        timer.resume()
        pingTimer = timer
    }

    private func broadcastSSE(_ line: String) {
        for (id, client) in sseClients {
            if !client.send(line) {
                sseClients.removeValue(forKey: id)
            }
        }
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, _ in
            guard let self, let data, !data.isEmpty else {
                connection.cancel()
                return
            }
            guard let request = HTTPRequest.parse(data) else {
                self.respond(connection, status: 400, type: "text/plain", body: "bad request")
                return
            }
            self.route(connection, request: request)
        }
    }

    private func route(_ connection: NWConnection, request: HTTPRequest) {
        let path = request.path
        let method = request.method

        if path == "/" || path == "/index.html" {
            return serveFile(connection, name: "index.html", type: "text/html; charset=utf-8")
        }

        if path.hasPrefix("/"), path.contains(".") {
            let name = String(path.dropFirst())
            if name.range(of: #"^[\w.-]+\.(js|css|svg|png|woff2?)$"#, options: .regularExpression) != nil {
                let ext = (name as NSString).pathExtension.lowercased()
                let types: [String: String] = [
                    "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                    "svg": "image/svg+xml", "png": "image/png",
                    "woff": "font/woff", "woff2": "font/woff2",
                ]
                return serveFile(connection, name: name, type: types[ext] ?? "application/octet-stream")
            }
        }

        if path == "/api/events" && method == "GET" {
            let events = EventLogReader.shared.readRecentEvents()
            guard let data = try? JSONSerialization.data(withJSONObject: events),
                  let body = String(data: data, encoding: .utf8) else {
                return respond(connection, status: 500, type: "text/plain", body: "encode error")
            }
            return respond(connection, status: 200, type: "application/json; charset=utf-8", body: body)
        }

        if path == "/api/transcript" && method == "GET" {
            let rel = request.query["file"] ?? ""
            let txDir = EventLogReader.shared.transcriptsDir
            let resolved = txDir.appendingPathComponent(rel).standardizedFileURL
            guard resolved.path.hasPrefix(txDir.standardizedFileURL.path + "/") || resolved == txDir.standardizedFileURL else {
                return respond(connection, status: 400, type: "text/plain", body: "bad path")
            }
            guard let body = try? String(contentsOf: resolved, encoding: .utf8) else {
                return respond(connection, status: 404, type: "text/plain", body: "not found")
            }
            return respond(connection, status: 200, type: "text/plain; charset=utf-8", body: body)
        }

        if path == "/api/session/delete" && method == "POST" {
            let key = request.query["key"] ?? ""
            guard !key.isEmpty else {
                return respond(connection, status: 400, type: "text/plain", body: "missing key")
            }
            do {
                let removed = try EventLogReader.shared.deleteSession(key: key)
                let body = "{\"removed\":\(removed)}"
                return respond(connection, status: 200, type: "application/json", body: body)
            } catch {
                return respond(connection, status: 500, type: "text/plain", body: "delete failed: \(error.localizedDescription)")
            }
        }

        if path == "/api/history/clear" && method == "POST" {
            do {
                try EventLogReader.shared.clearHistory()
                return respond(connection, status: 200, type: "application/json", body: "{\"ok\":true}")
            } catch {
                return respond(connection, status: 500, type: "text/plain", body: "clear failed: \(error.localizedDescription)")
            }
        }

        if path == "/stream" && method == "GET" {
            return handleSSE(connection)
        }

        respond(connection, status: 404, type: "text/plain", body: "not found")
    }

    private func serveFile(_ connection: NWConnection, name: String, type: String) {
        let fileURL = assetsDir.appendingPathComponent(name).standardizedFileURL
        let base = assetsDir.standardizedFileURL.path
        guard fileURL.path.hasPrefix(base + "/") else {
            return respond(connection, status: 404, type: "text/plain", body: "not found")
        }
        guard let body = try? Data(contentsOf: fileURL) else {
            return respond(connection, status: 404, type: "text/plain", body: "not found")
        }
        respondRaw(connection, status: 200, type: type, body: body)
    }

    private func handleSSE(_ connection: NWConnection) {
        let id = UUID()
        let client = SSEClient(connection: connection)
        sseClients[id] = client
        client.sendComment("connected")
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .cancelled, .failed:
                self?.sseClients.removeValue(forKey: id)
            default:
                break
            }
        }
    }

    private func respond(_ connection: NWConnection, status: Int, type: String, body: String) {
        respondRaw(connection, status: status, type: type, body: Data(body.utf8))
    }

    private func respondRaw(_ connection: NWConnection, status: Int, type: String, body: Data) {
        let phrase = HTTPRequest.statusPhrase(status)
        var header = "HTTP/1.1 \(status) \(phrase)\r\n"
        header += "Content-Type: \(type)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Cache-Control: no-store\r\n"
        header += "Connection: close\r\n\r\n"
        var data = Data(header.utf8)
        data.append(body)
        connection.send(content: data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    var panelURL: URL {
        URL(string: "http://\(Self.defaultHost):\(port)/")!
    }
}

// MARK: - HTTP helpers

private struct HTTPRequest {
    let method: String
    let path: String
    let query: [String: String]

    static func parse(_ data: Data) -> HTTPRequest? {
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return nil }
        let lines = text.split(separator: "\r\n", omittingEmptySubsequences: false)
        guard let first = lines.first else { return nil }
        let parts = first.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0])
        let rawPath = String(parts[1])
        let urlParts = rawPath.split(separator: "?", maxSplits: 1)
        let path = String(urlParts[0])
        var query: [String: String] = [:]
        if urlParts.count == 2 {
            for pair in urlParts[1].split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1)
                if kv.count == 2 {
                    query[String(kv[0])] = String(kv[1]).removingPercentEncoding ?? String(kv[1])
                }
            }
        }
        return HTTPRequest(method: method, path: path, query: query)
    }

    static func statusPhrase(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 400: return "Bad Request"
        case 404: return "Not Found"
        case 500: return "Internal Server Error"
        default: return "OK"
        }
    }
}

private final class SSEClient {
    private let connection: NWConnection
    private var open = true

    init(connection: NWConnection) {
        self.connection = connection
        let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n"
        connection.send(content: Data(headers.utf8), completion: .idempotent)
    }

    func sendComment(_ text: String) {
        sendRaw(": \(text)\n\n")
    }

    @discardableResult
    func send(_ line: String) -> Bool {
        sendRaw("data: \(line)\n\n")
    }

    @discardableResult
    private func sendRaw(_ payload: String) -> Bool {
        guard open else { return false }
        connection.send(content: Data(payload.utf8), completion: .idempotent)
        return true
    }

    func close() {
        open = false
        connection.cancel()
    }
}
