import Foundation
import WebKit

/// Downloads the public reports feed outside the web view so GitHub Pages
/// CORS rules do not block a refresh. The bundled copy is the offline fallback.
///
/// Uses the original WKScriptMessageHandler API. The reply-handler registration
/// call is not available under the same name on current Xcode.
final class FeedBridge: NSObject, WKScriptMessageHandler {
    static let liveFeedURL = URL(string: "https://cd866.github.io/hotshotrate/data/feed.json")!

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "liveFeed" else { return }
        let body = message.body as? [String: Any]
        let id = body?["id"] as? String ?? ""
        guard !id.isEmpty else { return }
        let webView = message.webView

        var request = URLRequest(url: Self.liveFeedURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 20

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = data.flatMap { String(data: $0, encoding: .utf8) }
            let ok = error == nil && (200...299).contains(status) && text?.contains("\"months\"") == true
            DispatchQueue.main.async {
                guard let self else { return }
                if ok, let text {
                    self.deliver(to: webView, id: id, ok: true, body: text)
                } else {
                    self.deliver(to: webView, id: id, ok: false, body: "")
                }
            }
        }.resume()
    }

    private func deliver(to webView: WKWebView?, id: String, ok: Bool, body: String) {
        guard let webView,
              let idLiteral = Self.jsStringLiteral(id),
              let bodyLiteral = Self.jsStringLiteral(body) else { return }
        let flag = ok ? "true" : "false"
        let script = """
        (function () {
          var wait = window.__blackRamFeedWait;
          if (!wait) return;
          var fn = wait[\(idLiteral)];
          if (!fn) return;
          delete wait[\(idLiteral)];
          fn(\(flag), \(bodyLiteral));
        })();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    /// JSON string literal, including the surrounding quotes.
    private static func jsStringLiteral(_ value: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              var text = String(data: data, encoding: .utf8),
              text.first == "[", text.last == "]" else { return nil }
        text.removeFirst()
        text.removeLast()
        return text
    }
}
