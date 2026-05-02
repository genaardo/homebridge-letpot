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
| **Valve** "Pump" | Active | Enable / disable scheduled watering (`pump_mode`) |
| | In Use | Live indicator — pump is currently running |
| | Set Duration | Manual run duration in seconds |
| | Remaining Duration | Countdown to end of current watering run |
| **Switch** "Cycle Watering" | On | Enable / disable the automated cycling schedule |
| **Leak Sensor** "Low Water" | Leak Detected | Fires when the device reports low water |
| **Stateless Switch** "Watering Started" | Single Press | Fires each time the pump turns on |
| **Stateless Switch** "Watering Ended" | Single Press | Fires each time the pump turns off |

The two stateless switches ("Watering Started" / "Watering Ended") are designed for automations and notifications. In the Home app or a third-party app like Eve or Home+, create an automation triggered by a single press on either switch — for example, to send a notification or run a shortcut whenever watering begins or ends.

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

## Scheduling watering via HomeKit

HomeKit has no native schedule editor for irrigation, but Home app **Automations** work great as a replacement and are more flexible than the LetPot app's built-in scheduler:

1. In the Home app, tap the Pump tile, then adjust the **duration** slider to your desired watering duration (e.g. 15 minutes). This value is saved to the device.
2. Go to **Automations** and create a time-based automation at your desired start time (e.g. 06:00) with the action: turn the **Pump** on.
3. The HomeKit hub (HomePod or Apple TV) will automatically turn the Pump off after the configured duration — no second automation needed.

You can add conditions (e.g. only on weekdays, only when someone is home), chain multiple actions, or trigger Shortcuts — none of which are possible in the LetPot app. If you set up HomeKit automations, disable the corresponding schedule in the LetPot app to avoid both firing at the same time.

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
