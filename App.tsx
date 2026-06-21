/**
 * PYNQ Audio Controller
 * Professional iOS DSP controller for PYNQ-Z2 / ADAU1761
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  SafeAreaView, Alert, FlatList, PanResponder, Dimensions,
  Animated, ScrollView, LayoutChangeEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { BleManager, Device } from 'react-native-ble-plx';
import { StatusBar } from 'expo-status-bar';

// ─── Design System ─────────────────────────────────────────────────────────────

const C = {
  // Exact iOS 17 dark mode system colors
  bg:         '#000000',
  bg2:        '#1C1C1E',
  bg3:        '#2C2C2E',
  sep:        '#38383A',
  label:      '#FFFFFF',
  label2:     '#8E8E93',
  label3:     '#48484A',
  label4:     '#3A3A3C',
  blue:       '#0A84FF',
  green:      '#30D158',
  orange:     '#FF9F0A',
  purple:     '#BF5AF2',
  red:        '#FF453A',
  indigo:     '#5E5CE6',
  teal:       '#40CBE0',
};

// iOS HIG typography scale
const T = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing:  0.37, color: C.label },
  title2:     { fontSize: 22, fontWeight: '700', letterSpacing:  0.35, color: C.label },
  headline:   { fontSize: 17, fontWeight: '600', letterSpacing: -0.41, color: C.label },
  body:       { fontSize: 17, fontWeight: '400', letterSpacing: -0.41, color: C.label },
  callout:    { fontSize: 16, fontWeight: '400', letterSpacing: -0.32, color: C.label },
  subhead:    { fontSize: 15, fontWeight: '400', letterSpacing: -0.24, color: C.label },
  footnote:   { fontSize: 13, fontWeight: '400', letterSpacing: -0.08, color: C.label },
  caption1:   { fontSize: 12, fontWeight: '400', letterSpacing:  0.00, color: C.label },
  caption2:   { fontSize: 11, fontWeight: '400', letterSpacing:  0.07, color: C.label },
});

const BLE_SERVICE = '12345678-1234-1234-1234-123456789abc';
const BLE_CHAR    = 'abcd1234-ab12-ab12-ab12-abcdef123456';

// ─── Waveform Visualizer ───────────────────────────────────────────────────────

const BAR_COUNT = 36;
// Pre-compute phase for each bar so animation targets are deterministic
const BAR_PHASES = Array.from({ length: BAR_COUNT }, (_, i) => (i / BAR_COUNT) * Math.PI * 4);

function WaveformVisualizer({ active, muted }: { active: boolean; muted: boolean }) {
  const heights = useRef(BAR_PHASES.map(() => new Animated.Value(3))).current;
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    loopsRef.current.forEach(a => a.stop());
    loopsRef.current = [];

    heights.forEach((h, i) => {
      const phase = BAR_PHASES[i];
      let hi: number, lo: number, dur: number;

      if (muted) {
        hi = 3; lo = 2; dur = 1500;
      } else if (active) {
        // Chebyshev envelope: raised in passband, attenuated towards stopband
        const env = Math.pow(Math.abs(Math.sin(phase * 0.5)), 0.6);
        hi  = 10 + env * 30;
        lo  = 4  + env * 8;
        dur = 160 + (i % 7) * 18;
      } else {
        // Bypass: low, gentle waves
        hi  = 6 + Math.abs(Math.sin(phase)) * 12;
        lo  = 3 + Math.abs(Math.sin(phase)) * 3;
        dur = 480 + (i % 5) * 70;
      }

      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(h, { toValue: hi, duration: dur, useNativeDriver: false }),
          Animated.timing(h, { toValue: lo, duration: dur, useNativeDriver: false }),
        ])
      );
      loop.start();
      loopsRef.current.push(loop);
    });

    return () => loopsRef.current.forEach(a => a.stop());
  }, [active, muted]);

  const barColor = muted ? C.label4 : active ? C.blue : C.indigo;
  const opacity  = muted ? 0.35 : 0.9;

  return (
    <View style={wf.card}>
      <View style={wf.bars}>
        {heights.map((h, i) => (
          <View key={i} style={wf.slot}>
            <Animated.View style={[wf.bar, { height: h, backgroundColor: barColor, opacity }]} />
          </View>
        ))}
      </View>
      <View style={wf.footer}>
        <View style={[wf.dot, { backgroundColor: muted ? C.label4 : barColor }]} />
        <Text style={wf.label} numberOfLines={1}>
          {muted
            ? 'OUTPUT MUTED'
            : active
              ? 'CHEBYSHEV TYPE II  ·  4TH ORDER  ·  LOW-PASS  ·  4-STAGE BIQUAD IIR'
              : 'DIRECT PASSTHROUGH  ·  BYPASS ACTIVE  ·  NO FREQUENCY SHAPING'}
        </Text>
      </View>
    </View>
  );
}

const wf = StyleSheet.create({
  card:   { height: 88, marginHorizontal: 16, borderRadius: 14, backgroundColor: C.bg2, padding: 14 },
  bars:   { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  slot:   { flex: 1, height: 44, justifyContent: 'flex-end' },
  bar:    { width: '100%', borderRadius: 1.5, minHeight: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  dot:    { width: 5, height: 5, borderRadius: 2.5 },
  label:  { fontSize: 10, fontWeight: '600', color: C.label2, letterSpacing: 0.5 },
});

// ─── Volume Slider ─────────────────────────────────────────────────────────────

function VolumeSlider({ value, onChange }: {
  value: number;
  onChange: (v: number, sendNow: boolean) => void;
}) {
  const trackW   = useRef(0);
  const knobX    = useRef(new Animated.Value(0)).current;
  const fillW    = useRef(new Animated.Value(12)).current;
  const dragging = useRef(false);

  const vToX = (v: number) => trackW.current > 0
    ? (v / 100) * Math.max(0, trackW.current - 24)
    : 0;

  const xToV = (x: number) => trackW.current > 0
    ? Math.round(Math.max(0, Math.min(1, (x - 12) / Math.max(1, trackW.current - 24))) * 100)
    : 0;

  const moveTo = (v: number) => {
    const x = vToX(v);
    knobX.setValue(x);
    fillW.setValue(x + 12);
  };

  useEffect(() => {
    if (!dragging.current && trackW.current > 0) moveTo(value);
  }, [value]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    trackW.current = e.nativeEvent.layout.width;
    moveTo(value);
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => {
        dragging.current = true;
        const v = xToV(e.nativeEvent.locationX);
        moveTo(v);
        onChange(v, false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      onPanResponderMove: (e) => {
        const v = xToV(e.nativeEvent.locationX);
        moveTo(v);
        onChange(v, false);
      },
      onPanResponderRelease: (e) => {
        dragging.current = false;
        const v = xToV(e.nativeEvent.locationX);
        moveTo(v);
        onChange(v, true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      },
    })
  ).current;

  return (
    <View style={sl.wrapper} onLayout={onLayout} {...pan.panHandlers}>
      {/* Track */}
      <View style={sl.track}>
        <Animated.View style={[sl.fill, { width: fillW }]} />
      </View>
      {/* Knob */}
      <Animated.View style={[sl.knob, { transform: [{ translateX: knobX }] }]} />
    </View>
  );
}

const sl = StyleSheet.create({
  wrapper: { height: 44, justifyContent: 'center', position: 'relative' },
  track:   { height: 4, backgroundColor: C.bg3, borderRadius: 2, overflow: 'hidden' },
  fill:    { position: 'absolute', left: 0, top: 0, height: 4, backgroundColor: C.blue, borderRadius: 2 },
  knob:    {
    position: 'absolute', width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.label, top: 10,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
});

// ─── Gain Control ──────────────────────────────────────────────────────────────

function GainControl({ label, idx, color, onUp, onDown }: {
  label: string; idx: number; color: string; onUp: () => void; onDown: () => void;
}) {
  const db  = idx - 10;
  const str = `${db >= 0 ? '+' : ''}${db} dB`;
  return (
    <View style={{ flex: 1 }}>
      <Text style={[T.caption2, { color: C.label2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }]}>
        {label}
      </Text>
      <Text style={[T.title2, { color, fontVariant: ['tabular-nums'], marginBottom: 14 }]}>{str}</Text>
      <TouchableOpacity onPress={onUp} activeOpacity={0.6}
        style={{ height: 44, borderRadius: 10, backgroundColor: color + '22', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontSize: 24, color, fontWeight: '300', lineHeight: 28 }}>+</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDown} activeOpacity={0.6}
        style={{ height: 44, borderRadius: 10, backgroundColor: C.bg3, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 24, color: C.label2, fontWeight: '300', lineHeight: 28 }}>−</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Section Label ─────────────────────────────────────────────────────────────

function SLabel({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 16, marginTop: 24, marginBottom: 8 }}>
      <Text style={[T.footnote, { fontWeight: '600', color: C.label2, textTransform: 'uppercase', letterSpacing: 0.4 }]}>{title}</Text>
      {detail != null && <Text style={[T.footnote, { color: C.blue, fontVariant: ['tabular-nums'] }]}>{detail}</Text>}
    </View>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

type Screen = 'connect' | 'control';

export default function App() {
  // Lazy-init so the BleManager is constructed exactly once (a bare
  // useRef(new BleManager()) re-constructs — and leaks — one per render).
  const managerRef = useRef<BleManager | null>(null);
  if (!managerRef.current) managerRef.current = new BleManager();
  const manager   = managerRef.current;
  const devRef    = useRef<Device | null>(null);

  const [screen,     setScreen]     = useState<Screen>('connect');
  const [scanning,   setScanning]   = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices,    setDevices]    = useState<Device[]>([]);
  const [connName,   setConnName]   = useState('');

  const [filterOn, setFilterOn] = useState(false);
  const [volume,   setVolume]   = useState(80);
  const [muted,    setMuted]    = useState(false);
  const [fGain,    setFGain]    = useState(10);   // 0–20, unity = 10
  const [mGain,    setMGain]    = useState(10);

  useEffect(() => () => { manager.destroy(); }, []);

  // ── BLE write ────────────────────────────────────────────────────────────────
  const send = useCallback((cmd: string) => {
    devRef.current
      ?.writeCharacteristicWithoutResponseForService(BLE_SERVICE, BLE_CHAR, btoa(cmd + '\n'))
      .catch(() => {}); /* fire-and-forget: transient BLE write errors are normal */
  }, []);

  // ── Scan ─────────────────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    if ((await manager.state()) !== 'PoweredOn') {
      Alert.alert('Bluetooth Off', 'Enable Bluetooth in Settings to continue.');
      return;
    }
    setDevices([]);
    setScanning(true);
    manager.startDeviceScan(null, null, (_, device) => {
      if (!device) return;
      const name = device.name ?? device.localName;
      if (!name) return;
      setDevices(prev => prev.some(d => d.id === device.id) ? prev : [...prev, device]);
    });
    setTimeout(() => { manager.stopDeviceScan(); setScanning(false); }, 15000);
  }, [manager]);

  const stopScan = useCallback(() => { manager.stopDeviceScan(); setScanning(false); }, [manager]);

  // ── Connect ───────────────────────────────────────────────────────────────────
  const connectTo = useCallback(async (device: Device) => {
    stopScan();
    setConnecting(true);
    try {
      const d = await device.connect({ timeout: 10000 });
      await d.discoverAllServicesAndCharacteristics();
      devRef.current = d;
      setConnName(d.name ?? d.localName ?? 'PYNQ Device');
      setFilterOn(false); setVolume(80); setMuted(false); setFGain(10); setMGain(10);
      setScreen('control');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      d.onDisconnected(() => { devRef.current = null; setScreen('connect'); setConnName(''); });
    } catch {
      Alert.alert('Connection Failed', 'Move closer to the board and try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setConnecting(false);
    }
  }, [stopScan]);

  const disconnect = useCallback(() => devRef.current?.cancelConnection(), []);

  // ── DSP actions ────────────────────────────────────────────────────────────────
  const setFilter = (on: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    send(on ? 'F1' : 'F0');
    setFilterOn(on);
  };

  const onVolume = (v: number, sendNow: boolean) => {
    setVolume(v);
    if (sendNow) send(`V${v}`);
  };

  const toggleMute = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (muted) { send('U'); setMuted(false); }
    else        { send('M'); setMuted(true);  }
  };

  const fGainUp   = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); send('G1'); setFGain(v => Math.min(20, v + 1)); };
  const fGainDown = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); send('G2'); setFGain(v => Math.max(0,  v - 1)); };
  const mGainUp   = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); send('G3'); setMGain(v => Math.min(20, v + 1)); };
  const mGainDown = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); send('G4'); setMGain(v => Math.max(0,  v - 1)); };

  // ────────────────────────────────────────────────────────────────────────────────
  // CONNECT SCREEN
  // ────────────────────────────────────────────────────────────────────────────────
  if (screen === 'connect') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <StatusBar style="light" />

        {/* Hero section */}
        <View style={{ paddingHorizontal: 24, paddingTop: 48, paddingBottom: 32 }}>
          <View style={{
            width: 68, height: 68, borderRadius: 16,
            backgroundColor: C.bg2,
            borderWidth: StyleSheet.hairlineWidth, borderColor: C.sep,
            justifyContent: 'center', alignItems: 'center',
            marginBottom: 20,
          }}>
            <Text style={{ fontSize: 30, color: C.blue }}>≋</Text>
          </View>
          <Text style={[T.largeTitle, { marginBottom: 6 }]}>PYNQ Audio</Text>
          <Text style={[T.body, { color: C.label2 }]}>Real-time DSP Controller</Text>
        </View>

        {/* Connect button */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <TouchableOpacity
            onPress={scanning ? stopScan : startScan}
            disabled={connecting}
            activeOpacity={0.75}
            style={{
              height: 54, borderRadius: 14,
              backgroundColor: scanning ? C.bg2 : C.blue,
              justifyContent: 'center', alignItems: 'center',
              borderWidth: scanning ? StyleSheet.hairlineWidth : 0,
              borderColor: C.sep,
            }}
          >
            {connecting
              ? <ActivityIndicator color={C.label} />
              : <Text style={[T.headline, { color: C.label }]}>
                  {scanning ? 'Stop Scanning' : 'Find PYNQ Board'}
                </Text>
            }
          </TouchableOpacity>
        </View>

        {/* Scanning indicator */}
        {scanning && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 8 }}>
            <ActivityIndicator color={C.blue} size="small" />
            <Text style={[T.footnote, { color: C.label2 }]}>Searching for nearby devices…</Text>
          </View>
        )}

        {/* Device list */}
        {devices.length > 0 && (
          <Text style={[T.footnote, { fontWeight: '600', color: C.label2, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 16, marginBottom: 6 }]}>
            Nearby Devices
          </Text>
        )}

        <FlatList
          data={devices}
          keyExtractor={d => d.id}
          contentContainerStyle={{ paddingHorizontal: 16, gap: StyleSheet.hairlineWidth, paddingBottom: 32 }}
          renderItem={({ item, index }) => {
            const name    = item.name ?? item.localName ?? 'Unknown';
            const isPynq  = name.toLowerCase().includes('pynq');
            const isFirst = index === 0;
            const isLast  = index === devices.length - 1;
            return (
              <TouchableOpacity
                onPress={() => connectTo(item)}
                activeOpacity={0.6}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: C.bg2,
                  paddingHorizontal: 16, paddingVertical: 13,
                  borderTopLeftRadius:     isFirst ? 12 : 0,
                  borderTopRightRadius:    isFirst ? 12 : 0,
                  borderBottomLeftRadius:  isLast  ? 12 : 0,
                  borderBottomRightRadius: isLast  ? 12 : 0,
                }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isPynq ? C.green : C.label3 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[T.callout, { fontWeight: '500', color: isPynq ? C.label : C.label2 }]}>{name}</Text>
                  <Text style={[T.caption1, { color: C.label3, marginTop: 2 }]} numberOfLines={1}>{item.id}</Text>
                </View>
                <Text style={{ fontSize: 20, color: C.label3 }}>›</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            !scanning && !connecting
              ? (
                <View style={{ paddingTop: 16, paddingHorizontal: 8 }}>
                  <Text style={[T.subhead, { color: C.label3, textAlign: 'center', lineHeight: 22 }]}>
                    Make sure your PYNQ board is powered on{'\n'}and the ESP32 is running.
                  </Text>
                </View>
              ) : null
          }
        />
      </SafeAreaView>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────────
  // CONTROL SCREEN
  // ────────────────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />

      {/* Navigation bar — matches iOS HIG exactly */}
      <View style={{
        height: 44,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.sep,
      }}>
        {/* Title */}
        <Text style={T.headline}>PYNQ Audio</Text>

        {/* Connected device pill */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.green }} />
          <Text style={[T.footnote, { color: C.label2 }]} numberOfLines={1}>{connName}</Text>
        </View>

        {/* Disconnect */}
        <TouchableOpacity onPress={disconnect} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[T.callout, { color: C.red }]}>Disconnect</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>

        {/* ── Signal Visualizer ── */}
        <SLabel title="Signal" />
        <WaveformVisualizer active={filterOn} muted={muted} />

        {/* ── Filter ── */}
        <SLabel title="Filter Mode" />
        <View style={{ marginHorizontal: 16, backgroundColor: C.bg2, borderRadius: 14, overflow: 'hidden' }}>
          {/* Bypass row */}
          <TouchableOpacity
            onPress={() => setFilter(false)}
            activeOpacity={0.6}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}
          >
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: !filterOn ? C.blue : 'transparent',
              borderWidth: !filterOn ? 0 : 1.5, borderColor: C.sep,
              justifyContent: 'center', alignItems: 'center',
            }}>
              {!filterOn && <Text style={{ color: C.label, fontSize: 12, fontWeight: '800' }}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[T.callout, { fontWeight: '500' }]}>Bypass</Text>
              <Text style={[T.caption1, { color: C.label2, marginTop: 2 }]}>Direct passthrough — no frequency shaping</Text>
            </View>
          </TouchableOpacity>

          {/* Separator */}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.sep, marginLeft: 50 }} />

          {/* Chebyshev row */}
          <TouchableOpacity
            onPress={() => setFilter(true)}
            activeOpacity={0.6}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}
          >
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: filterOn ? C.blue : 'transparent',
              borderWidth: filterOn ? 0 : 1.5, borderColor: C.sep,
              justifyContent: 'center', alignItems: 'center',
            }}>
              {filterOn && <Text style={{ color: C.label, fontSize: 12, fontWeight: '800' }}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[T.callout, { fontWeight: '500' }]}>Chebyshev Type II</Text>
              <Text style={[T.caption1, { color: C.label2, marginTop: 2 }]}>4th order low-pass · 4-stage biquad IIR</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Volume ── */}
        <SLabel title="Volume" detail={`${volume}%`} />
        <View style={{ marginHorizontal: 16, backgroundColor: C.bg2, borderRadius: 14, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>
          <VolumeSlider value={volume} onChange={onVolume} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 }}>
            <Text style={[T.caption2, { color: C.label3 }]}>0%</Text>
            <Text style={[T.caption2, { color: C.label3 }]}>50%</Text>
            <Text style={[T.caption2, { color: C.label3 }]}>100%</Text>
          </View>
        </View>

        {/* ── Gain ── */}
        <SLabel title="Gain" />
        <View style={{ marginHorizontal: 16, backgroundColor: C.bg2, borderRadius: 14, padding: 16, flexDirection: 'row', gap: 16 }}>
          <GainControl label="Filter" idx={fGain} color={C.purple} onUp={fGainUp} onDown={fGainDown} />
          <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: C.sep }} />
          <GainControl label="Master" idx={mGain} color={C.orange} onUp={mGainUp} onDown={mGainDown} />
        </View>

        {/* ── Output / Mute ── */}
        <SLabel title="Output" />
        <TouchableOpacity
          onPress={toggleMute}
          activeOpacity={0.7}
          style={{
            marginHorizontal: 16, height: 50, borderRadius: 14,
            backgroundColor: muted ? C.orange + '1A' : C.bg2,
            justifyContent: 'center', alignItems: 'center',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: muted ? C.orange + '55' : C.sep,
          }}
        >
          <Text style={[T.callout, { fontWeight: '600', color: muted ? C.orange : C.label }]}>
            {muted ? 'Unmute Output' : 'Mute Output'}
          </Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}
