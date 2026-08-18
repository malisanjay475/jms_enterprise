// =====================================================
// ESP32 Packing Scanner — DIRECT PUSH firmware
// -----------------------------------------------------
// The scanner reads a barcode over UART and POSTs it straight to the JMS
// backend. No local PC / bridge is required and the scanner works with every
// browser page closed.
//
// Why push instead of the old TCP-server design:
// the packing WiFi is a separate NAT subnet (192.168.0.x). The backend PC on
// 192.168.1.x cannot connect INTO the scanner, but the scanner CAN reach OUT
// to the backend. So the ESP32 initiates the connection and pushes each scan.
//
// Backend endpoint (added in registerLegacyRoutes.js):
//   POST /api/assembly/device-scan   Body: {"table_id":"...","ean":"..."}
//   -> backend resolves the table's active plan (newest RUNNING) and records it.
//
// Wiring (unchanged): Scanner TX -> GPIO16 (RX), Scanner RX -> GPIO17 (TX), GND->GND
// =====================================================

#include <WiFi.h>
#include <HTTPClient.h>

// ============ CONFIG — EDIT THESE ============
const char* WIFI_SSID     = "B Packing";
const char* WIFI_PASSWORD = "Joyo@2525";

// Backend the scanner posts to. Use the LAN IP of the JMS LOCAL server that is
// reachable from the packing network (recommended). Only use a public IP if you
// have port-forwarding + NAT hairpin set up.
const char* BACKEND_HOST  = "192.168.1.173";   // JMS LOCAL server (jms-factory-1)
const int   BACKEND_PORT  = 3001;

// Which assembly line / table this scanner belongs to. MUST match the
// assembly_lines.line_id in the app (e.g. seen in the app as "Table B1").
const char* TABLE_ID      = "Table B1";

// Optional shared secret. Leave "" unless you set ASSEMBLY_DEVICE_KEY on the
// backend; then put the same value here.
const char* DEVICE_KEY    = "";
// =============================================

// Barcode Scanner UART (ESP32-WROOM-32)
#define SCANNER_RX 16
#define SCANNER_TX 17
HardwareSerial scannerSerial(2);

String barcodeBuffer = "";
unsigned long lastCharTime = 0;
const unsigned long SILENCE_GAP = 50; // ms — flush if scanner sends no CR/LF

// -----------------------------------------------------
void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (++attempts >= 40) {           // ~20s, then bail and retry from loop()
      Serial.println();
      Serial.println("[WiFi] Not connected yet, will retry.");
      return;
    }
  }
  Serial.println();
  Serial.print("[WiFi] Connected. IP: ");
  Serial.println(WiFi.localIP());
}

// JSON-escape a barcode value (handles quotes/backslashes just in case).
String jsonEscape(const String& s) {
  String out = "";
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c == '\n' || c == '\r') { /* skip */ }
    else out += c;
  }
  return out;
}

void sendScan(const String& code) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi down, dropping scan (will reconnect).");
    return;
  }

  HTTPClient http;
  String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/assembly/device-scan";

  http.begin(url);
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_KEY) > 0) http.addHeader("x-device-key", DEVICE_KEY);

  String body = String("{\"table_id\":\"") + jsonEscape(TABLE_ID) +
                "\",\"ean\":\"" + jsonEscape(code) + "\"}";

  int status = http.POST(body);
  if (status > 0) {
    Serial.print("[HTTP] ");
    Serial.print(status);
    Serial.print(" -> ");
    Serial.println(http.getString());
  } else {
    Serial.print("[HTTP] POST failed: ");
    Serial.println(http.errorToString(status));
  }
  http.end();
}

void processBarcode() {
  barcodeBuffer.trim();
  if (barcodeBuffer.length() == 0) { barcodeBuffer = ""; return; }

  Serial.print("[SCAN] ");
  Serial.println(barcodeBuffer);
  sendScan(barcodeBuffer);
  barcodeBuffer = "";
}

// -----------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("=== ESP32 Packing Scanner (direct push) ===");
  Serial.print("[CFG] Table: "); Serial.println(TABLE_ID);
  Serial.print("[CFG] Backend: http://"); Serial.print(BACKEND_HOST);
  Serial.print(":"); Serial.println(BACKEND_PORT);

  scannerSerial.begin(9600, SERIAL_8N1, SCANNER_RX, SCANNER_TX);
  Serial.println("[UART] Scanner ready @9600 (RX=16, TX=17)");

  ensureWifi();
}

void loop() {
  ensureWifi();  // reconnect if WiFi dropped

  // Read scanner UART
  while (scannerSerial.available()) {
    char c = scannerSerial.read();
    if (c == '\r') continue;
    if (c == '\n') { if (barcodeBuffer.length() > 0) processBarcode(); continue; }
    barcodeBuffer += c;
    lastCharTime = millis();
  }

  // Flush if the scanner didn't send a newline
  if (barcodeBuffer.length() > 0 && millis() - lastCharTime > SILENCE_GAP) {
    processBarcode();
  }

  delay(1);
}
