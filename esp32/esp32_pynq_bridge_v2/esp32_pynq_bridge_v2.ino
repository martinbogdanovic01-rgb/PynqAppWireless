/*
 * ESP32 BLE-to-UART Bridge for PYNQ-Z2 Audio Controller
 *
 * Phone (BLE) -> ESP32 -> UART (9600 8N1) -> PYNQ AXI UART Lite
 *
 * Wiring (DO NOT CHANGE — matches the prebuilt PYNQ hardware wrapper):
 *   ESP32 TX (GPIO21) -> PYNQ Arduino header AR0 (T14)
 *   ESP32 RX (GPIO20) -> PYNQ Arduino header AR1 (U12)
 *   GND               -> PYNQ Arduino GND
 *
 * Latency: on connect we actively request a 15-30 ms connection interval.
 * Without this, iOS lets the interval drift to 1-2 s after the first few
 * packets, which made commands feel slow. 15 ms is Apple's minimum for a
 * BLE accessory, so this is the lowest latency iOS will grant.
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHARACTERISTIC_UUID "abcd1234-ab12-ab12-ab12-abcdef123456"

/* Connection-interval request (units of 1.25 ms).
 * 0x0C = 15 ms, 0x18 = 30 ms. Apple requires min >= 15 ms and max >= min + 15 ms. */
#define CONN_INT_MIN   0x0C   /* 15 ms */
#define CONN_INT_MAX   0x18   /* 30 ms */
#define CONN_LATENCY   0      /* no skipped intervals — lowest latency */
#define CONN_TIMEOUT   400    /* supervision timeout, units of 10 ms = 4 s */

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

class MyServerCallbacks : public BLEServerCallbacks {
    /* 2-arg overload gives the peer address so we can request fast params.
     * (Core 3.x fires both onConnect overloads on connect — verified.) */
    void onConnect(BLEServer *pServer, esp_ble_gatts_cb_param_t *param) override {
        deviceConnected = true;
        pServer->requestConnParams(param->connect.remote_bda,
                                   CONN_INT_MIN, CONN_INT_MAX,
                                   CONN_LATENCY, CONN_TIMEOUT);
        Serial.println("Connected - requested 15-30ms interval");
    }
    void onDisconnect(BLEServer *pServer) override {
        deviceConnected = false;
        BLEDevice::startAdvertising();   /* allow immediate reconnect */
        Serial.println("Disconnected - advertising again");
    }
};

class MyCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        String value = pChar->getValue().c_str();
        if (value.length() > 0) {
            Serial.print("Received from app: ");
            Serial.println(value);
            Serial1.print(value);          /* forward verbatim (app already appends '\n') */
            Serial1.flush();               /* push bytes out before returning */
            Serial.print("Sent to PYNQ: ");
            Serial.println(value);
        }
    }
};

void setup()
{
    Serial.begin(115200);
    Serial1.begin(9600, SERIAL_8N1, 20, 21);   /* RX=20, TX=21 — fixed by PYNQ wrapper */
    delay(1000);

    Serial.println("Starting BLE...");

    BLEDevice::init("PYNQ-Audio-Controller");
    BLEServer  *pServer  = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);

    pCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_WRITE    |   /* write with response                    */
        BLECharacteristic::PROPERTY_WRITE_NR     /* write without response (iOS fast path) */
    );
    pCharacteristic->setCallbacks(new MyCallbacks());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    /* Advertise preferred connection parameters as a hint (belt-and-braces
     * alongside the active requestConnParams above). */
    pAdvertising->setMinPreferred(CONN_INT_MIN);
    pAdvertising->setMaxPreferred(CONN_INT_MAX);
    pAdvertising->start();

    Serial.println("BLE ready - waiting for phone connection...");
}

void loop()
{
    /* Echo any PYNQ responses (STATUS / logs) to the USB serial monitor. */
    while (Serial1.available()) {
        Serial.write(Serial1.read());
    }
}
