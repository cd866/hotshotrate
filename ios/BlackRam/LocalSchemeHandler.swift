import Foundation
import WebKit

/// Serves the bundled website on blackram://localhost so the calculator, fonts,
/// and last shipped feed work with no network. fetch() needs a real response,
/// which file:// URLs do not give inside WKWebView.
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {
    private let lock = NSLock()
    private var stopped: Set<ObjectIdentifier> = []

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            fail(urlSchemeTask, URLError(.badURL))
            return
        }

        guard let fileURL = fileURL(for: requestURL) else {
            respond(urlSchemeTask, status: 404, body: Data("Not found".utf8), mime: "text/plain")
            return
        }

        guard let body = try? Data(contentsOf: fileURL, options: [.mappedIfSafe]) else {
            #if DEBUG
            print("Black Ram missing \(fileURL.path)")
            #endif
            respond(urlSchemeTask, status: 404, body: Data("Not found".utf8), mime: "text/plain")
            return
        }

        respond(urlSchemeTask, status: 200, body: body, mime: mimeType(for: fileURL))
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        lock.lock()
        stopped.insert(ObjectIdentifier(urlSchemeTask as AnyObject))
        lock.unlock()
    }

    private func fileURL(for requestURL: URL) -> URL? {
        let root = Bundle.main.bundleURL
            .appendingPathComponent("www", isDirectory: true)
            .standardizedFileURL
        var path = requestURL.path.removingPercentEncoding ?? requestURL.path
        if path.isEmpty || path == "/" {
            path = "/index.html"
        }
        if path.hasPrefix("/") {
            path.removeFirst()
        }
        if path.hasSuffix("/") {
            path += "index.html"
        }

        var url = root
        for part in path.split(separator: "/") {
            let piece = String(part)
            if piece == "." || piece == ".." || piece.isEmpty {
                return nil
            }
            url.appendPathComponent(piece)
        }
        url = url.standardizedFileURL

        let rootPath = root.path.hasSuffix("/") ? root.path : root.path + "/"
        guard url.path == root.path || url.path.hasPrefix(rootPath) else {
            return nil
        }

        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue {
            url.appendPathComponent("index.html")
        }
        return url
    }

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html":
            return "text/html; charset=utf-8"
        case "css":
            return "text/css; charset=utf-8"
        case "js":
            return "text/javascript; charset=utf-8"
        case "json":
            return "application/json"
        case "webmanifest":
            return "application/manifest+json"
        case "svg":
            return "image/svg+xml"
        case "png":
            return "image/png"
        case "ico":
            return "image/x-icon"
        case "woff2":
            return "font/woff2"
        case "txt":
            return "text/plain; charset=utf-8"
        default:
            return "application/octet-stream"
        }
    }

    private func isStopped(_ task: WKURLSchemeTask) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped.contains(ObjectIdentifier(task as AnyObject))
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, body: Data, mime: String) {
        guard !isStopped(task), let url = task.request.url else { return }
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(body.count),
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            return
        }
        guard !isStopped(task) else { return }
        task.didReceive(response)
        guard !isStopped(task) else { return }
        task.didReceive(body)
        guard !isStopped(task) else { return }
        task.didFinish()
    }

    private func fail(_ task: WKURLSchemeTask, _ error: Error) {
        guard !isStopped(task) else { return }
        task.didFailWithError(error)
    }
}
