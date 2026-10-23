// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Meerkat",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "Meerkat", path: "Sources/Meerkat")
    ]
)
