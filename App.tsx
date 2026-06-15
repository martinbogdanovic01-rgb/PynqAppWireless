import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  SafeAreaView, Dimensions, Alert, FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BleManager, Device } from 'react-native-ble-plx';
import { StatusBar } from 'expo-status-bar';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHAR_UUID    = 'abcd1234-ab12-ab12-ab12-abcdef123456';

const { width } = Dimensions.get('window');
const BTN_SIZE   = (width - 48 - 12) / 2;

type Screen = 'scan' | 'control';

const LEDS = [
  { label: 'LED 1', color: '#FFB800', glow: '#FFB80066' },
  { label: 'LED 2', color: '#00D97E', glow: '#00D97E66' },
  { label: 'LED 3', color: '#00AEFF', glow: '#00AEFF66' },
  { label: 'LED 4', color: '#FF4757', glow: '#FF475766' },
];

export default function App() {
  const manager   = useRef(new BleManager()).current;
  const deviceRef = useRef<Device | null>(null);

  const [screen,    setScreen]    = useState<Screen>('scan');
  const [scanning,  setScanning]  = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices,   setDevices]   = useState<Device[]>([]);
  const [connName,  setConnName]  = useState('');
  const [leds,      setLeds]      = useState([false, false, false, false]);

  useEffect(() => () => { manager.destroy(); }, [manager]);

  // ── Scanning ──────────────────────────────────────────────────────────────
  const startScan = useCallback(async () => {
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      Alert.alert('Bluetooth off', 'Please turn on Bluetooth and try again.');
      return;
    }
    setDevices([]);
    setScanning(true);

    manager.startDeviceScan(null, null, (err, device) => {
      if (err || !device) return;
      // Only list devices that have some kind of name
      const name = device.name ?? device.localName;
      if (!name) return;
      setDevices(prev =>
        prev.some(d => d.id === device.id) ? prev : [...prev, device]
      );
    });

    setTimeout(() => {
      manager.stopDeviceScan();
      setScanning(false);
    }, 15000);
  }, [manager]);

  const stopScan = useCallback(() => {
    manager.stopDeviceScan();
    setScanning(false);
  }, [manager]);

  // ── Connect ───────────────────────────────────────────────────────────────
  const connectToDevice = useCallback(async (device: Device) => {
    stopScan();
    setConnecting(true);
    try {
      const connected = await device.connect({ timeout: 10000 });
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setConnName(device.name ?? device.localName ?? device.id);
      setScreen('control');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      connected.onDisconnected(() => {
        deviceRef.current = null;
        setScreen('scan');
        setLeds([false, false, false, false]);
        setConnName('');
      });
    } catch {
      Alert.alert('Connection failed', 'Could not connect. Try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setConnecting(false);
    }
  }, [stopScan]);

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    deviceRef.current?.cancelConnection();
  }, []);

  // ── Send LED command ──────────────────────────────────────────────────────
  const toggleLED = useCallback((i: number) => {
    const dev = deviceRef.current;
    if (!dev) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dev.writeCharacteristicWithResponseForService(
      SERVICE_UUID, CHAR_UUID, btoa(`L${i + 1}$`)
    ).then(() => setLeds(prev => {
      const next = [...prev]; next[i] = !next[i]; return next;
    })).catch(() => {
      Alert.alert('Send failed', 'Lost connection to device.');
      setScreen('scan');
    });
  }, []);

  // ── Screens ───────────────────────────────────────────────────────────────
  if (screen === 'control') {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.appName}>PYNQ</Text>
          <Text style={styles.appSub}>CONTROLLER</Text>
        </View>

        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: '#00D97E' }]} />
          <Text style={styles.statusText} numberOfLines={1}>{connName}</Text>
        </View>

        <TouchableOpacity onPress={disconnect} activeOpacity={0.85} style={styles.connectWrap}>
          <LinearGradient colors={['#7f0000', '#c62828']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.connectBtn}>
            <Text style={styles.connectText}>DISCONNECT</Text>
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>FILTER BANKS</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.grid}>
          {LEDS.map((led, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => toggleLED(i)}
              activeOpacity={0.8}
              style={[
                styles.ledCard,
                {
                  borderColor:   leds[i] ? led.color : '#1c1c1e',
                  shadowColor:   leds[i] ? led.color : 'transparent',
                  shadowOpacity: leds[i] ? 0.7 : 0,
                  shadowRadius:  18,
                  shadowOffset:  { width: 0, height: 0 },
                },
                leds[i] && { backgroundColor: '#0d0d0d' },
              ]}
            >
              {leds[i] && <View style={[styles.glowRing, { backgroundColor: led.glow }]} />}
              <View style={[
                styles.ledCircle,
                {
                  backgroundColor: leds[i] ? led.color : '#1c1c1e',
                  shadowColor:     leds[i] ? led.color : 'transparent',
                  shadowOpacity:   leds[i] ? 1 : 0,
                  shadowRadius:    leds[i] ? 12 : 0,
                  shadowOffset:    { width: 0, height: 0 },
                },
              ]} />
              <Text style={[styles.ledLabel, leds[i] && { color: '#fff' }]}>{led.label}</Text>
              <Text style={[styles.ledState, { color: leds[i] ? led.color : '#2a2a2a' }]}>
                {leds[i] ? '● ON' : '○ OFF'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // Scan screen
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.appName}>PYNQ</Text>
        <Text style={styles.appSub}>CONTROLLER</Text>
      </View>

      <TouchableOpacity
        onPress={scanning ? stopScan : startScan}
        activeOpacity={0.85}
        style={styles.connectWrap}
        disabled={connecting}
      >
        <LinearGradient
          colors={scanning ? ['#1a3a1a', '#1e5c1e'] : ['#0044cc', '#0066FF']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={styles.connectBtn}
        >
          {connecting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.connectText}>
                {scanning ? 'STOP SCAN' : 'SCAN FOR DEVICES'}
              </Text>
          }
        </LinearGradient>
      </TouchableOpacity>

      {scanning && (
        <View style={styles.scanningRow}>
          <ActivityIndicator color="#00AEFF" size="small" />
          <Text style={styles.scanningText}>Scanning for nearby devices…</Text>
        </View>
      )}

      {devices.length > 0 && (
        <Text style={styles.listHeader}>TAP A DEVICE TO CONNECT</Text>
      )}

      <FlatList
        data={devices}
        keyExtractor={d => d.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const name = item.name ?? item.localName ?? 'Unknown Device';
          const isPynq = name.toLowerCase().includes('pynq');
          return (
            <TouchableOpacity
              style={[styles.deviceRow, isPynq && styles.deviceRowHighlight]}
              onPress={() => connectToDevice(item)}
              activeOpacity={0.7}
            >
              <View style={[styles.deviceDot, { backgroundColor: isPynq ? '#00D97E' : '#444' }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.deviceName, isPynq && { color: '#fff' }]}>{name}</Text>
                <Text style={styles.deviceId}>{item.id}</Text>
              </View>
              <Text style={styles.connectArrow}>›</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          !scanning ? (
            <Text style={styles.emptyText}>
              {connecting ? '' : 'Tap "Scan for Devices" to start'}
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050508' },

  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 4 },
  appName: { fontSize: 42, fontWeight: '800', color: '#ffffff', letterSpacing: 6 },
  appSub:  { fontSize: 13, fontWeight: '600', color: '#333', letterSpacing: 5, marginTop: -4 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 24, marginTop: 20, marginBottom: 20,
    backgroundColor: '#0f0f12', paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, borderWidth: 1, borderColor: '#1c1c1e', gap: 8,
  },
  statusDot:  { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#666', fontSize: 13, fontWeight: '500', flex: 1 },

  connectWrap: { marginHorizontal: 24, marginTop: 20, marginBottom: 16, borderRadius: 16, overflow: 'hidden' },
  connectBtn:  { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  connectText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 1.5 },

  scanningRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, marginBottom: 16 },
  scanningText: { color: '#555', fontSize: 13 },

  listHeader:  { color: '#333', fontSize: 11, fontWeight: '700', letterSpacing: 2, paddingHorizontal: 24, marginBottom: 8 },
  listContent: { paddingHorizontal: 24, gap: 8, paddingBottom: 24 },

  deviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0f0f12', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#1c1c1e',
  },
  deviceRowHighlight: { borderColor: '#00D97E44', backgroundColor: '#001a0e' },
  deviceDot: { width: 10, height: 10, borderRadius: 5 },
  deviceName: { color: '#888', fontSize: 15, fontWeight: '600' },
  deviceId:   { color: '#333', fontSize: 11, marginTop: 2 },
  connectArrow: { color: '#444', fontSize: 22 },

  emptyText: { color: '#2a2a2a', textAlign: 'center', marginTop: 40, fontSize: 14 },

  dividerRow:   { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 20, gap: 10 },
  dividerLine:  { flex: 1, height: 1, backgroundColor: '#1c1c1e' },
  dividerLabel: { color: '#333', fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, gap: 12 },
  ledCard: {
    width: BTN_SIZE, height: BTN_SIZE, borderRadius: 24, borderWidth: 1.5,
    backgroundColor: '#0a0a0d', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  glowRing: {
    position: 'absolute',
    width: BTN_SIZE * 0.55, height: BTN_SIZE * 0.55, borderRadius: BTN_SIZE * 0.275, opacity: 0.25,
  },
  ledCircle: { width: 44, height: 44, borderRadius: 22 },
  ledLabel:  { fontSize: 15, fontWeight: '700', color: '#444', letterSpacing: 0.5 },
  ledState:  { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
