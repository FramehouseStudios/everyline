# everyline iOS display renderer

`Sources/EverylineDisplay/` holds the native glasses path for the companion:
`MetaDisplayRenderer.swift` draws cues on Meta Ray-Ban Display glasses
through the Wearables DAT Display capability, and `MockDisplayPreview.swift`
boots a simulated glasses for the iOS Simulator. Both implement the same
four-method contract as the PWA's `WebRenderer` (showCue / clear / setStatus
/ setLang), so the stream, clock, and player layers never know which
surface they are driving.

`Package.swift` makes this a Swift package: open it in Xcode and the DAT
SDK (1.0.0, from `facebook/meta-wearables-dat-ios`) resolves automatically.

## Build it

1. Open `companion/ios/Package.swift` in Xcode (File > Open).
2. Let Xcode resolve package dependencies (first open downloads the DAT SDK).
3. Select the `EverylineDisplay` scheme, pick an iOS Simulator, Product > Build.

This package was written and API-checked on a machine without Xcode
(every symbol verified against Meta's vendored SDK sources and the
DisplayAccess sample). It has never been compiled. The first Xcode build
is the source of truth; fix what the compiler says.

## Test it on the simulator (no glasses needed)

In a Debug host app:

```swift
try Wearables.configure()          // once at launch, with your MWDAT plist values
let harness = MockDisplayHarness() // @MainActor
harness.enable()
let preview = try await harness.pairDisplayGlasses()
previewContainer.addSubview(preview.view)   // renders what glasses would show

let display = try await DisplaySession().connect()
let renderer = MetaDisplayRenderer()
renderer.attach(display)
renderer.showCue("Did you hear that?", lang: "en")
```

What you should see in the preview view: the caption card with the cue
text. `clear()` empties the preview without stopping the session.

## Host app responsibilities (not in this package)

This package is the renderer and the session bootstrap only. The app that
embeds it must, per Meta's getting-started skill:

- Call `Wearables.configure()` once at launch.
- Set the `MWDAT` Info.plist values (`AppLinkURLScheme`, `MetaAppID`,
  `ClientToken`, `TeamID`; empty/zero keeps the SDK in Developer Mode).
- Declare the `CFBundleURLTypes` URL scheme and route app-open URLs to
  `Wearables.shared.handleUrl(_:)`.
- Set `UIBackgroundModes` (`processing`, `bluetooth-central`,
  `bluetooth-peripheral`, `external-accessory`),
  `UISupportedExternalAccessoryProtocols` (`com.meta.ar.wearable`), and
  `NSBluetoothAlwaysUsageDescription`.
- Reset the display session when registration changes to `.available` or
  `.unavailable` (observe `wearables.registrationStateStream()`).

## Licensing note

`Sources/` is MIT like the rest of everyline. It imports Meta's
proprietary DAT modules (`MWDATCore`, `MWDATDisplay`, `MWDATMockDevice`),
which are covered by the Meta Wearables Developer Terms, not by our license.
