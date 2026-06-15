import SwiftUI

struct ContentView: View {
    @StateObject private var ble = BLEManager()

    private let ledColors: [Color] = [.yellow, .green, .blue, .red]
    private let ledNames  = ["LED 1", "LED 2", "LED 3", "LED 4"]

    var body: some View {
        NavigationView {
            VStack(spacing: 32) {
                statusBar
                connectButton
                Divider()
                ledGrid
                Spacer()
            }
            .padding()
            .navigationTitle("PYNQ Controller")
        }
    }

    // MARK: - Subviews

    private var statusBar: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(ble.isConnected ? Color.green : Color.red)
                .frame(width: 10, height: 10)
                .shadow(color: ble.isConnected ? .green : .red, radius: 4)
            Text(ble.statusMessage)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .animation(.easeInOut(duration: 0.3), value: ble.isConnected)
    }

    private var connectButton: some View {
        Button {
            if ble.isConnected {
                ble.disconnect()
            } else if !ble.isScanning {
                ble.startScan()
            }
        } label: {
            Label(
                ble.isConnected ? "Disconnect"
                    : ble.isScanning ? "Scanning…"
                    : "Connect to PYNQ",
                systemImage: ble.isConnected ? "bluetooth.slash"
                    : ble.isScanning ? "antenna.radiowaves.left.and.right"
                    : "bluetooth"
            )
            .frame(maxWidth: .infinity)
            .padding()
        }
        .buttonStyle(.borderedProminent)
        .tint(ble.isConnected ? .red : .blue)
        .disabled(ble.isScanning)
    }

    private var ledGrid: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("LED Control")
                .font(.headline)

            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible())],
                spacing: 16
            ) {
                ForEach(0..<4, id: \.self) { i in
                    LEDButton(
                        name:      ledNames[i],
                        color:     ledColors[i],
                        isOn:      ble.ledStates[i],
                        isEnabled: ble.isConnected
                    ) {
                        ble.toggleLED(i)
                    }
                }
            }
        }
    }
}

// MARK: - LED Button Component

struct LEDButton: View {
    let name:      String
    let color:     Color
    let isOn:      Bool
    let isEnabled: Bool
    let action:    () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 12) {
                Image(systemName: isOn ? "lightbulb.fill" : "lightbulb")
                    .font(.system(size: 44))
                    .foregroundStyle(isOn ? color : .gray.opacity(0.5))
                    .shadow(color: isOn ? color.opacity(0.6) : .clear, radius: 8)
                Text(name)
                    .font(.callout.bold())
                    .foregroundStyle(isOn ? .primary : .secondary)
                Text(isOn ? "ON" : "OFF")
                    .font(.caption)
                    .foregroundStyle(isOn ? color : .secondary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 130)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(isOn ? color.opacity(0.15) : Color(.systemGray6))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(isOn ? color.opacity(0.6) : .clear, lineWidth: 1.5)
            )
        }
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1.0 : 0.5)
        .animation(.easeInOut(duration: 0.2), value: isOn)
    }
}

#Preview {
    ContentView()
}
