import SwiftUI

// MARK: - Main View

struct ContentView: View {
    @StateObject private var ble = BLEManager()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            background
            VStack(spacing: 0) {
                header
                if ble.isConnected {
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 18) {
                            filterCard
                            volumeCard
                            gainCard
                            muteCard
                        }
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                    }
                } else {
                    disconnectedView
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: Background

    private var background: some View {
        LinearGradient(
            colors: [Color(hex: "0D0D1A"), Color(hex: "111827")],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("PYNQ Audio")
                        .font(.system(size: 26, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(ble.isConnected ? Color(hex: "22C55E") : Color(hex: "EF4444"))
                            .frame(width: 7, height: 7)
                            .shadow(color: ble.isConnected ? Color(hex: "22C55E") : .clear, radius: 4)
                        Text(ble.statusMessage)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    .animation(.easeInOut(duration: 0.3), value: ble.isConnected)
                }
                Spacer()
                connectBtn
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 14)

            Divider().background(Color.white.opacity(0.08))
        }
    }

    private var connectBtn: some View {
        Button {
            if ble.isConnected { ble.disconnect() }
            else if !ble.isScanning { ble.startScan() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: ble.isConnected ? "bluetooth.slash" :
                      ble.isScanning ? "antenna.radiowaves.left.and.right" : "bluetooth")
                    .font(.system(size: 12, weight: .semibold))
                Text(ble.isConnected ? "Disconnect" : ble.isScanning ? "Scanning…" : "Connect")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(ble.isConnected ? Color(hex: "EF4444") : Color(hex: "3B82F6"))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill((ble.isConnected ? Color(hex: "EF4444") : Color(hex: "3B82F6")).opacity(0.12))
            )
            .overlay(
                Capsule()
                    .strokeBorder((ble.isConnected ? Color(hex: "EF4444") : Color(hex: "3B82F6")).opacity(0.35), lineWidth: 1)
            )
        }
        .disabled(ble.isScanning)
        .animation(.easeInOut(duration: 0.2), value: ble.isConnected)
    }

    // MARK: Disconnected placeholder

    private var disconnectedView: some View {
        VStack(spacing: 20) {
            Spacer()
            ZStack {
                Circle()
                    .fill(Color(hex: "3B82F6").opacity(0.08))
                    .frame(width: 110, height: 110)
                Circle()
                    .fill(Color(hex: "3B82F6").opacity(0.05))
                    .frame(width: 150, height: 150)
                Image(systemName: "waveform.badge.mic")
                    .font(.system(size: 44))
                    .foregroundStyle(Color(hex: "3B82F6").opacity(0.6))
            }
            Text("No Device Connected")
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.8))
            Text("Tap Connect to pair with your\nPYNQ-Z2 audio processor")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.35))
                .multilineTextAlignment(.center)
            Spacer()
        }
    }

    // MARK: Filter Card

    private var filterCard: some View {
        DSPCard(title: "Filter", icon: "waveform.path.ecg") {
            HStack(spacing: 12) {
                FilterChip(
                    label: "Bypass",
                    sublabel: "No filter",
                    icon: "waveform",
                    selected: !ble.filterActive,
                    accent: Color(hex: "6B7280")
                ) { ble.setFilter(false) }

                FilterChip(
                    label: "Chebyshev II",
                    sublabel: "Low-pass IIR",
                    icon: "waveform.path",
                    selected: ble.filterActive,
                    accent: Color(hex: "3B82F6")
                ) { ble.setFilter(true) }
            }
        }
    }

    // MARK: Volume Card

    private var volumeCard: some View {
        DSPCard(title: "Volume", icon: "speaker.wave.2") {
            VStack(spacing: 14) {
                HStack {
                    Text("\(Int(ble.volume))%")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .monospacedDigit()
                    Spacer()
                    if ble.isMuted {
                        Label("Muted", systemImage: "speaker.slash.fill")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color(hex: "F59E0B"))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color(hex: "F59E0B").opacity(0.12))
                            .clipShape(Capsule())
                    }
                }

                AudioSlider(value: $ble.volume, range: 0...100) { ended in
                    if ended { ble.setVolume(Int(ble.volume)) }
                }

                HStack {
                    Image(systemName: "speaker").foregroundStyle(.white.opacity(0.3))
                    Spacer()
                    Image(systemName: "speaker.wave.3").foregroundStyle(.white.opacity(0.3))
                }
                .font(.system(size: 12))
            }
        }
    }

    // MARK: Gain Card

    private var gainCard: some View {
        DSPCard(title: "Gain", icon: "dial.medium") {
            HStack(spacing: 14) {
                GainControl(label: "Filter Gain", accent: Color(hex: "A855F7"),
                            onUp: { ble.filterGainUp() },
                            onDown: { ble.filterGainDown() })
                GainControl(label: "Master Gain", accent: Color(hex: "F97316"),
                            onUp: { ble.masterGainUp() },
                            onDown: { ble.masterGainDown() })
            }
        }
    }

    // MARK: Mute Card

    private var muteCard: some View {
        Button { ble.toggleMute() } label: {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill((ble.isMuted ? Color(hex: "F59E0B") : Color(hex: "6B7280")).opacity(0.15))
                        .frame(width: 48, height: 48)
                    Image(systemName: ble.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(ble.isMuted ? Color(hex: "F59E0B") : .white.opacity(0.5))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(ble.isMuted ? "Unmute Audio" : "Mute Audio")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(ble.isMuted ? "Tap to restore audio output" : "Tap to silence output")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.4))
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.2))
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(Color.white.opacity(0.04))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .strokeBorder(
                                (ble.isMuted ? Color(hex: "F59E0B") : Color.white).opacity(0.08),
                                lineWidth: 1
                            )
                    )
            )
        }
        .animation(.easeInOut(duration: 0.2), value: ble.isMuted)
    }
}

// MARK: - DSP Card Container

struct DSPCard<Content: View>: View {
    let title:   String
    let icon:    String
    let content: Content

    init(title: String, icon: String, @ViewBuilder content: () -> Content) {
        self.title   = title
        self.icon    = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.5))
                Text(title.uppercased())
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.4))
                    .tracking(1.2)
            }
            content
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.white.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(Color.white.opacity(0.07), lineWidth: 1)
                )
        )
    }
}

// MARK: - Filter Chip

struct FilterChip: View {
    let label:    String
    let sublabel: String
    let icon:     String
    let selected: Bool
    let accent:   Color
    let action:   () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(accent.opacity(selected ? 0.2 : 0.06))
                        .frame(width: 52, height: 52)
                    Image(systemName: icon)
                        .font(.system(size: 22))
                        .foregroundStyle(selected ? accent : .white.opacity(0.3))
                }
                VStack(spacing: 3) {
                    Text(label)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(selected ? .white : .white.opacity(0.4))
                    Text(sublabel)
                        .font(.system(size: 11))
                        .foregroundStyle(selected ? accent.opacity(0.8) : .white.opacity(0.25))
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(accent.opacity(selected ? 0.08 : 0.0))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(accent.opacity(selected ? 0.5 : 0.12), lineWidth: 1.5)
                    )
            )
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: selected)
    }
}

// MARK: - Audio Slider

struct AudioSlider: View {
    @Binding var value: Double
    let range:    ClosedRange<Double>
    let onChange: (Bool) -> Void

    @State private var isDragging = false

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let pct = CGFloat((value - range.lowerBound) / (range.upperBound - range.lowerBound))
            let fillW = pct * w

            ZStack(alignment: .leading) {
                // Track
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(0.08))
                    .frame(height: 6)

                // Fill
                RoundedRectangle(cornerRadius: 6)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "3B82F6"), Color(hex: "60A5FA")],
                            startPoint: .leading, endPoint: .trailing
                        )
                    )
                    .frame(width: fillW, height: 6)

                // Thumb
                Circle()
                    .fill(.white)
                    .frame(width: isDragging ? 26 : 22, height: isDragging ? 26 : 22)
                    .shadow(color: Color(hex: "3B82F6").opacity(0.6), radius: isDragging ? 8 : 4)
                    .offset(x: fillW - (isDragging ? 13 : 11))
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        isDragging = true
                        let raw = v.location.x / w
                        let clamped = max(0, min(1, raw))
                        value = range.lowerBound + clamped * (range.upperBound - range.lowerBound)
                        onChange(false)
                    }
                    .onEnded { _ in
                        isDragging = false
                        onChange(true)
                    }
            )
        }
        .frame(height: 26)
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isDragging)
    }
}

// MARK: - Gain Control

struct GainControl: View {
    let label:  String
    let accent: Color
    let onUp:   () -> Void
    let onDown: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(accent.opacity(0.7))
                .tracking(0.8)

            Button(action: onUp) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(accent.opacity(0.12))
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(accent)
                }
                .frame(height: 48)
            }
            .buttonStyle(ScaleButtonStyle())

            Button(action: onDown) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(accent.opacity(0.07))
                    Image(systemName: "minus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(accent.opacity(0.7))
                }
                .frame(height: 48)
            }
            .buttonStyle(ScaleButtonStyle())
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Scale Button Style

struct ScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1.0)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - Color Helper

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: h).scanHexInt64(&int)
        let r = Double((int >> 16) & 0xFF) / 255
        let g = Double((int >>  8) & 0xFF) / 255
        let b = Double( int        & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}

#Preview {
    ContentView()
}
