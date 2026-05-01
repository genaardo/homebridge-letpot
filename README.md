# homebridge-letpot

[![npm](https://img.shields.io/npm/v/homebridge-letpot)](https://www.npmjs.com/package/homebridge-letpot)
[![npm](https://img.shields.io/npm/dt/homebridge-letpot)](https://www.npmjs.com/package/homebridge-letpot)
[![GitHub](https://img.shields.io/github/license/genaardo/homebridge-letpot)](LICENSE)

A [Homebridge](https://homebridge.io) plugin for the [LetPot Automatic Plant Watering System](https://letpot.com/products/automatic-plant-watering-system), bringing it into Apple HomeKit.

Supports the **DI-2 (ISE05)** and **DI-3 (ISE06)** models.

## Features

Each device is exposed to HomeKit as a set of services:

| Service | Characteristic | Description |
|---|---|---|
| **Valve** (Irrigation) | Active | Enable / disable scheduled watering (`pump_mode`) |
| | In Use | Live indicator — pump is currently running |
| | Set Duration | Manual run duration in seconds |
| | Remaining Duration | Countdown to end of current watering run |
| **Switch** "Auto Cycle" | On | Enable / disable the automated cycling schedule |
| **Switch** "Intermittent Mode" | On | Toggle between continuous and intermittent cycle mode |
| **Leak Sensor** "Low Water" | Leak Detected | Fires when the device reports low water |
| **Motion Sensor** "Pump Started" | Motion Detected | Pulses for 5 s each time the pump turns on *(optional)* |
| **Motion Sensor** "Pump Stopped" | Motion Detected | Pulses for 5 s each time the pump turns off *(optional)* |

The two motion sensors are designed for notifications. Once added to the Home app, go to each sensor's settings and enable **Allow Notifications** — iOS will then alert you whenever the pump starts or stops. Each sensor is independently enabled via `notifyPumpOn` / `notifyPumpOff` in the plugin config (both default to `true`).

The plugin uses LetPot's cloud MQTT broker for real-time push updates, so state changes in the LetPot iOS app are reflected in HomeKit immediately.

## Requirements

- [Homebridge](https://homebridge.io) ≥ 1.8.0
- Node.js 18, 20, 22, or 24
- A LetPot account with at least one watering system paired

## Installation

### Homebridge UI (recommended)

Search for **LetPot** in the Homebridge UI plugin search and click **Install**.

### Command line

```bash
npm install -g homebridge-letpot
```

### Homebridge Docker (manual install)

If your Homebridge runs in Docker and you want to install from source:

1. **Clone and build:**
   ```bash
   git clone https://github.com/genaardo/homebridge-letpot.git
   cd homebridge-letpot
   npm install && npm run build && npm pack
   ```

2. **Copy to your Homebridge host:**
   ```bash
   scp homebridge-letpot-*.tgz user@host:/path/to/homebridge/volumes/homebridge/
   ```

3. **Install inside the container:**
   ```bash
   docker exec <container> sh -c "cd /homebridge && npm install /homebridge/homebridge-letpot-*.tgz"
   docker restart <container>
   ```

## Configuration

Add the platform to your Homebridge `config.json`, or configure it through the Homebridge UI:

```json
{
  "platforms": [
    {
      "platform": "LetPot",
      "name": "LetPot",
      "email": "your@email.com",
      "password": "yourpassword"
    }
  ]
}
```

### Options

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `platform` | string | Yes | — | Must be `"LetPot"` |
| `name` | string | Yes | — | Display name |
| `email` | string | Yes | — | Your LetPot account email |
| `password` | string | Yes | — | Your LetPot account password |
| `notifyPumpOn` | boolean | No | `true` | Add "Pump Started" motion sensor |
| `notifyPumpOff` | boolean | No | `true` | Add "Pump Stopped" motion sensor |

## How it works

1. On startup the plugin authenticates with the LetPot REST API (`api.letpot.net`) using your email and password to obtain access and refresh tokens.
2. It fetches your device list and registers each ISE05/ISE06 watering system as a Homebridge accessory.
3. It opens an MQTT-over-WebSocket connection to `broker.letpot.net` and subscribes to each device's status topic for real-time push updates.
4. Controlling a service in HomeKit publishes a command message back over the same MQTT connection.
5. Access tokens are refreshed every 50 minutes in the background; the MQTT client reconnects automatically on drop.

## Development

```bash
npm install       # install dependencies
npm run build     # compile TypeScript → dist/
npm run watch     # watch mode
npm pack          # create distributable tarball
```

## Acknowledgements

Protocol reverse-engineered from [python-letpot](https://github.com/jpelgrom/python-letpot) by [@jpelgrom](https://github.com/jpelgrom), which also powers the official [Home Assistant LetPot integration](https://www.home-assistant.io/integrations/letpot/).

## License

MIT
