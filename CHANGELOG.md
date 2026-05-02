# Changelog

## v0.4.0 - 2026-05-02

- Update author name

## v0.3.0 - 2026-05-02

- Add GitHub Actions workflows for CI and automated npm releases
- Add HomeKit automation scheduling guide to README
- Add guide for variable-duration watering schedules

## v0.2.0 - 2026-05-02

- Replace motion sensors with stateless programmable switches ("Watering Started" / "Watering Ended") for pump state events
- Rename Valve service to "Pump" and Switch service to "Cycle Watering" to match LetPot app terminology
- Add ConfiguredName characteristic to all services so the Home app displays correct names
- Remove "Intermittent Mode" switch (watering mode preserved internally)
- Remove notifyPumpOn / notifyPumpOff config options (no longer needed)
- Automatically clean up stale services from previous plugin versions on first launch

## v0.1.2 - 2026-04-28

- Remove peerDependencies to fix Homebridge verified plugin checks
- Move homebridge to devDependencies only so it is not installed by consumers

## v0.1.1 - 2026-04-27

- Fix Homebridge verification: correct config.schema.json required field format
- Fix Homebridge verification: remove hap-nodejs from dependencies

## v0.1.0 - 2026-04-26

- Initial release
- Support for LetPot DI-2 (ISE05) and DI-3 (ISE06) watering systems
- Valve service with Active, In Use, Set Duration, and Remaining Duration
- Cycle Watering switch
- Low Water leak sensor
- Real-time updates via LetPot cloud MQTT broker
- Automatic token refresh every 50 minutes
