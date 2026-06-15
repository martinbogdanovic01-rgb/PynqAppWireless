import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BleManager, Device } from 'react-native-ble-plx';
import { StatusBar } from 'expo-status-bar';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHAR_UUID    = 'abcd1234-ab12-ab12-ab12-abcdef123456';
const DEVICE_NAME  = 'PYNQ-Audio-Controller';

const { width } = Dimensions.get('window');
const BTN_SIZE   = (width - 48 - 12) / 2;

type ConnState = 'idle' | 'scanning' | 'connecting' | 'ready' | 'error';

const LEDS = [
  { label: 'LED 1', color: '#FFB800', glow: '#FFB80066' },
  { label: 'LED 2', color: '#00D97E', glow: '#00D97E66' },
  { label: 'LED 3', color: '#00AEFF', glow: '#00AEFF66' },
  { label: 'LED 4', color: '#FF4757', glow: '#FF475766' },
];

export default function App() {
  const manager   = useRef(new BleManager()).current;
  const deviceRef = useRef<Device | null>(null);

  const [conn, setConn] = useState<ConnState>('idle');
  const [leds, setLeds] = useState([false, false, false, false]);

  useEffect(() => () => { manager.destroy(); }, [manager]);

  const isConnected = conn === 'ready';
  const isBusy      = conn === 'scanning' || conn === 'connecting';

  // ── BLE ──────────────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    setConn('scanning');
    manager.startDeviceScan([SERVICE_UUID], null, (err, device) => {
      if (err) { setConn('error'); return; }
      if (!device || device.name !== DEVICE_NAME) return;
      manager.stopDeviceScan();
      setConn('connecting');
      device.connect()
        .then(d => d.discoverAllServicesAndCharacteristics())
        .then(d => {
          deviceRef.current = d;
          setConn('ready');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          d.onDisconnected(() => {
            deviceRef.current = null;
            setConn('idle');
            setLeds([false, false, false, false]);
          });
        })
        .catch(() => {
          setConn('error');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        });
    });
    setTimeout(() => {
      manager.stopDeviceScan();
      setConn(s => s === 'scanning' ? 'idle' : s);
    }, 10000);
  }, [manager]);

  const disconnect = useCallback(() => {
    deviceRef.current?.cancelConnection();
  }, []);

  const toggleLED = useCallback((i: number) => {
    const dev = deviceRef.current;
    if (!dev) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dev.writeCharacteristicWithoutResponseForService(
      SERVICE_UUID, CHAR_UUID, btoa(`L${i + 1}$`)
    ).then(() => setLeds(prev => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    })).catch(e => console.warn('BLE write:', e));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const connLabel =
    conn === 'ready'      ? 'PYNQ-Audio-Controller' :
    conn === 'scanning'   ? 'Scanning…' :
    conn === 'connecting' ? 'Connecting…' :
    conn === 'error'      ? 'Connection failed' :
                            'Not connected';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.appName}>PYNQ</Text>
        <Text style={styles.appSub}>CONTROLLER</Text>
      </View>

      {/* ── Status pill ── */}
      <View style={styles.statusPill}>
        <View style={[
          styles.statusDot,
          { backgroundColor: isConnected ? '#00D97E' : isBusy ? '#FFB800' : '#444' }
        ]} />
        <Text style={styles.statusText}>{connLabel}</Text>
      </View>

      {/* ── Connect button ── */}
      <TouchableOpacity
        onPress={isConnected ? disconnect : startScan}
        disabled={isBusy}
        activeOpacity={0.85}
        style={styles.connectWrap}
      >
        <LinearGradient
          colors={
            isConnected ? ['#7f0000', '#c62828'] :
            isBusy      ? ['#1a1a1a', '#1a1a1a'] :
                          ['#0044cc', '#0066FF']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.connectBtn}
        >
          {isBusy
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.connectText}>
                {isConnected ? 'DISCONNECT' : 'CONNECT TO PYNQ'}
              </Text>
          }
        </LinearGradient>
      </TouchableOpacity>

      {/* ── Divider ── */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>FILTER BANKS</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* ── LED Grid ── */}
      <View style={styles.grid}>
        {LEDS.map((led, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => toggleLED(i)}
            disabled={!isConnected}
            activeOpacity={0.8}
            style={[
              styles.ledCard,
              {
                borderColor: leds[i] ? led.color : '#1c1c1e',
                shadowColor: leds[i] ? led.color : 'transparent',
                shadowOpacity: leds[i] ? 0.7 : 0,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 0 },
              },
              leds[i] && { backgroundColor: '#0d0d0d' },
              !isConnected && { opacity: 0.35 },
            ]}
          >
            {/* Glow ring behind circle */}
            {leds[i] && (
              <View style={[styles.glowRing, { backgroundColor: led.glow }]} />
            )}

            {/* Indicator circle */}
            <View style={[
              styles.ledCircle,
              {
                backgroundColor: leds[i] ? led.color : '#1c1c1e',
                shadowColor:     leds[i] ? led.color : 'transparent',
                shadowOpacity:   leds[i] ? 1 : 0,
                shadowRadius:    leds[i] ? 12 : 0,
                shadowOffset: { width: 0, height: 0 },
              },
            ]} />

            <Text style={[styles.ledLabel, leds[i] && { color: '#fff' }]}>
              {led.label}
            </Text>
            <Text style={[styles.ledState, { color: leds[i] ? led.color : '#2a2a2a' }]}>
              {leds[i] ? '● ON' : '○ OFF'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!isConnected && (
        <Text style={styles.bottomHint}>
          Connect via Bluetooth to enable filter controls
        </Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050508',
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 4,
  },
  appName: {
    fontSize: 42,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 6,
  },
  appSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    letterSpacing: 5,
    marginTop: -4,
  },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 20,
    marginBottom: 20,
    backgroundColor: '#0f0f12',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1c1c1e',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#666',
    fontSize: 13,
    fontWeight: '500',
  },

  connectWrap: {
    marginHorizontal: 24,
    marginBottom: 32,
    borderRadius: 16,
    overflow: 'hidden',
  },
  connectBtn: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 20,
    gap: 10,
  },
  dividerLine:  { flex: 1, height: 1, backgroundColor: '#1c1c1e' },
  dividerLabel: { color: '#333', fontSize: 11, fontWeight: '700', letterSpacing: 2 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    gap: 12,
  },
  ledCard: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: 24,
    borderWidth: 1.5,
    backgroundColor: '#0a0a0d',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  glowRing: {
    position: 'absolute',
    width: BTN_SIZE * 0.55,
    height: BTN_SIZE * 0.55,
    borderRadius: BTN_SIZE * 0.275,
    opacity: 0.25,
  },
  ledCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  ledLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#444',
    letterSpacing: 0.5,
  },
  ledState: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },

  bottomHint: {
    color: '#222',
    textAlign: 'center',
    fontSize: 12,
    marginTop: 24,
  },
});
