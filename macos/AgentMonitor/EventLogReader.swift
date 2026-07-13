import Foundation

/// Shared JSONL reader/writer for ~/.cursor/observer/events.jsonl
final class EventLogReader {
    static let shared = EventLogReader()

    let obsDir: URL
    let eventsFile: URL
    let transcriptsDir: URL

    private let queue = DispatchQueue(label: "agent-monitor.event-log", qos: .userInitiated)
    private var fileOffset: UInt64 = 0
    private var source: DispatchSourceFileSystemObject?
    private var pollTimer: DispatchSourceTimer?
    private var changeHandlers: [UUID: ([String]) -> Void] = [:]

    private init() {
        let home = FileManager.default.homeDirectoryForCurrentUser
        obsDir = home.appendingPathComponent(".cursor/observer", isDirectory: true)
        eventsFile = obsDir.appendingPathComponent("events.jsonl")
        transcriptsDir = obsDir.appendingPathComponent("transcripts", isDirectory: true)
        try? FileManager.default.createDirectory(at: obsDir, withIntermediateDirectories: true)
    }

    // MARK: - Session helpers (match panel UI)

    static func sessionKey(of event: [String: Any]) -> String {
        if let cid = event["conversation_id"] as? String, !cid.isEmpty { return cid }
        if let sid = event["session_id"] as? String, !sid.isEmpty { return sid }
        return "\(sourceOf(event)):no-session"
    }

    static func sourceOf(_ event: [String: Any]) -> String {
        if event["cursor_version"] != nil { return "cursor" }
        return (event["_source"] as? String) ?? "unknown"
    }

    static func safeName(_ value: Any?) -> String {
        let raw = String(describing: value ?? "")
        let cleaned = raw.replacingOccurrences(of: "[^a-zA-Z0-9._-]", with: "_", options: .regularExpression)
        return cleaned.isEmpty ? "_" : cleaned
    }

    // MARK: - Read

    func readAllEvents() -> [[String: Any]] {
        guard let text = try? String(contentsOf: eventsFile, encoding: .utf8) else { return [] }
        return parseLines(text)
    }

    /// Reads only the most recent events by seeking to a bounded tail window, so
    /// cost stays flat no matter how large the log grows (the panel used to load
    /// the whole file at once and stall on a multi-hundred-MB log). Older history
    /// stays on disk; the panel simply shows the recent window.
    func readRecentEvents(limit: Int = 5000, windowBytes: UInt64 = 48 * 1024 * 1024) -> [[String: Any]] {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: eventsFile.path),
              let size = attrs[.size] as? UInt64, size > 0 else { return [] }
        guard let handle = try? FileHandle(forReadingFrom: eventsFile) else { return [] }
        defer { try? handle.close() }
        let start = size > windowBytes ? size - windowBytes : 0
        handle.seek(toFileOffset: start)
        var data = handle.readDataToEndOfFile()
        // If we started mid-file, drop the partial first line up to the first
        // newline (a single 0x0A byte, so this never splits a multibyte char).
        if start > 0, let nl = data.firstIndex(of: 0x0A) {
            data = data.subdata(in: (nl + 1)..<data.endIndex)
        }
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        let events = parseLines(text)
        return events.count > limit ? Array(events.suffix(limit)) : events
    }

    func parseLines(_ text: String) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let s = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !s.isEmpty, let data = s.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            out.append(obj)
        }
        return out
    }

    // MARK: - Watch / tail

    func startWatching(onNewLines: @escaping ([String]) -> Void) -> UUID {
        let id = UUID()
        queue.async {
            self.changeHandlers[id] = onNewLines
            if self.changeHandlers.count == 1 {
                self.bootstrapOffset()
                self.startFileWatch()
                self.startPollTimer()
            }
        }
        return id
    }

    func stopWatching(_ id: UUID) {
        queue.async {
            self.changeHandlers.removeValue(forKey: id)
            if self.changeHandlers.isEmpty {
                self.source?.cancel()
                self.source = nil
                self.pollTimer?.cancel()
                self.pollTimer = nil
            }
        }
    }

    func resetOffsetToEnd() {
        queue.async {
            self.bootstrapOffset()
        }
    }

    private func bootstrapOffset() {
        if let attrs = try? FileManager.default.attributesOfItem(atPath: eventsFile.path),
           let size = attrs[.size] as? UInt64 {
            fileOffset = size
        } else {
            fileOffset = 0
        }
    }

    private func startFileWatch() {
        let fd = open(eventsFile.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: .write, queue: queue)
        src.setEventHandler { [weak self] in self?.readNewLines() }
        src.setCancelHandler { close(fd) }
        src.resume()
        source = src
    }

    private func startPollTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.readNewLines() }
        timer.resume()
        pollTimer = timer
    }

    private func readNewLines() {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: eventsFile.path),
              let size = attrs[.size] as? UInt64 else { return }
        if size < fileOffset { fileOffset = 0 }
        if size == fileOffset { return }

        let handle = try? FileHandle(forReadingFrom: eventsFile)
        defer { try? handle?.close() }
        handle?.seek(toFileOffset: fileOffset)
        guard let handle else { return }
        let data = handle.readDataToEndOfFile()
        fileOffset = size
        guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }

        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !lines.isEmpty else { return }
        let handlers = changeHandlers.values
        DispatchQueue.main.async {
            handlers.forEach { $0(lines) }
        }
    }

    // MARK: - Mutations

    func deleteSession(key: String) throws -> Int {
        let text = (try? String(contentsOf: eventsFile, encoding: .utf8)) ?? ""
        var removed = 0
        var keep: [String] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let s = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !s.isEmpty else { continue }
            guard let data = s.data(using: .utf8),
                  let ev = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                keep.append(s)
                continue
            }
            if Self.sessionKey(of: ev) == key {
                removed += 1
            } else {
                keep.append(s)
            }
        }
        let tmp = eventsFile.appendingPathExtension("tmp")
        let body = keep.isEmpty ? "" : keep.joined(separator: "\n") + "\n"
        try body.write(to: tmp, atomically: true, encoding: .utf8)
        _ = try FileManager.default.replaceItem(at: eventsFile, withItemAt: tmp, backupItemName: nil, options: [], resultingItemURL: nil)
        bootstrapOffset()
        let safe = Self.safeName(key)
        try? FileManager.default.removeItem(at: transcriptsDir.appendingPathComponent("\(safe).jsonl"))
        try? FileManager.default.removeItem(at: transcriptsDir.appendingPathComponent(safe))
        return removed
    }

    func clearHistory() throws {
        try Data().write(to: eventsFile)
        fileOffset = 0
        if let items = try? FileManager.default.contentsOfDirectory(at: transcriptsDir, includingPropertiesForKeys: nil) {
            for item in items { try? FileManager.default.removeItem(at: item) }
        }
    }
}
