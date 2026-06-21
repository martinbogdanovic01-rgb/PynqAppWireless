/*
 * ESP32 BLE-to-UART Bridge for PYNQ-Z2 Audio Controller
 *
 * Wiring:
 *   ESP32 TX (GPIO21) -> PYNQ Arduino header AR0 (uart_rtl_rxd, T14)
 *   ESP32 RX (GPIO20) -> PYNQ Arduino header AR1 (uart_rtl_txd, U12)
 *   GND               -> PYNQ Arduino GND
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHARACTERISTIC_UUID "abcd1234-ab12-ab12-ab12-abcdef123456"

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer *pServer) override {
        deviceConnected = true;
        pCharacteristic->setValue("");  /* clear stale value from previous session */
        Serial.println("Connected");
    }
    void onDisconnect(BLEServer *pServer) override {
        deviceConnected = false;
        BLEDevice::startAdvertising();
        Serial.println("Disconnected — restarting advertising");
    }
};

class MyCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        String value = pChar->getValue().c_str();
        if (value.length() > 0) {
            Serial.print("-> PYNQ: ");
            Serial.println(value);
            Serial1.print(value);
        }
    }
};

void setup()
{
    Serial.begin(115200);
    Serial1.begin(9600, SERIAL_8N1, 20, 21);
    delay(500);

    Serial.println("Starting BLE...");

    BLEDevice::init("PYNQ-Audio-Controller");
    BLEServer  *pServer  = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);

    pCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_WRITE    |
        BLECharacteristic::PROPERTY_WRITE_NR
    );
    pCharacteristic->setCallbacks(new MyCallbacks());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    /*
     * Peripheral Preferred Connection Parameters — iOS reads these from
     * the advertisement before connecting and uses them to set the
     * connection interval. Without this, iOS defaults to ~1-2s intervals.
     * 0x0C = 15ms (12 * 1.25ms) — iOS minimum for non-MFi accessories.
     * 0x18 = 30ms (24 * 1.25ms) — max we'll accept.
     */
    pAdvertising->setMinPreferred(0x0C);
    pAdvertising->setMaxPreferred(0x18);
    pAdvertising->start();

    Serial.println("BLE ready — waiting for phone...");
}

void loop()
{
    while (Serial1.available()) {
        Serial.write(Serial1.read());
    }
}
