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
 * Latency: we advertise a preferred 15-30 ms connection interval. iOS reads
 * these preferred params and uses them instead of drifting to a slow 1-2 s
 * interval. 15 ms is Apple's minimum for a BLE accessory. This approach works
 * on both BLE stacks (Bluedroid and NimBLE), so it always compiles.
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHARACTERISTIC_UUID "abcd1234-ab12-ab12-ab12-abcdef123456"

/* Preferred connection interval (units of 1.25 ms).
 * 0x0C = 15 ms, 0x18 = 30 ms. Apple requires min >= 15 ms and max >= min + 15 ms. */
#define CONN_INT_MIN   0x0C   /* 15 ms */
#define CONN_INT_MAX   0x18   /* 30 ms */

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

class MyServerCallbacks : public BLEServerCallbacks {
    /* 1-arg overload exists on every BLE stack — keeps this portable. */
    void onConnect(BLEServer *pServer) override {
        deviceConnected = true;
        Serial.println("Connected");
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
    /* Advertise the preferred low-latency interval (15-30 ms). */
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
