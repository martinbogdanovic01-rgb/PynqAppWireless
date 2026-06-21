import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  SafeAreaView, Alert, FlatList, PanResponder, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BleManager, Device } from 'react-native-ble-plx';
import { StatusBar } from 'expo-status-bar';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHAR_UUID    = 'abcd1234-ab12-ab12-ab12-abcdef123456';
const { width }    = Dimensions.get('window');

type Screen = 'scan' | 'control';

// ─── helpers ─────────────────────────────────────────────────────────────────

const b64 = (s: string) => btoa(s);

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const manager   = useRef(new BleManager()).current;
  const deviceRef = useRef<Device | null>(null);

  const [screen,     setScreen]     = useState<Screen>('scan');
  const [scanning,   setScanning]   = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices,    setDevices]    = useState<Device[]>([]);
  const [connName,   setConnName]   = useState('');

  // DSP state
  const [filterOn,  setFilterOn]  = useState(false);   // false=bypass true=cheby
  const [volume,    setVolume]    = useState(80);       // 0-100
  const [muted,     setMuted]     = useState(false);

  useEffect(() => () => { manager.destroy(); }, [manager]);

  // ── send ───────────────────────────────────────────────────────────────────
  const send = useCallback((cmd: string) => {
    const dev = deviceRef.current;
    if (!dev) return;
    dev.writeCharacteristicWithoutResponseForService(
      SERVICE_UUID, CHAR_UUID, b64(cmd + '\n')
    ).catch(() => {
      Alert.alert('Send failed', 'Lost connection.');
      setScreen('scan');
    });
  }, []);

  // ── scan ───────────────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      Alert.alert('Bluetooth off', 'Turn on Bluetooth and try again.');
      return;
    }
    setDevices([]);
    setScanning(true);
    manager.startDeviceScan(null, null, (err, device) => {
      if (err || !device) return;
      const name = device.name ?? device.localName;
      if (!name) return;
      setDevices(prev => prev.some(d => d.id === device.id) ? prev : [...prev, device]);
    });
    setTimeout(() => { manager.stopDeviceScan(); setScanning(false); }, 15000);
  }, [manager]);

  const stopScan = useCallback(() => {
    manager.stopDeviceScan();
    setScanning(false);
  }, [manager]);

  // ── connect ────────────────────────────────────────────────────────────────
  const connectToDevice = useCallback(async (device: Device) => {
    stopScan();
    setConnecting(true);
    try {
      const connected = await device.connect({ timeout: 10000 });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setConnName(device.name ?? device.localName ?? device.id);
      setFilterOn(false);
      setVolume(80);
      setMuted(false);
      setScreen('control');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      connected.onDisconnected(() => {
        deviceRef.current = null;
        setScreen('scan');
        setConnName('');
      });
    } catch {
      Alert.alert('Connection failed', 'Could not connect. Try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setConnecting(false);
    }
  }, [stopScan]);

  const disconnect = useCallback(() => {
    deviceRef.current?.cancelConnection();
  }, []);

  // ── control actions ────────────────────────────────────────────────────────
  const setFilter = (active: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    send(active ? 'F1' : 'F0');
    setFilterOn(active);
  };

  const applyVolume = (v: number) => {
    send(`V${v}`);
    setVolume(v);
  };

  const toggleMute = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (muted) { send('U'); setMuted(false); }
    else        { send('M'); setMuted(true);  }
  };

  const gainBtn = (cmd: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    send(cmd);
  };

  // ── SCAN SCREEN ────────────────────────────────────────────────────────────
  if (screen === 'scan') {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        <View style={s.header}>
          <Text style={s.appName}>PYNQ</Text>
          <Text style={s.appSub}>AUDIO CONTROLLER</Text>
        </View>

        <TouchableOpacity
          onPress={scanning ? stopScan : startScan}
          activeOpacity={0.85}
          style={s.btnWrap}
          disabled={connecting}
        >
          <LinearGradient
            colors={scanning ? ['#1a3a1a','#1e5c1e'] : ['#1d4ed8','#3b82f6']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.gradBtn}
          >
            {connecting
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnText}>{scanning ? 'STOP SCAN' : 'SCAN FOR PYNQ'}</Text>
            }
          </LinearGradient>
        </TouchableOpacity>

        {scanning && (
          <View style={s.scanRow}>
            <ActivityIndicator color="#3b82f6" size="small" />
            <Text style={s.scanText}>Scanning for nearby devices…</Text>
          </View>
        )}

        {devices.length > 0 && <Text style={s.listHdr}>SELECT DEVICE</Text>}

        <FlatList
          data={devices}
          keyExtractor={d => d.id}
          contentContainerStyle={s.listContent}
          renderItem={({ item }) => {
            const name   = item.name ?? item.localName ?? 'Unknown';
            const isPynq = name.toLowerCase().includes('pynq');
            return (
              <TouchableOpacity
                style={[s.deviceRow, isPynq && s.deviceRowHL]}
                onPress={() => connectToDevice(item)}
                activeOpacity={0.7}
              >
                <View style={[s.devDot, { backgroundColor: isPynq ? '#22c55e' : '#444' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.devName, isPynq && { color: '#fff' }]}>{name}</Text>
                  <Text style={s.devId}>{item.id}</Text>
                </View>
                <Text style={s.arrow}>›</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            !scanning ? <Text style={s.empty}>Tap "Scan for PYNQ" to start</Text> : null
          }
        />
      </SafeAreaView>
    );
  }

  // ── CONTROL SCREEN ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.ctrlHeader}>
        <View>
          <Text style={s.appName}>PYNQ</Text>
          <Text style={s.appSub}>AUDIO CONTROLLER</Text>
        </View>
        <TouchableOpacity onPress={disconnect} style={s.discBtn}>
          <Text style={s.discText}>DISCONNECT</Text>
        </TouchableOpacity>
      </View>

      {/* Status */}
      <View style={s.statusPill}>
        <View style={s.statusDot} />
        <Text style={s.statusText} numberOfLines={1}>{connName}</Text>
        {muted && (
          <View style={s.mutedBadge}>
            <Text style={s.mutedBadgeText}>MUTED</Text>
          </View>
        )}
      </View>

      {/* ── FILTER ── */}
      <SectionLabel label="FILTER" />
      <View style={s.filterRow}>
        <FilterChip
          label="BYPASS"
          sub="No processing"
          active={!filterOn}
          color="#6b7280"
          onPress={() => setFilter(false)}
        />
        <FilterChip
          label="CHEBYSHEV II"
          sub="Low-pass IIR"
          active={filterOn}
          color="#3b82f6"
          onPress={() => setFilter(true)}
        />
      </View>

      {/* ── VOLUME ── */}
      <SectionLabel label={`VOLUME  ${volume}%`} />
      <View style={s.sliderWrap}>
        <VolumeSlider value={volume} onChange={applyVolume} />
      </View>

      {/* ── GAIN ── */}
      <SectionLabel label="GAIN" />
      <View style={s.gainRow}>
        <GainCard
          label="FILTER GAIN"
          color="#a855f7"
          onUp={()   => gainBtn('G1')}
          onDown={() => gainBtn('G2')}
        />
        <GainCard
          label="MASTER GAIN"
          color="#f97316"
          onUp={()   => gainBtn('G3')}
          onDown={() => gainBtn('G4')}
        />
      </View>

      {/* ── MUTE ── */}
      <TouchableOpacity onPress={toggleMute} activeOpacity={0.85} style={s.btnWrap}>
        <LinearGradient
          colors={muted ? ['#92400e','#f59e0b'] : ['#1c1c1e','#2a2a2e']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={s.gradBtn}
        >
          <Text style={s.btnText}>{muted ? '▶  UNMUTE' : '✕  MUTE'}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Volume Slider ────────────────────────────────────────────────────────────

function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const TRACK = width - 48;
  const pan   = useRef(0);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: (e) => {
        pan.current = e.nativeEvent.locationX;
        const v = Math.round(Math.max(0, Math.min(1, pan.current / TRACK)) * 100);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onChange(v);
      },
      onPanResponderMove: (e) => {
        pan.current = e.nativeEvent.locationX;
        const v = Math.round(Math.max(0, Math.min(1, pan.current / TRACK)) * 100);
        onChange(v);
      },
      onPanResponderRelease: (e) => {
        pan.current = e.nativeEvent.locationX;
        const v = Math.round(Math.max(0, Math.min(1, pan.current / TRACK)) * 100);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onChange(v);
      },
    })
  ).current;

  const pct = value / 100;

  return (
    <View style={{ paddingHorizontal: 24 }}>
      <View style={sl.track} {...responder.panHandlers}>
        {/* fill */}
        <LinearGradient
          colors={['#1d4ed8','#3b82f6','#60a5fa']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={[sl.fill, { width: `${value}%` }]}
        />
        {/* thumb */}
        <View style={[sl.thumb, { left: pct * (TRACK - 24) }]} />
      </View>
      <View style={sl.labels}>
        <Text style={sl.lbl}>0%</Text>
        <Text style={sl.lbl}>50%</Text>
        <Text style={sl.lbl}>100%</Text>
      </View>
    </View>
  );
}

const sl = StyleSheet.create({
  track:  { height: 36, justifyContent: 'center', position: 'relative', backgroundColor: '#1c1c1e', borderRadius: 18 },
  fill:   { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 18 },
  thumb:  { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', top: 6, shadowColor: '#3b82f6', shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  lbl:    { color: '#444', fontSize: 10, fontWeight: '600' },
});

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 10, marginTop: 18, gap: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: '#1c1c1e' }} />
      <Text style={{ color: '#444', fontSize: 10, fontWeight: '700', letterSpacing: 2 }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: '#1c1c1e' }} />
    </View>
  );
}

function FilterChip({ label, sub, active, color, onPress }:
  { label: string; sub: string; active: boolean; color: string; onPress: () => void }
) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}
      style={[fc.chip, { borderColor: active ? color : '#1c1c1e', backgroundColor: active ? color + '18' : '#0f0f12' }]}
    >
      <View style={[fc.dot, { backgroundColor: active ? color : '#333' }]} />
      <Text style={[fc.label, { color: active ? '#fff' : '#444' }]}>{label}</Text>
      <Text style={[fc.sub, { color: active ? color : '#2a2a2a' }]}>{sub}</Text>
    </TouchableOpacity>
  );
}
const fc = StyleSheet.create({
  chip:  { flex: 1, borderRadius: 16, borderWidth: 1.5, padding: 16, alignItems: 'center', gap: 8 },
  dot:   { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  sub:   { fontSize: 10, fontWeight: '600' },
});

function GainCard({ label, color, onUp, onDown }:
  { label: string; color: string; onUp: () => void; onDown: () => void }
) {
  return (
    <View style={[gc.card, { borderColor: color + '33' }]}>
      <Text style={[gc.label, { color }]}>{label}</Text>
      <TouchableOpacity onPress={onUp} activeOpacity={0.7} style={[gc.btn, { backgroundColor: color + '22' }]}>
        <Text style={[gc.btnTxt, { color }]}>＋</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDown} activeOpacity={0.7} style={[gc.btn, { backgroundColor: color + '11' }]}>
        <Text style={[gc.btnTxt, { color: color + 'aa' }]}>－</Text>
      </TouchableOpacity>
    </View>
  );
}
const gc = StyleSheet.create({
  card:   { flex: 1, backgroundColor: '#0f0f12', borderRadius: 16, borderWidth: 1, padding: 14, alignItems: 'center', gap: 10 },
  label:  { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  btn:    { width: '100%', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnTxt: { fontSize: 22, fontWeight: '300' },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#050508' },

  header:     { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  ctrlHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
  appName:    { fontSize: 38, fontWeight: '800', color: '#fff', letterSpacing: 5 },
  appSub:     { fontSize: 11, fontWeight: '600', color: '#2a2a2a', letterSpacing: 4, marginTop: -4 },

  discBtn:    { backgroundColor: '#1a0a0a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#7f1d1d' },
  discText:   { color: '#ef4444', fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  statusPill: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 4,
                backgroundColor: '#0f0f12', paddingVertical: 10, paddingHorizontal: 14,
                borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1e', gap: 8 },
  statusDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  statusText: { color: '#555', fontSize: 13, fontWeight: '500', flex: 1 },
  mutedBadge: { backgroundColor: '#f59e0b22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#f59e0b44' },
  mutedBadgeText: { color: '#f59e0b', fontSize: 10, fontWeight: '700' },

  filterRow:  { flexDirection: 'row', marginHorizontal: 24, gap: 12 },
  gainRow:    { flexDirection: 'row', marginHorizontal: 24, gap: 12 },
  sliderWrap: { marginBottom: 4 },

  btnWrap:    { marginHorizontal: 24, marginTop: 16, borderRadius: 16, overflow: 'hidden' },
  gradBtn:    { paddingVertical: 17, alignItems: 'center', justifyContent: 'center' },
  btnText:    { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 1.5 },

  scanRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, marginBottom: 16 },
  scanText:   { color: '#444', fontSize: 13 },
  listHdr:    { color: '#2a2a2a', fontSize: 10, fontWeight: '700', letterSpacing: 2, paddingHorizontal: 24, marginBottom: 8 },
  listContent:{ paddingHorizontal: 24, gap: 8, paddingBottom: 24 },
  deviceRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0f0f12', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1c1c1e' },
  deviceRowHL:{ borderColor: '#22c55e44', backgroundColor: '#001a0e' },
  devDot:     { width: 10, height: 10, borderRadius: 5 },
  devName:    { color: '#666', fontSize: 15, fontWeight: '600' },
  devId:      { color: '#2a2a2a', fontSize: 11, marginTop: 2 },
  arrow:      { color: '#333', fontSize: 22 },
  empty:      { color: '#2a2a2a', textAlign: 'center', marginTop: 60, fontSize: 14 },
});
