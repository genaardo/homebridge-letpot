# Changelog

## v0.4.1 - 2026-05-02

- docs: document Eve/Home+ custom characteristics
- feat: add Eve/Home+ custom characteristics for last watered, next watering, and watering reason
- docs: add automation cookbook to README
- docs: correct CHANGELOG to match actual release history
- chore: add ESLint, CHANGELOG, and CI concurrency
- chore: update author name


## v0.4.0 - 2026-05-02

Improved HomeKit service names and notification model.

- Rename Valve service to "Pump" and Switch service to "Cycle Watering" to match LetPot app terminology
- Replace motion sensors ("Pump Started" / "Pump Stopped") with stateless programmable switches ("Watering Started" / "Watering Ended") that fire a single-press event on each pump transition — use these to trigger automations or notifications in the Home app, Eve, or Home+
- Add ConfiguredName characteristic to all services so the Home app displays correct tile names
- Remove "Intermittent Mode" switch — watering mode is preserved internally and remains configurable from the LetPot app
- Remove notifyPumpOn / notifyPumpOff config options (no longer needed)
- Automatically remove stale services from previous plugin versions on first launch
- Add GitHub Actions for CI and automated releases

## v0.1.2 - 2026-04-28

- Remove peerDependencies so homebridge and hap-nodejs are not auto-installed alongside the plugin (npm 7+ behaviour)
- Declare Homebridge compatibility via engines.homebridge instead

## v0.1.1 - 2026-04-27

- Fix config schema: move required fields to array at object level (valid JSON Schema)
- Remove homebridge and hap-nodejs from devDependencies to prevent duplicate installs

## v0.1.0 - 2026-04-26

Initial release supporting LetPot DI-2 (ISE05) and DI-3 (ISE06).

- Valve service (irrigation) — scheduled watering on/off, pump running indicator, manual run duration and countdown
- Switch "Auto Cycle" — enable/disable automated cycling schedule
- Switch "Intermittent Mode" — continuous vs. intermittent cycle mode
- Leak Sensor "Low Water" — water level alert
- Optional motion sensors for pump start/stop notifications
- Real-time updates via LetPot cloud MQTT broker
- Automatic access token refresh every 50 minutes
