# PYNQ Audio Controller

Real-time audio DSP system controlled from an iPhone over BLE.

**Signal chain:** iPhone app → BLE → ESP32 → UART (9600 8N1) → PYNQ-Z2 (AXI UART Lite) →
ADAU1761 DSP → audio out.

---

# Part 1 — How to Run Everything

Run the three parts in this order: **PYNQ → ESP32 → iPhone app.**

## 1. PYNQ-Z2 (FPGA + DSP) — Vitis
1. Power on the board, set the boot jumper to **JTAG**, connect the USB cable.
2. Open `MO7Project1` in Vitis.
3. **Project → Clean**, then **Build** (rebuild needed after any `main.c`/`control.c` change).
4. Right-click the app → **Run As → Launch Hardware** (programs the bitstream + ELF).
5. Open **PuTTY** on the board's USB-UART COM port at **115200 baud**. Expect:
   ```
   === MO7 Audio Filter System ===
   UART ready
   ADAU1761 configured
   Entering audio loop
   ```
6. Plug an audio source into LINE-IN and headphones/speaker into the output jack.

## 2. ESP32 (BLE ↔ UART bridge) — Arduino IDE
1. Open `esp32/esp32_pynq_bridge_v2/esp32_pynq_bridge_v2.ino`.
2. **Tools → Board** → select your exact ESP32 board; **Tools → Port** → the ESP32's COM port.
3. (If your board has the option) **Tools → USB CDC On Boot → Enabled** — see review §B.1.
4. Click **Upload**.
5. Open **Serial Monitor** at **115200 baud**. Expect:
   ```
   Starting BLE...
   BLE ready - waiting for phone connection...
   ```

Keep **both** PuTTY (PYNQ) and the Serial Monitor (ESP32) open — together they show the whole chain.

## 3. iPhone app (controller)
The app builds in GitHub Actions; you can't run the `.tsx` directly from Windows.

1. Push to GitHub `main` (or run the **Build iOS IPA** workflow manually).
2. GitHub → **Actions** → latest run → **Artifacts** → download **`PYNQControl-IPA`**
   (NOT `PYNQ-Audio-Controller` — that one is the disabled legacy job).
3. Sideload the IPA with **AltStore** or **Sideloadly** (needs your Apple ID; free accounts
   re-sign every 7 days). `react-native-ble-plx` does not work in plain Expo Go, so use the IPA.

## 4. Connect & test
1. App → **Find PYNQ Board** → tap **PYNQ-Audio-Controller**.
2. Press a control (e.g. Filter → Chebyshev) and watch the chain:
   - ESP32 Serial Monitor: `Received from app: F1` → `Sent to PYNQ: F1`
   - PuTTY: `[INF] Filter -> CHEBYSHEV_II`
   - Audio output changes.

If a command shows in the ESP32 monitor but **not** in PuTTY, the UART-into-PYNQ link is the
issue — run the isolation test in §B.2.

## Command reference
| App action | Sent | PYNQ effect |
|---|---|---|
| Bypass / Chebyshev | `F0` / `F1` | filter off / on |
| Filter gain ± | `G1` / `G2` | filter gain idx ±1 |
| Master gain ± | `G3` / `G4` | master gain idx ±1 |
| Volume slider (on release) | `Vxx` | volume 0–100% |
| Mute / Unmute | `M` / `U` | output mute toggle |

---

# Part 2 — Code Review

Reviewed: 2026-06-21. Constraints honored: `audio_codec.*` and `uart.*`/`uart_ext.*` not
modified; ESP32 Serial1 pins kept on 20/21; no physical wiring changes.

All ESP32 BLE API used below was verified against the installed core (`esp32 3.3.10`,
Bluedroid): `onConnect(BLEServer*, esp_ble_gatts_cb_param_t*)`, `requestConnParams(...)`,
`setMinPreferred/setMaxPreferred` all exist; the connect event fires both `onConnect`
overloads (BLEServer.cpp:531-532), and disconnect fires the 1-arg `onDisconnect`
(BLEServer.cpp:569).

## A. Fixes applied

### A.1 BLE latency — the big one (ESP32)  ✅
**Problem:** after the first couple of packets iOS let the BLE connection interval drift to
1–2 s, so commands felt slow. The peripheral never requested anything faster.
**Fix:** on connect, call `pServer->requestConnParams(remote_bda, 0x0C, 0x18, 0, 400)` →
request a **15–30 ms** interval (0 slave latency, 4 s supervision timeout). 15 ms is Apple's
minimum for a BLE accessory, so it's the lowest iOS will grant. Same values also advertised
as preferred params.
**Expected latency now:** ~15–35 ms BLE + ~3 ms UART + sub-ms PYNQ ≈ **under 50 ms**,
consistent for every command (no more "first two then slow").

### A.2 Guarantee UART bytes leave per command (ESP32)  ✅
Added `Serial1.flush()` after `Serial1.print(value)` so the 9600-baud bytes are pushed out
before the BLE callback returns (~3 ms, negligible).

### A.3 BleManager constructed once (App.tsx)  ✅
`useRef(new BleManager())` re-ran `new BleManager()` every render (only the first kept; the
rest leaked native handles). Switched to guarded lazy init.

### A.4 Duplicate CI workflow producing a malformed IPA  ✅
Two workflows built on every push. `build.yml` zipped the `.app` at the archive root instead
of under `Payload/` → that IPA will **not** sideload. Removed its `push` trigger (manual-only).
`build-ios.yml` is correct. **Always download the `PYNQControl-IPA` artifact.**

### A.5 Removed unused `<string.h>` include (PYNQ main.c)  ✅

## B. If PYNQ still receives nothing after flashing

The software UART path is correct on both sides, so a "nothing received" symptom is physical
or a board *setting*, not the logic.

1. **USB-CDC board setting (no rewiring).** On some ESP32 variants GPIO20/21 double as UART0.
   If `Serial` (USB debug) routes to UART0 instead of native USB, it collides with `Serial1`
   on 20/21 and kills forwarding even with perfect wiring. If your board has the option, set
   **Tools → USB CDC On Boot → Enabled**. This is the one thing that can break Serial1 across
   a reflash with no wiring change.
2. **PuTTY baud = 115200** (PS UART0 / xil_printf). You already see the banner, so this is fine.
3. **Definitive isolation test:** feed a USB-TTL adapter's TX straight into PYNQ AR1/U12 +
   shared GND, send `G1\n` at 9600 8N1. If PuTTY shows `[INF] MasterGain idx=11`, the PYNQ RX
   path is provably perfect and any fault is on the ESP32 side (setting #1).

## C. Verified correct

- BLE UUIDs match app ↔ ESP32. Command set matches both ends.
- App sends `cmd + '\n'`; ESP32 forwards verbatim; PYNQ terminates on `\n`/`\r`/`;`.
- Baud 9600 8N1 both ends; debug/PuTTY = PS UART0 @115200.
- **App and PYNQ start in sync:** both default to filter off, volume 80, unmuted, gains at
  unity (idx 10); both clamp gain idx to 0–20 and volume to 0–100. No drift.
- DSP: Chebyshev II 4-stage DF-II-transposed cascade; state reset on filter switch; gain →
  volume/mute → master gain order is sane; output clamped to signed 24-bit.
- Audio loop polls + drains UART inside the I2S data-ready wait, so commands are never starved
  by the codec; byte-arrival to handling is < one sample period.
- Blocking `uart_write_string` is confined to startup (`control_send_status`), out of the loop.
- Platform layer is standard Xilinx boilerplate; `STDOUT_IS_PS7_UART` → debug on PS UART0.

## D. Security (informational — hobby/educational scope)

- **Open BLE, no pairing/encryption.** Anyone in range can send commands. Fine for a desk demo.
- **Input handling is memory-safe end to end:** ring buffer rejects overflow (>64 bytes);
  command assembler caps at `CMD_MAX_LEN-1` and resets on overflow; `command_parse` validates
  `Vxx` digits and clamps 0–100; gain indices clamped to `[0,20]` (no OOB into `gain_linear[]`);
  `snprintf` for status; all `LOG_*`/`xil_printf` use literal format strings. No
  `strcpy`/`sprintf` from untrusted data.
- **CI:** unsigned builds, no secrets, actions pinned to `@v4`.

## E. Minor notes (left as-is on purpose)

- **Gain LEDs latch** (last-pressed direction stays lit) — a reasonable "last action"
  indicator, not a bug; left unchanged to avoid redefining LED semantics.
- **`audio_read_sample`** sign-extends with a signed right shift (implementation-defined in C;
  arithmetic on ARM GCC, correct here). In working `audio_driver.c` — left alone.
- **`uart_read_char`** ignores `XUartLite_Recv`'s count — safe (only called after
  `uart_data_available()`); in the locked `uart.c` — left alone.
- App is iOS-only for permissions (`app.json`), matching the target.
