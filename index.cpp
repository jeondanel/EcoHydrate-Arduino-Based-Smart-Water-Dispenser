#include <LiquidCrystal_I2C.h>
#include <Servo.h>

// Initialize the LCD with I2C address 0x27, 16 columns, and 2 rows
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Servo objects for water valve and bottle chamber door
Servo waterValveServo;
Servo doorServo;

// Pin Definitions
const int mainButtonPin = 2;       // Power toggle & reboot button
const int greenButtonPin = 3;      // Dispense / Resume button
const int redButtonPin = 4;        // Pause / Halt button
const int doorServoPin = 5;        // Servo motor for the drop door
const int servoPin = 6;            // Servo motor for the water valve
const int capacitivePin = 7;       // Capacitive sensor
const int irPin = 8;               // IR sensor
const int trigPin = 9;             // Ultrasonic trig pin (Bin detection)
const int echoPin = 10;            // Ultrasonic echo pin (Bin detection)
const int waterLevelPin = 11;      // Water level sensor pin

// Configurations
const unsigned long BASE_DISPENSE_DURATION = 10000; // 1 token = 10 seconds (10000ms)
const int BIN_FULL_THRESHOLD_CM = 10;               // Bin is considered full if distance < 10cm

// System States
enum SystemState {
  STATE_OFF,
  STATE_STARTUP,
  STATE_IDLE,
  STATE_VERIFYING,
  STATE_DISPENSING,
  STATE_PAUSED
};

SystemState currentState = STATE_OFF;
int tokens = 0;
bool bottleRemoved = true; // Ensures the bottle is removed before verifying again

// LCD tracking variables for Serial mirroring
String currentLcdRow0 = "";
String currentLcdRow1 = "";

// Dispensing tracking
unsigned long dispenseStartTime = 0;
unsigned long dispenseElapsedTime = 0;
unsigned long currentDispenseDuration = 0; // Total stacked duration for the active run

// Verification tracking
unsigned long verificationStartTime = 0;
const unsigned long VERIFICATION_DURATION = 1500; // 1.5 seconds to verify

// Timer for non-blocking periodic checks in IDLE and OFF states
unsigned long lastStatusCheckTime = 0;
const unsigned long STATUS_CHECK_INTERVAL = 1000; // Check bin/water level every 1 second

// Helper struct for debouncing and detecting single/double clicks
struct Button {
  int pin;
  bool lastState;
  unsigned long lastDebounceTime;
  unsigned long lastPressTime;
  int pressCount;
  bool singleClicked;
  bool doubleClicked;

  Button(int p) : pin(p), lastState(HIGH), lastDebounceTime(0), lastPressTime(0), pressCount(0), singleClicked(false), doubleClicked(false) {}

  void init() {
    pinMode(pin, INPUT_PULLUP);
  }

  void update() {
    bool reading = digitalRead(pin);
    unsigned long now = millis();
    singleClicked = false;
    doubleClicked = false;

    // Detect state changes
    if (reading != lastState) {
      lastDebounceTime = now;
    }

    if ((now - lastDebounceTime) > 50) { // 50ms debounce time
      // If button state changed from HIGH to LOW (pressed)
      if (reading == LOW && lastState == HIGH) {
        if (now - lastPressTime < 400) { // 400ms double-click window
          pressCount++;
        } else {
          pressCount = 1;
        }
        lastPressTime = now;
      }
    }

    lastState = reading;

    // Check for click triggers after window expires
    if (pressCount > 0 && (now - lastPressTime) > 250) {
      if (pressCount == 1) {
        singleClicked = true;
      } else if (pressCount >= 2) {
        doubleClicked = true;
      }
      pressCount = 0;
    }
  }
};

// Instantiate buttons
Button mainBtn(mainButtonPin);
Button greenBtn(greenButtonPin);
Button redBtn(redButtonPin);

// Function pointer to address 0 for software reboot
void (*reboot)() = 0;

// Helper to check water level (active-LOW: LOW indicates water is dry/low)
bool isWaterLow() {
  return digitalRead(waterLevelPin) == LOW;
}

// Helper to measure distance to trash in the bin using ultrasonic sensor
bool isBinFull() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  
  long duration = pulseIn(echoPin, HIGH, 25000); // 25ms timeout (~4m max range)
  if (duration == 0) return false;
  
  long distance = duration * 0.034 / 2;
  return (distance > 0 && distance < BIN_FULL_THRESHOLD_CM);
}

// Update LCD screen and simultaneously mirror contents to serial port
void updateLCD(String row0, String row1) {
  currentLcdRow0 = row0;
  currentLcdRow1 = row1;
  
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(row0);
  lcd.setCursor(0, 1);
  lcd.print(row1);
  
  sendSerialStatus();
}

// Helper to send real-time system status formatted as a JSON string over Serial
void sendSerialStatus() {
  Serial.print("{\"lcd0\":\"");
  Serial.print(currentLcdRow0);
  Serial.print("\",\"lcd1\":\"");
  Serial.print(currentLcdRow1);
  Serial.print("\",\"tokens\":");
  Serial.print(tokens);
  Serial.print(",\"water_low\":");
  Serial.print(isWaterLow() ? "true" : "false");
  Serial.print(",\"bin_full\":");
  Serial.print(isBinFull() ? "true" : "false");
  Serial.print(",\"state\":");
  Serial.print(currentState);
  Serial.println("}");
}

void setup() {
  // Initialize Serial communication
  Serial.begin(9600);

  // Initialize LCD
  lcd.init();
  lcd.noBacklight();

  // Attach servos and set to closed positions (0 degrees)
  waterValveServo.attach(servoPin);
  waterValveServo.write(0); // Valve closed

  doorServo.attach(doorServoPin);
  doorServo.write(0); // Door closed (holding bottle for verification)

  // Initialize sensors
  pinMode(capacitivePin, INPUT);
  pinMode(irPin, INPUT_PULLUP);
  pinMode(waterLevelPin, INPUT_PULLUP);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);

  // Initialize buttons
  mainBtn.init();
  greenBtn.init();
  redBtn.init();

  // Initial state notification
  sendSerialStatus();
}

void loop() {
  // Update button states
  mainBtn.update();
  greenBtn.update();
  redBtn.update();

  // Failsafe reboot check on main button double-click (active in any state)
  if (mainBtn.doubleClicked) {
    updateLCD("Rebooting...", "");
    delay(1000);
    reboot();
  }

  // Handle system behavior based on state
  switch (currentState) {
    case STATE_OFF:
      // If main button is single-clicked, power on
      if (mainBtn.singleClicked) {
        currentState = STATE_STARTUP;
        sendSerialStatus();
      }
      // Periodically read sensors and send status updates even when off
      if (millis() - lastStatusCheckTime >= STATUS_CHECK_INTERVAL) {
        lastStatusCheckTime = millis();
        sendSerialStatus();
      }
      break;

    case STATE_STARTUP:
      lcd.backlight();
      updateLCD("EcoHydrate", "Bottling up");
      delay(2000); // Startup message duration
      
      currentState = STATE_IDLE;
      showIdleScreen();
      break;

    case STATE_IDLE:
      // Check if main button is single-clicked to power off
      if (mainBtn.singleClicked) {
        powerOff();
        break;
      }

      // Periodically refresh/check device warnings and broadcast status
      if (millis() - lastStatusCheckTime >= STATUS_CHECK_INTERVAL) {
        lastStatusCheckTime = millis();
        showIdleScreen();
      }

      // Only allow bottle insertion if the bin is not full
      if (digitalRead(irPin) == LOW) {
        if (bottleRemoved) {
          if (isBinFull()) {
            updateLCD("Bin is full!", "");
            delay(2000);
            showIdleScreen();
          } else {
            currentState = STATE_VERIFYING;
            verificationStartTime = millis();
            updateLCD("Verifying", "");
            doorServo.write(0); // Ensure door is closed to hold the bottle
          }
        }
      } else {
        bottleRemoved = true; // Reset bottle removed state when IR is HIGH
      }

      // Check for dispense attempt
      if (greenBtn.singleClicked) {
        if (isWaterLow()) {
          updateLCD("Water low", "please refill");
          delay(2000);
          showIdleScreen();
        } else if (tokens > 0) {
          // Stack all accumulated tokens into the dispensing session
          int tokensToSpend = tokens;
          tokens = 0; 
          currentDispenseDuration = tokensToSpend * BASE_DISPENSE_DURATION;
          
          currentState = STATE_DISPENSING;
          dispenseStartTime = millis();
          dispenseElapsedTime = 0;
          waterValveServo.write(90); // Open valve
          updateLCD("Dispensing...", "");
        } else {
          // Flash error message
          updateLCD("No tokens. Please", "insert a bottle.");
          delay(2000);
          showIdleScreen();
        }
      }
      break;

    case STATE_VERIFYING:
      // Non-blocking wait for verification to finish
      if (millis() - verificationStartTime >= VERIFICATION_DURATION) {
        // Read sensors at the end of the verification window
        bool isIRDetected = (digitalRead(irPin) == LOW);
        bool isCapacitiveDetected = (digitalRead(capacitivePin) == HIGH);

        // Verification condition: Both IR presence and Capacitive plastic/non-metal sensing
        if (isIRDetected && isCapacitiveDetected) {
          tokens++;
          updateLCD("Bottle Added!", "");
          
          // Open door to drop verified bottle
          doorServo.write(90);
          delay(2000); // Wait for bottle to drop
          doorServo.write(0);  // Close door again
        } else {
          updateLCD("Failed! Not a", "plastic bottle");
          delay(2000);
        }
        
        bottleRemoved = false; // Block immediate re-trigger until bottle is removed
        currentState = STATE_IDLE;
        showIdleScreen();
      }
      break;

    case STATE_DISPENSING:
      {
        unsigned long currentElapsed = millis() - dispenseStartTime + dispenseElapsedTime;

        // Check if dispensing finished
        if (currentElapsed >= currentDispenseDuration) {
          waterValveServo.write(0); // Close valve
          currentState = STATE_IDLE;
          showIdleScreen();
          break;
        }

        // Allow adding new tokens during dispensing
        if (greenBtn.singleClicked && tokens > 0) {
          currentDispenseDuration += (tokens * BASE_DISPENSE_DURATION);
          tokens = 0;
          updateLCD("Dispensing...", "");
        }

        // Check for Red Button actions
        if (redBtn.doubleClicked) {
          // Halt dispensing completely
          waterValveServo.write(0); // Close valve
          currentState = STATE_IDLE;
          showIdleScreen();
        } else if (redBtn.singleClicked) {
          // Pause dispensing
          waterValveServo.write(0); // Close valve
          dispenseElapsedTime = currentElapsed;
          currentState = STATE_PAUSED;
          updateLCD("Dispense Paused", "");
        }
      }
      break;

    case STATE_PAUSED:
      // Red button double-press halts dispensing completely
      if (redBtn.doubleClicked) {
        currentState = STATE_IDLE;
        showIdleScreen();
      }
      // Green button single-press resumes dispensing (if water is not low)
      else if (greenBtn.singleClicked) {
        if (isWaterLow()) {
          updateLCD("Water low", "please refill");
          delay(2000);
        } else {
          // If they added tokens while paused, stack them before resuming
          if (tokens > 0) {
            currentDispenseDuration += (tokens * BASE_DISPENSE_DURATION);
            tokens = 0;
          }
          currentState = STATE_DISPENSING;
          dispenseStartTime = millis();
          waterValveServo.write(90); // Open valve
          updateLCD("Dispensing...", "");
        }
      }
      break;
  }
}

// Display the default idle screen layout or warnings if triggered
void showIdleScreen() {
  if (isWaterLow()) {
    updateLCD("Water low", "please refill");
  } else if (isBinFull()) {
    updateLCD("Bin is full!", "");
  } else {
    updateLCD("Insert Bottle", "Token: " + String(tokens));
  }
}

// Power off utility
void powerOff() {
  waterValveServo.write(0); // Ensure valve is closed
  doorServo.write(0);       // Ensure chamber door is closed
  
  currentLcdRow0 = "SYSTEM OFF";
  currentLcdRow1 = "";
  lcd.clear();
  lcd.noBacklight();
  currentState = STATE_OFF;
  sendSerialStatus();
}