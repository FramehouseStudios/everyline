# Meta Wearables DAT — Display API research (2026-09-28)

Source: `research/vendor/meta-wearables-dat-ios` (shallow clone of
https://github.com/facebook/meta-wearables-dat-ios, .git stripped).
SDK version in repo: 0.7.0 (2026-05-14) added the Display capability;
Wearables DAT 1.0 stable rolls out Sep 30, 2026.
License: Meta Wearables Developer Terms (proprietary developer terms, not OSI open source).

## The Display API surface (iOS, MWDATDisplay)

Modules: `MWDATCore` (always) + `MWDATDisplay` (display) + `MWDATMockDevice` (testing).
SPM: `https://github.com/facebook/meta-wearables-dat-ios`.

Lifecycle (from `plugins/mwdat-ios/skills/display-access/SKILL.md` and
`samples/DisplayAccess/DisplayAccess/ViewModels/DisplayViewModel.swift`):

```swift
import MWDATCore
import MWDATDisplay

// 1. Select a display-capable device
let selector = AutoDeviceSelector(
  wearables: Wearables.shared,
  filter: { $0.supportsDisplay() }
)

// 2. Session
let session = try Wearables.shared.createSession(deviceSelector: selector)
try session.start()
// wait for session.stateStream() to yield .started
// observe session.errorStream() for async failures

// 3. Attach Display (DisplayViewModel.swift:28,244)
let display: Display = try session.addDisplay()   // throws(DeviceSessionError)
displayStateToken = display.statePublisher.listen { state in
  // wait for DisplayState.started
}
display.start()

// 4. Send one root view per call; each send REPLACES the previous content
try await display.send(
  FlexBox(direction: .column, spacing: 12) {
    Text("cue text here", style: .body)
  }
  .padding(24)
  .background(.card)
)

// 5. Clear / tear down
display.clearDisplay()   // remove content without stopping Display
display.stop()
session.stop()
```

Key signatures:
- `DeviceSession.addDisplay() throws(DeviceSessionError) -> Display` (DisplayViewModel.swift:28)
- `display.send(_ view: DisplayableView) async throws` — root must be `FlexBox` (UI) or `VideoPlayer` (video); never bare `Text`/`Button`/`Image`/`Icon`
- `display.clearDisplay()`, `display.sendVideoStop()`, `display.start()`, `display.stop()`
- `display.statePublisher` → `DisplayState` (`.started` before sending user content)
- `display.onPlaybackEvent` for video events
- Views: `FlexBox(direction:spacing:alignment:crossAlignment:wrap:)`, `Text(_:style:color:)`, `Button(label:style:iconName:onClick:)`, `ButtonGroup`, `Image(uri:sizePreset:cornerRadius:)` / `Image(image:...)`, `Icon(name:style:)`, `VideoPlayer(provider:.uri(_:), codec:.mp4, onError:)`
- Styles: `TextStyle` cases seen: `.heading`, `.body`, `.meta`; `TextColor`: `.secondary`; `Background`: `.card`; modifiers `.padding(_:)`, `.background(_:)`, `.onTap(_:)`, `.flexGrow/.flexShrink/.alignSelf`
- SwiftUI name clash: qualify as `MWDATDisplay.Text` etc. if SwiftUI is imported in the same file
- Errors: `DeviceSessionError.datAppOnTheGlassesUpdateRequired` → offer `Wearables.shared.openDATGlassesAppUpdate()`

Threading: Swift async/await; session state via `AsyncStream` (`stateStream()`, `errorStream()`); display state via `statePublisher` listener tokens (keep tokens alive). Sample ViewModel is `@MainActor`.

Android (from CHANGELOG, not cloned): `mwdat-display` artifact; `DeviceSession.addDisplay(config)` / `removeDisplay()`; `Display.sendContent { ... }` declarative builder with `flexBox`, `text`, `icon`, `image`, `button` + styling primitives (`Direction`, `Alignment`, `TextColor`, `TextStyle`, ...). DAM manifest meta-data required: `<meta-data android:name="com.meta.wearable.mwdat.DAM_ENABLED" android:value="true" />`.

## Caption-line sketch (Swift, real idiom)

```swift
@MainActor
final class MetaDisplayRenderer {
  private var display: Display?

  func attach(_ display: Display) { self.display = display }

  func showCue(_ text: String, lang: String) {
    Task {
      try? await display?.send(
        FlexBox(direction: .column, spacing: 8) {
          MWDATDisplay.Text(text, style: .body)
        }
        .padding(24)
        .background(.card)
      )
    }
  }

  func clear() {
    Task { try? await display?.clearDisplay() }
  }

  func setStatus(_ status: String) {
    Task {
      try? await display?.send(
        FlexBox(direction: .column, spacing: 8) {
          MWDATDisplay.Text(status, style: .meta, color: .secondary)
        }
        .padding(24)
      )
    }
  }

  func setLang(_ lang: String) { /* no-op: cues arrive pre-localized */ }
}
```

Note: each `send` replaces the whole screen, so caption updates are just
re-sends — matches our CuePlayer tick model (derive visible cue → send).
Debounce to cue boundaries; do not send per tick.

## Pairing / auth model (what's public vs gated)

Public today (no approval):
- SDK via SPM, MockDeviceKit (simulated display incl. `createPreviewView()`), Developer Mode on the glasses (Meta AI app → Settings → Your glasses → Developer Mode), `MetaAppID` empty/`0` skips attestation in dev.
- Sample apps: `samples/DisplayAccess` (full flow), `samples/CameraAccess`.

Requires Wearables Developer Center project + approval path:
- Production `MetaAppID` + `ClientToken` in Info.plist `MWDAT` dict, Apple Team ID, URL-scheme callback wired to `Wearables.shared.handleUrl(_:)`.
- Registration flow: `Wearables.shared.startRegistration()`, observe `registrationStateStream()`.
- Distribution is invite-gated: create a release channel in the dev center, add tester emails, testers accept at `wearables.meta.com/invites`. (Per issue #180: fresh projects can hit `datAppOnTheGlassesUpdateRequired` with no recovery path — real-world friction in May 2026.)
- Publishing to glasses users is partner/invite-gated; web apps framework separately publishes via invite too.

## Alternative: Web Apps path (no native app)

The companion is already a PWA — it can render ON the glasses directly as a
Meta web app, no Swift/Kotlin needed:
`fb-viewapp://web_app_deep_link?appName=everyline&appUrl=https%3A%2F%2F<hosted-companion>%2F`
600x600 display, HTML/CSS/JS, QR install from the paired phone. Requires
glasses firmware v125+ and Meta AI app v272+. Sample toolkit:
https://github.com/facebook/meta-ray-ban-display-ui-toolkit-web (MIT-licensed
samples; not cloned here). Caveat: web app runs on the glasses, so the cue
stream WebSocket must be reachable from the glasses (same LAN WiFi) — fine in
a theater, trickier at home behind NAT.
