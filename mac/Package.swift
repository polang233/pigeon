// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Pigeon",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "Pigeon", path: "Sources/Pigeon")
    ]
)
