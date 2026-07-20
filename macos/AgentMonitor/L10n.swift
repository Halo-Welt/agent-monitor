import Foundation

/// UI language for the menu bar app. Independent from the web panel's own
/// language toggle (browser localStorage vs this app's UserDefaults) — the two
/// surfaces are separate runtimes, each defaults to the system language and
/// can be overridden on its own.
enum AppLanguage: String {
    case en, zh
    var other: AppLanguage { self == .en ? .zh : .en }
}

final class L10n: ObservableObject {
    static let shared = L10n()
    private static let key = "appLanguage"

    @Published private(set) var lang: AppLanguage

    private init() {
        if let saved = UserDefaults.standard.string(forKey: Self.key), let l = AppLanguage(rawValue: saved) {
            lang = l
        } else {
            let preferred = Locale.preferredLanguages.first ?? "en"
            lang = preferred.lowercased().hasPrefix("zh") ? .zh : .en
        }
    }

    func toggle() {
        lang = lang.other
        UserDefaults.standard.set(lang.rawValue, forKey: Self.key)
    }

    func t(_ key: String) -> String {
        Self.dict[lang]?[key] ?? Self.dict[.en]?[key] ?? key
    }

    // Menu/alert/status chrome only — the summarized event text embedded in
    // the menu (tool names, prompt/response snippets) stays as captured.
    private static let dict: [AppLanguage: [String: String]] = [
        .en: [
            "menu.openPanel": "Open Panel",
            "menu.installHooks": "Install Hooks…",
            "menu.launchAtLogin": "Launch at Login",
            "menu.language": "Chinese UI",
            "menu.quit": "Quit",
            "alert.hooksInstalled": "Hooks Installed",
            "alert.installFailed": "Install Failed",
            "alert.ok": "OK",
            "alert.hooksInstalledDefaultMsg": "Cursor, Claude Code, and Codex hooks registered. Reload Cursor and start a new Codex session.",
            "status.offlineReady": "offline · server not ready",
            "status.restartApp": "Restart the app to start the panel server",
            "status.idleWaiting": "idle · waiting",
            "status.noEventsYet": "No events yet — run install hooks, then use an agent",
            "status.lastFormat": "Last: %@ (%@)",
            "status.liveFormat": "live · %@",
            "count.events": "%d events",
            "count.eventsAndSessions": "%d events · %d sessions",
            "time.justNow": "just now",
            "time.secAgo": "%ds ago",
            "time.minAgo": "%dm ago",
            "time.hourAgo": "%dh ago",
        ],
        .zh: [
            "menu.openPanel": "打开面板",
            "menu.installHooks": "安装 Hooks…",
            "menu.launchAtLogin": "登录时启动",
            "menu.language": "中文界面",
            "menu.quit": "退出",
            "alert.hooksInstalled": "Hooks 安装成功",
            "alert.installFailed": "安装失败",
            "alert.ok": "好",
            "alert.hooksInstalledDefaultMsg": "已注册 Cursor、Claude Code 与 Codex hooks；请重新加载 Cursor，并新建 Codex 会话。",
            "status.offlineReady": "离线 · 服务未就绪",
            "status.restartApp": "重启应用以启动面板服务",
            "status.idleWaiting": "空闲 · 等待中",
            "status.noEventsYet": "暂无事件 — 先安装 hooks，然后使用任意 agent",
            "status.lastFormat": "最近：%@（%@）",
            "status.liveFormat": "实时 · %@",
            "count.events": "%d 个事件",
            "count.eventsAndSessions": "%d 个事件 · %d 个会话",
            "time.justNow": "刚刚",
            "time.secAgo": "%d 秒前",
            "time.minAgo": "%d 分钟前",
            "time.hourAgo": "%d 小时前",
        ],
    ]
}
