import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, SafeAreaView,
} from 'react-native';
import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import { BleManager, Device } from 'react-native-ble-plx';
import { StatusBar } from 'expo-status-bar';

// ── BLE config ──────────────────────────────────────────────────────────────
const SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';
const CHAR_UUID    = 'abcd1234-ab12-ab12-ab12-abcdef123456';
const DEVICE_NAME  = 'PYNQ-Audio-Controller';

type ConnState = 'idle' | 'scanning' | 'connecting' | 'ready' | 'error';

const LED_LABELS  = ['LED 1', 'LED 2', 'LED 3', 'LED 4'];
const LED_COLORS  = ['#FFD700', '#00E676', '#40C4FF', '#FF5252'];

export default function App() {
  // ── BLE state ─────────────────────────────────────────────────────────────
  const manager   = useRef(new BleManager()).current;
  const deviceRef = useRef<Device | null>(null);
  const [connState, setConnState] = useState<ConnState>('idle');
  const [ledOn,     setLedOn]     = useState([false, false, false, false]);

  // ── Audio state ────────────────────────────────────────────────────────────
  const soundRef   = useRef<Audio.Sound | null>(null);
  const [trackName,   setTrackName]   = useState<string | null>(null);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    });
    return () => {
      manager.destroy();
      soundRef.current?.unloadAsync();
    };
  }, [manager]);

  // ── BLE ───────────────────────────────────────────────────────────────────
  const connLabel: Record<ConnState, string> = {
    idle:       'Not connected',
    scanning:   'Scanning…',
    connecting: 'Connecting…',
    ready:      'Connected to PYNQ',
    error:      'Connection failed — tap to retry',
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
    setTimeout(() => {
      manager.stopDeviceScan();
      setConnState(s => s === 'scanning' ? 'idle' : s);
    }, 10000);
  }, [manager]);

  const disconnect = useCallback(() => {
    deviceRef.current?.cancelConnection();
  }, []);

  const sendLED = useCallback((index: number) => {
    const dev = deviceRef.current;
    if (!dev) return;
    const b64 = btoa(`L${index + 1}$`);
    dev.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CHAR_UUID, b64)
      .then(() => setLedOn(prev => {
        const next = [...prev];
        next[index] = !next[index];
        return next;
      }))
      .catch(e => console.warn('BLE write:', e));
  }, []);

  // ── Audio ─────────────────────────────────────────────────────────────────
  const pickAndLoad = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    setIsLoadingAudio(true);
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri: result.assets[0].uri },
        { shouldPlay: true },
        status => {
          if ('isPlaying' in status) setIsPlaying(status.isPlaying);
          if ('didJustFinish' in status && status.didJustFinish) setIsPlaying(false);
        }
      );
      soundRef.current = sound;
      setTrackName(result.assets[0].name);
      setIsPlaying(true);
    } catch {
      Alert.alert('Error', 'Could not load audio file.');
    } finally {
      setIsLoadingAudio(false);
    }
  }, []);

  const togglePlayback = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    if (isPlaying) {
      await s.pauseAsync();
    } else {
      await s.playAsync();
    }
  }, [isPlaying]);

  const stopAudio = useCallback(async () => {
    const s = soundRef.current;
    if (!s) return;
    await s.stopAsync();
    setIsPlaying(false);
  }, []);

  const isConnected = connState === 'ready';
  const isBusy      = connState === 'scanning' || connState === 'connecting';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Title ── */}
        <Text style={styles.appTitle}>PYNQ Controller</Text>

        {/* ══ MUSIC PLAYER ══════════════════════════════════════════════════ */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>MUSIC PLAYER</Text>

          <TouchableOpacity style={styles.pickBtn} onPress={pickAndLoad} activeOpacity={0.7}>
            <Text style={styles.pickBtnText}>
              {trackName ? '📂  Change Track' : '📂  Pick Audio File'}
            </Text>
          </TouchableOpacity>

          {trackName && (
            <Text style={styles.trackName} numberOfLines={1}>♪  {trackName}</Text>
          )}

          {isLoadingAudio && <ActivityIndicator color="#40C4FF" style={{ marginTop: 12 }} />}

          <View style={styles.playerRow}>
            <TouchableOpacity
              style={[styles.playerBtn, !trackName && styles.playerBtnDisabled]}
              onPress={togglePlayback}
              disabled={!trackName || isLoadingAudio}
              activeOpacity={0.7}
            >
              <Text style={styles.playerBtnText}>{isPlaying ? '⏸  Pause' : '▶  Play'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.playerBtn, styles.stopBtn, !trackName && styles.playerBtnDisabled]}
              onPress={stopAudio}
              disabled={!trackName}
              activeOpacity={0.7}
            >
              <Text style={styles.playerBtnText}>⏹  Stop</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Connect iPhone to PYNQ LINE IN with a cable to route audio through the filter
          </Text>
        </View>

        {/* ══ BLE CONNECTION ════════════════════════════════════════════════ */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PYNQ CONNECTION</Text>

          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: isConnected ? '#00E676' : isBusy ? '#FFD700' : '#FF5252' }]} />
            <Text style={styles.statusText}>{connLabel[connState]}</Text>
          </View>

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
        </View>

        {/* ══ FILTER / LED CONTROL ══════════════════════════════════════════ */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>FILTER CONTROL</Text>
          {!isConnected && (
            <Text style={styles.disabledNote}>Connect to PYNQ to enable</Text>
          )}
          <View style={styles.grid}>
            {LED_LABELS.map((label, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.ledBtn,
                  { borderColor: ledOn[i] ? LED_COLORS[i] : '#2a2a2a' },
                  ledOn[i] && { backgroundColor: LED_COLORS[i] + '18' },
                  !isConnected && styles.ledBtnDisabled,
                ]}
                onPress={() => sendLED(i)}
                disabled={!isConnected}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 32 }}>{ledOn[i] ? '💡' : '🔦'}</Text>
                <Text style={[styles.ledLabel, ledOn[i] && { color: LED_COLORS[i] }]}>
                  {label}
                </Text>
                <Text style={[styles.ledState, { color: ledOn[i] ? LED_COLORS[i] : '#444' }]}>
                  {ledOn[i] ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#080808' },
  scroll: { padding: 20, paddingBottom: 40 },

  appTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 20,
  },

  card: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  cardTitle: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 14,
  },

  // music player
  pickBtn: {
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#40C4FF44',
  },
  pickBtnText: { color: '#40C4FF', fontSize: 15, fontWeight: '600' },
  trackName:   { color: '#aaa', fontSize: 13, marginTop: 10, marginBottom: 2 },
  playerRow:   { flexDirection: 'row', gap: 10, marginTop: 14 },
  playerBtn: {
    flex: 1,
    backgroundColor: '#1565C0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  stopBtn:         { backgroundColor: '#333' },
  playerBtnDisabled: { opacity: 0.3 },
  playerBtnText:   { color: '#fff', fontSize: 15, fontWeight: '600' },
  hint: {
    color: '#333',
    fontSize: 11,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 16,
  },

  // BLE
  statusRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  dot:         { width: 8, height: 8, borderRadius: 4 },
  statusText:  { color: '#777', fontSize: 13 },
  connectBtn: {
    backgroundColor: '#1565C0',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  disconnectBtn:  { backgroundColor: '#7f0000' },
  disabledBtn:    { backgroundColor: '#222' },
  connectBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // LED grid
  disabledNote: { color: '#333', fontSize: 12, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  ledBtn: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  ledBtnDisabled: { opacity: 0.4 },
  ledLabel: { color: '#bbb', fontSize: 14, fontWeight: '600' },
  ledState: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
