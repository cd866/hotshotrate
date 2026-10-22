import SwiftUI

@main
struct BlackRamApp: App {
    var body: some Scene {
        WindowGroup {
            WebHostRepresentable()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
        }
    }
}

private struct WebHostRepresentable: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebHostController {
        WebHostController()
    }

    func updateUIViewController(_ controller: WebHostController, context: Context) {}
}
