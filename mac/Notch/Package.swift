// swift-tools-version: 6.0
import PackageDescription

// 原生刘海面板。单独一个包：只依赖 AppKit 和 SwiftUI，不认识本机服务，数据由应用喂进来。
// PigeonNotchDemo 用内置的示例数据把面板跑起来，不用开整个应用。
let package = Package(
    name: "PigeonNotch",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "PigeonNotch", targets: ["PigeonNotch"])
    ],
    targets: [
        .target(name: "PigeonNotch", path: "Sources/PigeonNotch"),
        .executableTarget(name: "PigeonNotchDemo", dependencies: ["PigeonNotch"], path: "Sources/PigeonNotchDemo"),
        .testTarget(name: "PigeonNotchTests", dependencies: ["PigeonNotch"], path: "Tests/PigeonNotchTests"),
    ]
)
