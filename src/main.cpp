#include <Arduino.h>

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <SPIFFS.h>
#include <Wire.h>
#include <SparkFun_MAX1704x_Fuel_Gauge_Arduino_Library.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

/* ================= CONFIGURATION ================= */
const char* ssid = "BharatMaint";
const char* password = "MCUESP8266";

// Pins
#define SDA_PIN 21
#define SCL_PIN 22
#define ONE_WIRE_BUS 4
#define BUZZER_PIN 5

// Thresholds
#define LOW_SOC_THRESHOLD 20.0
#define HIGH_TEMP_THRESHOLD 45.0
#define LOW_TEMP_THRESHOLD 5.0

// OLED
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDR 0x3C

/* ================= OBJECTS ================= */
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
SFE_MAX1704X fuelGauge;
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);
WebServer server(80);

/* ================= SHARED DATA ================= */
struct SharedData {
  float voltage;
  float soc;
  float temp;
  float soh;
  String status;
  bool isCharging;
};

SharedData currentData;
SemaphoreHandle_t dataMutex;

/* ================= CORE 0 TASK ================= */
void TaskCore0(void *pvParameters) {

  Wire.begin(SDA_PIN, SCL_PIN);

  fuelGauge.begin();
  if (fuelGauge.isReset()) fuelGauge.quickStart();

  sensors.begin();

  display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  display.setTextColor(SSD1306_WHITE);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  for (;;) {

    float voltage = fuelGauge.getVoltage();
    float soc = fuelGauge.getSOC();

    sensors.requestTemperatures();
    float temperature = sensors.getTempCByIndex(0);

    float soh = (voltage / 4.20) * 100.0;
    if (soh > 100) soh = 100;
    if (soh < 0) soh = 0;

    // Determine if the battery is charging (voltage is around 4.2V when charging, 3.8V when discharging)
    bool isCharging = (voltage >= 4.0);

    String status = "NORMAL";
    if (soc < LOW_SOC_THRESHOLD) status = "LOW BATTERY";
    else if (temperature > HIGH_TEMP_THRESHOLD) status = "OVER TEMP";
    else if (temperature < LOW_TEMP_THRESHOLD) status = "LOW TEMP";

    /* ---------- BUZZER ---------- */
    if (status != "NORMAL") {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
    }

    /* ================= OLED DISPLAY (REFINED) ================= */
    display.clearDisplay();

    display.setTextSize(1);
    display.setCursor(28, 0);
    display.println("Battery Monitor");

    display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

    display.setCursor(0, 14);
    display.print("V: ");
    display.print(voltage, 2);
    display.println(" V");

    // Display charging status next to voltage
    display.setCursor(70, 14);
    display.print("Chg: ");
    display.print(isCharging ? "Yes" : "No");

    display.setCursor(0, 26);
    display.print("SOC: ");
    display.print(soc, 1);
    display.println(" %");

    display.setCursor(0, 38);
    display.print("SOH: ");
    display.print(soh, 1);
    display.println(" %");

    display.setCursor(70, 38);
    display.print("T: ");
    display.print(temperature, 1);
    display.println(" C");

    display.drawLine(0, 50, 127, 50, SSD1306_WHITE);

    display.setCursor(0, 54);
    display.print("Status: ");
    display.println(status);

    display.display();
    /* ========================================================== */

    if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
      currentData.voltage = voltage;
      currentData.soc = soc;
      currentData.temp = temperature;
      currentData.soh = soh;
      currentData.status = status;
      currentData.isCharging = isCharging;
      xSemaphoreGive(dataMutex);
    }

    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

/* ================= FILE HANDLER ================= */
void handleFile(String path, String type) {
  if (SPIFFS.exists(path)) {
    File f = SPIFFS.open(path, "r");
    server.streamFile(f, type);
    f.close();
  } else {
    server.send(404, "text/plain", "File Not Found");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000); // Give serial monitor time to connect
  Serial.println("\n--- ESP32 Battery Monitor Setup ---");

  dataMutex = xSemaphoreCreateMutex();
  
  Serial.print("Initializing SPIFFS... ");
  if (SPIFFS.begin(true)) {
    Serial.println("success");
  } else {
    Serial.println("failed!");
  }

  Serial.print("Connecting to WiFi (SSID: ");
  Serial.print(ssid);
  Serial.print(")");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  if (MDNS.begin("ev-bms")) {
    Serial.println("mDNS responder started: http://ev-bms.local");
  }

  server.on("/", HTTP_GET, []() { handleFile("/index.html", "text/html"); });
  server.on("/style.css", HTTP_GET, []() { handleFile("/style.css", "text/css"); });
  server.on("/script.js", HTTP_GET, []() { handleFile("/script.js", "application/javascript"); });
  server.on("/background.jpg", HTTP_GET, []() { handleFile("/background.jpg", "image/jpeg"); });

  server.on("/api/data", HTTP_GET, []() {
    xSemaphoreTake(dataMutex, portMAX_DELAY);
    String json = "{";
    json += "\"voltage\":" + String(currentData.voltage, 2) + ",";
    json += "\"soc\":" + String(currentData.soc, 1) + ",";
    json += "\"soh\":" + String(currentData.soh, 1) + ",";
    json += "\"temp\":" + String(currentData.temp, 1) + ",";
    json += "\"status\":\"" + currentData.status + "\",";
    json += "\"charging\":" + String(currentData.isCharging ? "true" : "false") + ",";
    json += "\"uptime\":" + String(millis() / 1000) + "}";
    xSemaphoreGive(dataMutex);

    server.send(200, "application/json", json);
  });

  server.begin();
  Serial.println("HTTP server started");

  xTaskCreatePinnedToCore(
    TaskCore0,
    "SensorOLED",
    10000,
    NULL,
    1,
    NULL,
    0
  );
  Serial.println("Sensor and OLED Task started on Core 0");
}

void loop() {
  server.handleClient();
  delay(2);
}
