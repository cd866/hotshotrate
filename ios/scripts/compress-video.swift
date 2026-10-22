import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 4 else {
    fputs("usage: compress-video input output preset\n", stderr)
    exit(2)
}

let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
let preset = args[3]
let asset = AVURLAsset(url: input)
guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
    fputs("could not open export session\n", stderr)
    exit(1)
}

try? FileManager.default.removeItem(at: output)
session.outputURL = output
session.outputFileType = .mp4
session.shouldOptimizeForNetworkUse = true

let group = DispatchGroup()
group.enter()
session.exportAsynchronously {
    group.leave()
}
group.wait()

if session.status != .completed {
    let detail = session.error?.localizedDescription ?? "unknown"
    fputs("export failed: \(detail)\n", stderr)
    exit(1)
}
