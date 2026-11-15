// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Pigeon",
    platforms: [.macOS(.v14)],
    dependencies: [
        // 原生刘海面板，单独一个包（mac/Notch）
        .package(path: "Notch")
    ],
    targets: [
        .executableTarget(name: "Pigeon", dependencies: [.product(name: "PigeonNotch", package: "Notch")], path: "Sources/Pigeon"),
        .testTarget(name: "PigeonTests", dependencies: ["Pigeon"], path: "Tests/PigeonTests"),
    ]
)
