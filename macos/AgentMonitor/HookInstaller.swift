import Foundation
import AppKit

enum HookInstaller {
    static func install(completion: @escaping (Result<String, Error>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let scriptURL = resolveInstallScript()
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/bin/sh")
                process.arguments = [scriptURL.path]
                process.currentDirectoryURL = scriptURL.deletingLastPathComponent()

                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe

                try process.run()
                process.waitUntilExit()

                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8) ?? ""

                if process.terminationStatus == 0 {
                    DispatchQueue.main.async { completion(.success(output)) }
                } else {
                    DispatchQueue.main.async {
                        completion(.failure(NSError(domain: "HookInstaller", code: Int(process.terminationStatus),
                                                    userInfo: [NSLocalizedDescriptionKey: output.isEmpty ? "install failed" : output])))
                    }
                }
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    private static func resolveInstallScript() -> URL {
        if let bundled = Bundle.main.resourceURL?
            .appendingPathComponent("install-kit/install.sh"),
           FileManager.default.fileExists(atPath: bundled.path) {
            return bundled
        }
        if let bundled = Bundle.main.url(forResource: "install", withExtension: "sh") {
            return bundled
        }
        // Dev fallback
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("install.sh")
    }

    static func showResultAlert(success: Bool, message: String) {
        let l10n = L10n.shared
        let alert = NSAlert()
        alert.messageText = success ? l10n.t("alert.hooksInstalled") : l10n.t("alert.installFailed")
        alert.informativeText = message
        alert.alertStyle = success ? .informational : .warning
        alert.addButton(withTitle: l10n.t("alert.ok"))
        alert.runModal()
    }
}
