import AppKit
import WebKit

@MainActor
final class PanelWindowController: NSWindowController {
    static let shared = PanelWindowController()

    private var webView: WKWebView?

    private init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Agent Monitor"
        window.center()
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        super.init(window: window)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func showPanel(url: URL) {
        guard let window else { return }

        if webView == nil {
            let config = WKWebViewConfiguration()
            config.preferences.setValue(true, forKey: "developerExtrasEnabled")
            let wv = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: config)
            wv.autoresizingMask = [.width, .height]
            window.contentView = wv
            webView = wv
        }

        if !window.isVisible {
            window.center()
        }
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)

        let current = webView?.url?.absoluteString ?? ""
        if current != url.absoluteString {
            webView?.load(URLRequest(url: url))
        }
    }

    func reloadIfVisible(url: URL) {
        guard window?.isVisible == true else { return }
        webView?.load(URLRequest(url: url))
    }
}
