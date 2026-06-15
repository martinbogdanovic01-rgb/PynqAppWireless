import Foundation
import CoreBluetooth

private let kServiceUUID        = CBUUID(string: "12345678-1234-1234-1234-123456789abc")
private let kCharacteristicUUID = CBUUID(string: "abcd1234-ab12-ab12-ab12-abcdef123456")
private let kDeviceName         = "PYNQ-Audio-Controller"

class BLEManager: NSObject, ObservableObject {

    @Published var isScanning   = false
    @Published var isConnected  = false
    @Published var statusMessage = "Disconnected"
    @Published var ledStates: [Bool] = [false, false, false, false]

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func startScan() {
        guard central.state == .poweredOn else {
            statusMessage = "Bluetooth not available"
            return
        }
        isScanning   = true
        statusMessage = "Scanning…"
        central.scanForPeripherals(withServices: [kServiceUUID], options: nil)
    }

    func disconnect() {
        guard let p = peripheral else { return }
        central.cancelPeripheralConnection(p)
    }

    func toggleLED(_ index: Int) {
        guard let char = writeChar, let p = peripheral else { return }
        let cmd  = "L\(index + 1)$"
        guard let data = cmd.data(using: .utf8) else { return }
        p.writeValue(data, for: char, type: .withoutResponse)
        ledStates[index].toggle()
    }
}

// MARK: - CBCentralManagerDelegate
extension BLEManager: CBCentralManagerDelegate {

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:  statusMessage = "Ready"
        case .poweredOff: statusMessage = "Bluetooth is off"
        default:          statusMessage = "Bluetooth unavailable"
        }
        if central.state != .poweredOn { isConnected = false }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        guard peripheral.name == kDeviceName else { return }
        self.peripheral = peripheral
        central.stopScan()
        isScanning    = false
        statusMessage  = "Connecting…"
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        isConnected   = true
        statusMessage  = "Connected"
        peripheral.delegate = self
        peripheral.discoverServices([kServiceUUID])
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        isConnected   = false
        self.peripheral = nil
        writeChar      = nil
        ledStates      = [false, false, false, false]
        statusMessage  = "Disconnected"
    }

    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        self.peripheral = nil
        statusMessage   = "Connection failed"
    }
}

// MARK: - CBPeripheralDelegate
extension BLEManager: CBPeripheralDelegate {

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        peripheral.services?
            .filter { $0.uuid == kServiceUUID }
            .forEach { peripheral.discoverCharacteristics([kCharacteristicUUID], for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        if let char = service.characteristics?.first(where: { $0.uuid == kCharacteristicUUID }) {
            writeChar     = char
            statusMessage  = "Ready"
        }
    }
}
