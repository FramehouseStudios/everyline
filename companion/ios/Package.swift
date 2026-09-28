// swift-tools-version: 5.9
// EverylineDisplay — the Meta Wearables display renderer as a Swift package.
//
// Open this file in Xcode (File > Open > Package.swift). Xcode resolves the
// Wearables DAT SDK from Meta's Swift package feed and builds the target.
// The SDK is proprietary (Meta Wearables Developer Terms); this package's
// own sources stay MIT.

import PackageDescription

let package = Package(
    name: "EverylineDisplay",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "EverylineDisplay",
            targets: ["EverylineDisplay"]
        ),
    ],
    dependencies: [
        .package(
            url: "https://github.com/facebook/meta-wearables-dat-ios",
            from: "1.0.0"
        ),
    ],
    targets: [
        .target(
            name: "EverylineDisplay",
            dependencies: [
                .product(name: "MWDATCore", package: "meta-wearables-dat-ios"),
                .product(name: "MWDATDisplay", package: "meta-wearables-dat-ios"),
                .product(name: "MWDATMockDevice", package: "meta-wearables-dat-ios"),
            ]
        ),
    ]
)
