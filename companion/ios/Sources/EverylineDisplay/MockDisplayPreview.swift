// MockDisplayPreview.swift
//
// everyline — simulated glasses for the iOS Simulator.
//
// Boots Meta's MockDeviceKit, pairs a display-capable simulated glasses
// model, and hands back a preview view that renders exactly what the
// glasses would show. No physical glasses needed.
//
// Usage (in the host app, Debug builds only):
//   try Wearables.configure()
//   let harness = MockDisplayHarness()
//   harness.enable()
//   let preview = try await harness.pairDisplayGlasses()
//   myContainerView.addSubview(preview.view)
//   let display = try await DisplaySession().connect()  // normal API:
//   MetaDisplayRenderer().attach(display)               // mock or real
//
// Written against the Wearables DAT iOS SDK 1.0.0 MockDeviceKit API as
// documented in Meta's mockdevice-testing skill and the DisplayAccess
// sample. NOT compiled: there is no Xcode on the machine this was written
// on. Build it in Xcode before trusting it; fix what the compiler says.

import Foundation
import UIKit
import MWDATCore
import MWDATDisplay
import MWDATMockDevice

/// Errors from the mock harness.
enum MockDisplayError: Error {
    case deviceNotReady
}

/// Pairs a simulated display-capable glasses and exposes its preview.
@MainActor
final class MockDisplayHarness {
    private let mockDeviceKit = MockDeviceKit.shared
    private let wearables = Wearables.shared
    private var device: MockGlasses?

    /// Paired preview for one simulated glasses.
    struct Preview {
        /// Renders what the glasses would show. Add to your view hierarchy.
        let view: UIView
        let powerOn: () -> Void
        let don: () -> Void
        let unpair: () -> Void
    }

    /// Start from a registered, permissions-granted state.
    func enable() {
        mockDeviceKit.enable()
    }

    /// Pair `.metaRayBanDisplay`, wait until it is connected and
    /// compatible, power on, and don. Throws on timeout.
    func pairDisplayGlasses() async throws -> Preview {
        let glasses = try mockDeviceKit.pairGlasses(model: .metaRayBanDisplay)
        self.device = glasses
        try await waitUntilReady(glasses.deviceIdentifier)
        glasses.powerOn()
        glasses.don()
        let view = glasses.services.display.createPreviewView()
        return Preview(
            view: view,
            powerOn: glasses.powerOn,
            don: glasses.don,
            unpair: { [weak self] in
                guard let self, let device = self.device else { return }
                self.mockDeviceKit.unpairDevice(device)
                self.device = nil
            }
        )
    }

    func disable() {
        mockDeviceKit.disable()
        device = nil
    }

    // MARK: - Private

    private func waitUntilReady(_ id: DeviceIdentifier) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(10))
        while !isReady(id) {
            guard clock.now < deadline else { throw MockDisplayError.deviceNotReady }
            try await clock.sleep(for: .milliseconds(50))
        }
    }

    private func isReady(_ id: DeviceIdentifier) -> Bool {
        guard let device = wearables.deviceForIdentifier(id) else { return false }
        return device.linkState == .connected
            && device.compatibility() == .compatible
    }
}
