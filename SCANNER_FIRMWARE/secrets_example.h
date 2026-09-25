// Template for secrets.h — copy this file to secrets.h (same folder) and fill it in.
// secrets.h is ignored by git (.gitignore: secrets.*), so real values stay on your PC.
#pragma once

// Packing-area Wi-Fi the scanner joins.
const char* WIFI_SSID     = "your-wifi-name";
const char* WIFI_PASSWORD = "your-wifi-password";

// Optional shared secret. Leave "" unless you set ASSEMBLY_DEVICE_KEY on the
// backend; then put the same value here.
const char* DEVICE_KEY    = "";
