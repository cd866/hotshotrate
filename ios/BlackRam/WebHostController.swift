import UIKit
import WebKit

enum BrandColor {
    /// #0E0E10, the same black as the website and the launch screen.
    static let background = UIColor(red: 14.0 / 255.0, green: 14.0 / 255.0, blue: 16.0 / 255.0, alpha: 1)
}

final class WebHostController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let schemeHandler: LocalSchemeHandler
    private let feedBridge: FeedBridge
    private let webView: WKWebView

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    /// Runs before the page scripts. The public site never sees this object.
    static let bootstrapScript = """
    (function () {
      document.documentElement.classList.add('native-app');
      window.BlackRamNative = {
        fetchLiveFeed: function () {
          var bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.liveFeed;
          if (!bridge || typeof bridge.postMessage !== 'function') {
            return Promise.reject(new Error('missing bridge'));
          }
          var result = bridge.postMessage({});
          if (!result || typeof result.then !== 'function') {
            return Promise.reject(new Error('bridge'));
          }
          return result.then(function (text) {
            if (typeof text !== 'string') throw new Error('bad feed');
            return JSON.parse(text);
          });
        }
      };
    })();
    """

    init() {
        let schemeHandler = LocalSchemeHandler()
        let feedBridge = FeedBridge()
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "blackram")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.dataDetectorTypes = WKDataDetectorTypes()

        let userContent = WKUserContentController()
        userContent.addUserScript(WKUserScript(
            source: WebHostController.bootstrapScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        userContent.add(feedBridge, contentWorld: .page, name: "liveFeed")
        configuration.userContentController = userContent

        let webView = WKWebView(frame: .zero, configuration: configuration)
        self.schemeHandler = schemeHandler
        self.feedBridge = feedBridge
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "liveFeed", contentWorld: .page)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = BrandColor.background
        _ = schemeHandler
        _ = feedBridge

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = true
        webView.backgroundColor = BrandColor.background
        webView.underPageBackgroundColor = BrandColor.background
        webView.scrollView.backgroundColor = BrandColor.background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webView.scrollView.contentInset = .zero
        webView.scrollView.indicatorStyle = .white
        webView.scrollView.bounces = true
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.bouncesZoom = false
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        if let url = URL(string: "blackram://localhost/index.html") {
            webView.load(URLRequest(url: url))
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        view.window?.overrideUserInterfaceStyle = .dark
        view.window?.backgroundColor = BrandColor.background
        setNeedsStatusBarAppearanceUpdate()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "blackram" {
            decisionHandler(.allow)
            return
        }
        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" {
            UIApplication.shared.open(url)
        }
        return nil
    }
}
