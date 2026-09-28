// MetaDisplayRenderer.swift
//
// everyline — the Meta Wearables display renderer.
//
// Implements the same four-method contract as the companion's WebRenderer
// (showCue / clear / setStatus / setLang), but draws on the glasses through
// the Wearables Device Access Toolkit's Display capability instead of the DOM.
//
// Written against the Wearables DAT iOS SDK 0.7.0 Display capability API as
// documented in Meta's own display-access skill and the DisplayAccess sample
// app (see research/meta-display-sdk.md). NOT compiled: there is no Xcode on
// the machine this was written on. Build it in Xcode against the DAT SDK
// before trusting it; fix what the compiler says.
//
// API notes (all from Meta's public material):
// - Each display.send(_:) REPLACES the previous screen content, so caption
//   updates are just re-sends. We only send on cue boundaries, never per tick.
// - The root view of a send must be a FlexBox (UI) or VideoPlayer (video);
//   never a bare Text.
// - Wait for DisplayState.started on display.statePublisher before sending
//   user content; keep the listener token alive.
// - SwiftUI name clash: the DSL's Text/Button/Image live in MWDATDisplay,
//   so qualify them when SwiftUI is imported in the same file.
//
// This file is MIT like the rest of everyline. It imports Meta's proprietary
// DAT modules (MWDATCore, MWDATDisplay), which are covered by the Meta
// Wearables Developer Terms, not by our license.

import Foundation
import MWDATCore
import MWDATDisplay

// MARK: - Session bootstrap

/// Owns the DAT session + Display capability for one pair of glasses.
/// Mirrors the DisplayAccess sample's lifecycle: select a display-capable
/// device, start the session, addDisplay(), wait for .started.
@MainActor
final class DisplaySession {
    enum ConnectError: Error { case noSession }

    private let wearables = Wearables.shared
    private var deviceSession: DeviceSession?
    private var display: Display?
    private var stateToken: Any?

    /// Connect and return a ready Display. Throws DeviceSessionError.
    func connect() async throws -> Display {
        let selector = AutoDeviceSelector(
            wearables: wearables,
            filter: { $0.supportsDisplay() }
        )
        let session = try wearables.createSession(deviceSelector: selector)
        self.deviceSession = session
        try session.start()
        for await state in session.stateStream() {
            if state == .started { break }
        }
        let capability = try session.addDisplay()
        self.display = capability
        // Wait for the display itself to report .started before sending.
        let ready = AsyncStream<DisplayState>.makeStream()
        stateToken = capability.statePublisher.listen { state in
            if state == .started { ready.continuation.yield(state) }
        }
        for await _ in ready.stream { break }
        capability.start()
        return capability
    }

    func disconnect() async {
        display?.stop()
        deviceSession?.stop()
        display = nil
        deviceSession = nil
        stateToken = nil
    }
}

// MARK: - Renderer

/// Draws everyline cues on the glasses. Same contract as WebRenderer:
/// showCue(cue) / clear() / setStatus(...) / setLang(lang).
@MainActor
final class MetaDisplayRenderer {
    private var display: Display?
    private var lastSentText: String?

    func attach(_ display: Display) {
        self.display = display
    }

    /// Show one caption cue. Sends a full-screen replacement view; only
    /// sends when the text actually changed (cue boundaries, not ticks).
    func showCue(_ text: String, lang: String) {
        guard text != lastSentText else { return }
        lastSentText = text
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

    /// Clear the caption line without stopping the Display capability.
    func clear() {
        lastSentText = nil
        display?.clearDisplay()
    }

    /// Status line (connecting / live / reconnecting / source badge).
    /// Cues arrive pre-localized, so this is display-only chrome.
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

    /// No-op by design: cues arrive pre-localized per language track,
    /// exactly like the WebRenderer contract documents.
    func setLang(_ lang: String) {}
}
