import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, Platform, PermissionsAndroid, ActivityIndicator,
} from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import { StatusBar } from 'expo-status-bar';

const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHAR_UUID    = 'abcd1234-ab12-ab12-ab12-abcdef123456';
const DEVICE_NAME  = 'PYNQ-Audio-Controller';

type ConnState = 'idle' | 'scanning' | 'connecting' | 'ready' | 'error';

const LED_LABELS = ['LED 1', 'LED 2', 'LED 3', 'LED 4'];
const LED_COLORS = ['#FFD700', '#00E676', '#40C4FF', '#FF5252'];

export default function App() {
  const manager   = useRef(new BleManager()).current;
  const deviceRef = useRef<Device | null>(null);

  const [connState, setConnState] = useState<ConnState>('idle');
  const [ledOn,     setLedOn]     = useState([false, false, false, false]);

  useEffect(() => {
    return () => { manager.destroy(); };
  }, [manager]);

  const statusLabel: Record<ConnState, string> = {
    idle:       'Not connected',
    scanning:   'Scanning…',
    connecting: 'Connecting…',
    ready:      'Connected',
    error:      'Connection failed',
  };

  const startScan = useCallback(() => {
    setConnState('scanning');
    manager.startDeviceScan([SERVICE_UUID], null, (err, device) => {
      if (err) { setConnState('error'); return; }
      if (!device || device.name !== DEVICE_NAME) return;

      manager.stopDeviceScan();
      setConnState('connecting');

      device.connect()
        .then(d => d.discoverAllServicesAndCharacteristics())
        .then(d => {
          deviceRef.current = d;
          setConnState('ready');
          d.onDisconnected(() => {
            deviceRef.current = null;
            setConnState('idle');
            setLedOn([false, false, false, false]);
          });
        })
        .catch(() => setConnState('error'));
    });

    // auto-stop scan after 10 s
    setTimeout(() => {
      if (connState === 'scanning') {
        manager.stopDeviceScan();
        setConnState('idle');
        Alert.alert('Not found', 'Could not find PYNQ-Audio-Controller. Make sure ESP32 is powered and advertising.');
      }
    }, 10000);
  }, [manager, connState]);

  const disconnect = useCallback(() => {
    deviceRef.current?.cancelConnection();
  }, []);

  const sendLED = useCallback((index: number) => {
    const dev = deviceRef.current;
    if (!dev) return;
    const cmd    = `L${index + 1}$`;
    const b64    = btoa(cmd);
    dev.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CHAR_UUID, b64)
      .then(() => setLedOn(prev => {
        const next = [...prev];
        next[index] = !next[index];
        return next;
      }))
      .catch(e => console.warn('BLE write error', e));
  }, []);

  const isConnected = connState === 'ready';
  const isBusy      = connState === 'scanning' || connState === 'connecting';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.title}>PYNQ Controller</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: isConnected ? '#00E676' : '#FF5252' }]} />
          <Text style={styles.statusText}>{statusLabel[connState]}</Text>
        </View>
      </View>

      {/* ── Connect / Disconnect ── */}
      <TouchableOpacity
        style={[styles.connectBtn, isConnected && styles.disconnectBtn, isBusy && styles.disabledBtn]}
        onPress={isConnected ? disconnect : startScan}
        disabled={isBusy}
        activeOpacity={0.7}
      >
        {isBusy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.connectBtnText}>
              {isConnected ? 'Disconnect' : 'Connect to PYNQ'}
            </Text>
        }
      </TouchableOpacity>

      {/* ── LED Grid ── */}
      <Text style={styles.sectionTitle}>LED Control</Text>
      <View style={styles.grid}>
        {LED_LABELS.map((label, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.ledBtn,
              { borderColor: ledOn[i] ? LED_COLORS[i] : '#333' },
              ledOn[i] && { backgroundColor: LED_COLORS[i] + '22' },
            ]}
            onPress={() => sendLED(i)}
            disabled={!isConnected}
            activeOpacity={0.7}
          >
            <Text style={[styles.bulb, { color: ledOn[i] ? LED_COLORS[i] : '#555' }]}>
              {ledOn[i] ? '💡' : '🔦'}
            </Text>
            <Text style={[styles.ledLabel, ledOn[i] && { color: LED_COLORS[i] }]}>
              {label}
            </Text>
            <Text style={[styles.ledState, { color: ledOn[i] ? LED_COLORS[i] : '#555' }]}>
              {ledOn[i] ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!isConnected && (
        <Text style={styles.hint}>Connect to enable LED controls</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#888',
    fontSize: 14,
  },
  connectBtn: {
    backgroundColor: '#1a73e8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 36,
  },
  disconnectBtn: {
    backgroundColor: '#c62828',
  },
  disabledBtn: {
    backgroundColor: '#333',
  },
  connectBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  ledBtn: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bulb: {
    fontSize: 40,
  },
  ledLabel: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '600',
  },
  ledState: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  hint: {
    color: '#444',
    textAlign: 'center',
    marginTop: 24,
    fontSize: 13,
  },
});
