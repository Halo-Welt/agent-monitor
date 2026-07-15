import SwiftUI
import AppKit

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    @Published var monitor = StatusMonitor()
    @Published var serverError: String?
    @Published var launchAtLogin = LaunchAtLogin.isEnabled

    private let server = ObserverServer()
    private var started = false

    func start() {
        guard !started else { return }
        started = true

        LaunchAtLogin.applyOnLaunch()

        server.onReady = { [weak self] ready, error in
            Task { @MainActor in
                self?.serverError = error
                self?.monitor.setServerReady(ready)
                if ready {
                    self?.monitor.start(serverReady: true)
                }
            }
        }
        server.start()
    }

    func openPanel() {
        PanelWindowController.shared.showPanel(url: server.panelURL)
    }

    func installHooks() {
        HookInstaller.install { result in
            switch result {
            case .success(let output):
                let msg = output.isEmpty ? L10n.shared.t("alert.hooksInstalledDefaultMsg") : output
                HookInstaller.showResultAlert(success: true, message: String(msg.suffix(800)))
            case .failure(let error):
                HookInstaller.showResultAlert(success: false, message: error.localizedDescription)
            }
        }
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        launchAtLogin = enabled
        LaunchAtLogin.isEnabled = enabled
    }

    func quit() {
        server.stop()
        monitor.stop()
        NSApplication.shared.terminate(nil)
    }
}

struct StatusDot: View {
    let state: MenuBarIconState

    var color: Color {
        switch state {
        case .offline: return .red
        case .idle: return .gray
        case .live: return .green
        case .active: return .blue
        }
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }
}

struct AgentMonitorMenuContent: View {
    @ObservedObject var state: AppState
    @ObservedObject var l10n = L10n.shared

    var body: some View {
        let snap = state.monitor.snapshot

        Section {
            HStack(spacing: 6) {
                StatusDot(state: snap.iconState)
                Text(snap.statusLine)
                    .font(.system(size: 12, weight: .medium))
            }
            Text(snap.lastEventLine)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Text(snap.countsLine)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            if let err = state.serverError {
                Text(err)
                    .font(.system(size: 10))
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }

        Divider()

        Button(l10n.t("menu.openPanel")) {
            state.openPanel()
        }
        .keyboardShortcut("o", modifiers: .command)

        Button(l10n.t("menu.installHooks")) {
            state.installHooks()
        }

        Toggle(l10n.t("menu.launchAtLogin"), isOn: Binding(
            get: { state.launchAtLogin },
            set: { state.setLaunchAtLogin($0) }
        ))

        Toggle(l10n.t("menu.language"), isOn: Binding(
            get: { l10n.lang == .zh },
            set: { _ in l10n.toggle() }
        ))

        Divider()

        Button(l10n.t("menu.quit")) {
            state.quit()
        }
        .keyboardShortcut("q", modifiers: .command)
    }
}

@main
struct AgentMonitorApp: App {
    @StateObject private var state = AppState.shared

    init() {
        NSApplication.shared.setActivationPolicy(.accessory)
    }

    var body: some Scene {
        MenuBarExtra {
            AgentMonitorMenuContent(state: state)
        } label: {
            Image(systemName: iconName(for: state.monitor.snapshot.iconState))
                .symbolRenderingMode(.hierarchical)
                // Start on the label, not the menu content: with .menu style the
                // content is only built when the user opens the menu, so wiring
                // start() there left the server (and file watcher) down until the
                // first click. The label is always present, so this fires at launch.
                .onAppear { state.start() }
        }
        .menuBarExtraStyle(.menu)
    }

    private func iconName(for state: MenuBarIconState) -> String {
        switch state {
        case .offline: return "eye.slash"
        case .idle: return "eye"
        case .live: return "eye.fill"
        case .active: return "bolt.horizontal.circle.fill"
        }
    }
}
