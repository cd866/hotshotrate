import Foundation
import WebKit

/// Downloads the public reports feed outside the web view so GitHub Pages
/// CORS rules do not block a refresh. The bundled copy is the offline fallback.
final class FeedBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let liveFeedURL = URL(string: "https://cd866.github.io/hotshotrate/data/feed.json")!

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.name == "liveFeed" else {
            replyHandler(nil, "unsupported")
            return
        }

        var request = URLRequest(url: Self.liveFeedURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 20

        URLSession.shared.dataTask(with: request) { data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let text = data.flatMap { String(data: $0, encoding: .utf8) }
            let ok = error == nil && (200...299).contains(status) && text?.contains("\"months\"") == true
            DispatchQueue.main.async {
                if ok, let text {
                    replyHandler(text, nil)
                } else {
                    replyHandler(nil, "offline")
                }
            }
        }.resume()
    }
}
