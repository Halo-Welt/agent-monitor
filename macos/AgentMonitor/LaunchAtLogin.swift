import Foundation
import ServiceManagement

enum LaunchAtLogin {
    private static let enabledKey = "launchAtLogin"

    static var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledKey) }
        set {
            UserDefaults.standard.set(newValue, forKey: enabledKey)
            apply(newValue)
        }
    }

    static func applyOnLaunch() {
        apply(isEnabled)
    }

    private static func apply(_ enabled: Bool) {
        if #available(macOS 13.0, *) {
            do {
                if enabled {
                    try SMAppService.mainApp.register()
                } else {
                    try SMAppService.mainApp.unregister()
                }
            } catch {
                NSLog("[AgentMonitor] Launch at login: \(error.localizedDescription)")
            }
        }
    }
}
