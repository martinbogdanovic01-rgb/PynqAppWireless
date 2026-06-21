/*
 * ESP32 BLE-to-UART Bridge for PYNQ-Z2 Audio Controller
 *
 * Receives BLE writes from the PynqAppWireless app and forwards
 * them over UART to the PYNQ at 9600 baud (AXI UART Lite fixed rate).
 * Uses Serial1 (UART1) for PYNQ — keeps BLE stack debug off the PYNQ line.
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
#include <esp_gap_ble_api.h>   /* esp_ble_conn_update_params_t, esp_ble_gap_update_conn_params */

#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHARACTERISTIC_UUID "abcd1234-ab12-ab12-ab12-abcdef123456"

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;

class MyServerCallbacks : public BLEServerCallbacks {
    /* Two-argument override gives us the remote BD address so we can
     * send a connection parameter update request immediately.
     * iOS minimum allowed interval for non-MFi accessories is 15 ms.
     * Without this, iOS defaults to ~1–2 s intervals after initial setup. */
    void onConnect(BLEServer *pServer, esp_ble_gatts_cb_param_t *param) override {
        deviceConnected = true;

        /* Clear any stale value left from a previous session */
        pCharacteristic->setValue("");

        esp_ble_conn_update_params_t conn_params = {};
        memcpy(conn_params.bda, param->connect.remote_bda, sizeof(esp_bd_addr_t));
        conn_params.latency  = 0;
        conn_params.max_int  = 0x0010;  /* 20 ms  (16 × 1.25 ms) */
        conn_params.min_int  = 0x000C;  /* 15 ms  (12 × 1.25 ms) — iOS floor */
        conn_params.timeout  = 400;     /* 4 000 ms supervision timeout */
        esp_ble_gap_update_conn_params(&conn_params);

        Serial.println("Device connected — requested 15 ms BLE interval");
    }
    void onDisconnect(BLEServer *pServer) override {
        deviceConnected = false;
        BLEDevice::startAdvertising();
        Serial.println("Device disconnected — restarting advertising");
    }
};

class MyCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pChar) override {
        String value = pChar->getValue().c_str();
        if (value.length() > 0) {
            Serial.print("-> PYNQ: ");
            Serial.println(value);
            Serial1.print(value);   /* forward to PYNQ over Serial1 */
        }
    }
};

void setup()
{
    Serial.begin(115200);
    Serial1.begin(9600, SERIAL_8N1, 20, 21);   /* must match AXI UART Lite baud in Vivado */
    delay(500);

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

    Serial.println("BLE ready — waiting for phone...");
}

void loop()
{
    /* Echo PYNQ responses to Serial Monitor for debugging */
    while (Serial1.available()) {
        Serial.write(Serial1.read());
    }
}
