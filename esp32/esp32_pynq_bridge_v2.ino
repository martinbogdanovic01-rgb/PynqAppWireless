/*
 * ESP32 BLE-to-UART Bridge for PYNQ-Z2 Audio Controller
 *
 * Receives BLE writes from the PynqAppWireless app and forwards
 * them over UART to the PYNQ at 9600 baud (AXI UART Lite fixed rate).
 * Uses Serial1 (UART1) for PYNQ — keeps BLE stack debug off the PYNQ line.
 *
 * FIX: PROPERTY_WRITE_NR added — iOS app writes without response,
 * characteristic must declare it or iOS silently drops the write.
 *
 * Wiring:
 *   ESP32 TX (GPIO21) -> PYNQ Arduino header pin 0 / AR0 (uart_rtl_rxd, T14)
 *   ESP32 RX (GPIO20) -> PYNQ Arduino header pin 1 / AR1 (uart_rtl_txd, U12)
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
        /* Request shorter connection interval for lower latency */
        BLEDevice::setMTU(23);
    }
    void onDisconnect(BLEServer *pServer) override {
        deviceConnected = false;
        BLEDevice::startAdvertising();
    }
};

class MyCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        String value = pChar->getValue().c_str();
        if (value.length() > 0) {
            Serial.print("Received from app: ");
            Serial.println(value);
            /* Forward directly — app now sends PYNQ commands (F0 F1 G1..G4 Vxx M U) */
            Serial1.print(value);
            Serial.print("Sent to PYNQ: ");
            Serial.println(value);
        }
    }
};

void setup()
{
    Serial.begin(115200);
    Serial1.begin(9600, SERIAL_8N1, 20, 21);   /* must match AXI UART Lite baud in Vivado */
    delay(1000);

    Serial.println("Starting BLE...");

    BLEDevice::init("PYNQ-Audio-Controller");
    BLEServer  *pServer  = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);

    pCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_WRITE    |   /* write with response    */
        BLECharacteristic::PROPERTY_WRITE_NR     /* write without response — iOS needs this */
    );
    pCharacteristic->setCallbacks(new MyCallbacks());

    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->start();

    Serial.println("BLE ready — waiting for phone connection...");
    Serial.println("Service UUID: " SERVICE_UUID);
}

void loop()
{
    /* Echo PYNQ responses (OK / ERROR / STATUS) to Serial Monitor */
    while (Serial1.available()) {
        Serial.write(Serial1.read());
    }
}
