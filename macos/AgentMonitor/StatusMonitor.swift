import Foundation
import Combine

enum MenuBarIconState: String {
    case offline, idle, live, active
}

struct MonitorSnapshot: Equatable {
    var iconState: MenuBarIconState = .offline
    var statusLine: String = "connecting…"
    var lastEventLine: String = "No events yet"
    var countsLine: String = "0 events"
    var serverReady: Bool = false
}

@MainActor
final class StatusMonitor: ObservableObject {
    @Published private(set) var snapshot = MonitorSnapshot()

    private var watchId: UUID?
    private var events: [[String: Any]] = []
    private let inFlightEvents: Set<String> = [
        "pretooluse", "beforeshellexecution", "beforemcpexecution",
        "beforereadfile", "subagentstart", "beforetabfileread"
    ]

    func start(serverReady: Bool) {
        snapshot.serverReady = serverReady
        updateSnapshot()
        watchId = EventLogReader.shared.startWatching { [weak self] lines in
            Task { @MainActor in
                self?.appendLines(lines)
            }
        }
        reloadAll()
    }

    func stop() {
        if let watchId { EventLogReader.shared.stopWatching(watchId) }
        self.watchId = nil
    }

    func setServerReady(_ ready: Bool) {
        snapshot.serverReady = ready
        updateSnapshot()
    }

    private func reloadAll() {
        events = EventLogReader.shared.readAllEvents()
        updateSnapshot()
    }

    private func appendLines(_ lines: [String]) {
        for line in lines {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if (obj["_event"] as? String) == "_ping" { continue }
            events.append(obj)
        }
        updateSnapshot()
    }

    private func updateSnapshot() {
        var snap = snapshot
        snap.serverReady = snapshot.serverReady

        guard snap.serverReady else {
            snap.iconState = .offline
            snap.statusLine = "offline · server not ready"
            snap.lastEventLine = "Start the panel server or restart the app"
            snap.countsLine = "\(events.count) events"
            snapshot = snap
            return
        }

        let realEvents = events.filter { ($0["_event"] as? String) != "_ping" }
        let sessions = Set(realEvents.map { EventLogReader.sessionKey(of: $0) })
        let sources = Set(realEvents.map { EventLogReader.sourceOf($0) }).sorted()

        snap.countsLine = "\(realEvents.count) events · \(sessions.count) sessions"

        guard let last = realEvents.last else {
            snap.iconState = .idle
            snap.statusLine = "idle · waiting"
            snap.lastEventLine = "No events yet — run install hooks, then use an agent"
            snapshot = snap
            return
        }

        let src = EventLogReader.sourceOf(last)
        let rawEvent = (last["_event"] as? String ?? "").lowercased()
        let ts = parseTimestamp(last["_ts"])
        let ago = relativeTime(since: ts)

        snap.lastEventLine = "Last: \(summarize(last)) (\(ago))"
        snap.statusLine = sources.isEmpty ? "live · \(src)" : "live · \(sources.joined(separator: ", "))"

        if inFlightEvents.contains(rawEvent) {
            snap.iconState = .active
        } else if let ts, Date().timeIntervalSince(ts) < 60 {
            snap.iconState = .live
        } else {
            snap.iconState = .idle
        }

        snapshot = snap
    }

    private func parseTimestamp(_ value: Any?) -> Date? {
        guard let s = value as? String else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    private func relativeTime(since date: Date?) -> String {
        guard let date else { return "?" }
        let sec = Int(Date().timeIntervalSince(date))
        if sec < 5 { return "just now" }
        if sec < 60 { return "\(sec)s ago" }
        if sec < 3600 { return "\(sec / 60)m ago" }
        return "\(sec / 3600)h ago"
    }

    private func summarize(_ ev: [String: Any]) -> String {
        let cat = categoryOf(ev)
        switch cat {
        case "prompt":
            return clip(ev["prompt"] as? String ?? "(prompt)")
        case "response":
            let t = ev["text"] as? String ?? ev["message"] as? String ?? ev["last_assistant_message"] as? String
            return clip(t ?? "(response)")
        case "thought":
            return clip(ev["text"] as? String ?? ev["thinking"] as? String ?? "(thinking)")
        case "shell":
            return clip(toolCmd(ev) ?? "(shell)")
        case "file":
            return clip(toolPath(ev) ?? "(file)")
        case "mcp":
            return clip(ev["tool_name"] as? String ?? ev["url"] as? String ?? "(mcp)")
        case "subagent":
            let task = ev["task"] as? String ?? ev["description"] as? String ?? ""
            let type = ev["subagent_type"] as? String
            return clip((type.map { "\($0): " } ?? "") + task)
        case "tool":
            let name = ev["tool_name"] as? String ?? "tool"
            return clip(name)
        default:
            return clip(ev["_event"] as? String ?? "event")
        }
    }

    private func categoryOf(_ ev: [String: Any]) -> String {
        if let msg = ev["last_assistant_message"] as? String, !msg.isEmpty { return "response" }
        let raw = (ev["_event"] as? String ?? "").lowercased()
        let aliases: [String: String] = [
            "beforesubmitprompt": "prompt", "userpromptsubmit": "prompt",
            "afteragentresponse": "response", "assistantmessage": "response",
            "afteragentthought": "thought", "thinking": "thought",
            "pretooluse": "tool", "posttooluse": "tool", "posttoolusefailure": "tool",
            "beforeshellexecution": "shell", "aftershellexecution": "shell",
            "beforemcpexecution": "mcp", "aftermcpexecution": "mcp",
            "beforereadfile": "file", "afterfileedit": "file",
            "subagentstart": "subagent", "subagentstop": "subagent",
            "sessionstart": "lifecycle", "sessionend": "lifecycle", "stop": "lifecycle",
        ]
        var cat = aliases[raw] ?? "unknown"
        if cat == "tool" {
            let tn = (ev["tool_name"] as? String ?? "").lowercased()
            if tn.contains("bash") || tn.contains("shell") || tn.contains("terminal") { return "shell" }
            if tn.contains("read") || tn.contains("write") || tn.contains("edit") { return "file" }
            if tn.hasPrefix("mcp") { return "mcp" }
        }
        return cat
    }

    private func toolCmd(_ ev: [String: Any]) -> String? {
        if let c = ev["command"] as? String { return c }
        if let input = ev["tool_input"] as? [String: Any] {
            return input["command"] as? String ?? input["cmd"] as? String
        }
        return nil
    }

    private func toolPath(_ ev: [String: Any]) -> String? {
        if let p = ev["file_path"] as? String ?? ev["path"] as? String { return p }
        if let input = ev["tool_input"] as? [String: Any] {
            return input["file_path"] as? String ?? input["path"] as? String
        }
        return nil
    }

    private func clip(_ s: String, _ n: Int = 40) -> String {
        let t = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        if t.count <= n { return t.isEmpty ? "…" : t }
        return String(t.prefix(n)) + "…"
    }
}
