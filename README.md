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

### Eve and Home+ extras

Users of [Eve](https://www.evehome.com/en/eve-app) or [Home+](https://hochgatterer.me/home+/) get three additional read-only fields on the Pump, populated from device telemetry:

| Characteristic | Description |
|---|---|
| Last Watered | Timestamp of the most recent pump run |
| Next Watering | Timestamp of the next scheduled run |
| Last Watering Reason | What triggered the last run: 0 = none, 1 = interrupted, 2 = manual, 3 = cycle, 4 = scheduled |

These use custom UUIDs and are invisible in Apple Home.

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

HomeKit has no native schedule editor for irrigation, but Home app **Automations** work great as a replacement and are more flexible than the LetPot app's built-in scheduler. You can add conditions (e.g. only on weekdays, only when someone is home), use different durations on different days, chain multiple actions, or trigger Shortcuts. If you set up HomeKit automations, disable the corresponding schedule in the LetPot app to avoid both firing at the same time.

**Fixed duration (simplest)**

1. In the Home app, tap the Pump tile and adjust the **duration** slider to your desired run time (e.g. 15 minutes). This value is saved to the device.
2. Create a time-based automation at your desired start time (e.g. 06:00) with the action: turn the **Pump** on.
3. The pump runs for the configured duration and turns off automatically — no second automation needed.

**Variable duration (e.g. longer on weekends)**

Set the Pump duration slider to a value longer than your longest intended watering window (e.g. 60 minutes). Then create two automations per schedule:

- **On** automation at 06:00 → turn Pump on
- **Off** automation at 06:15 (or 06:30 on weekends, etc.) → turn Pump off

The off automation controls the actual run time; the 60-minute duration acts as a safety backstop and never triggers as long as the off automation fires first.

## Automation cookbook

A few ideas for what you can do once the plugin is running. All of these use the Home app's built-in Automations tab unless noted.

### Watering notifications

The "Watering Started" and "Watering Ended" stateless switches fire a single-press event every time the pump turns on or off.

**Simplest — native Home notification**

Long-press the **Watering Started** tile → tap the settings icon (gear) → enable **Allow Notifications**. HomeKit will send a push notification whenever the switch fires. Repeat for **Watering Ended**. Each is independently toggleable.

**Custom message — via Shortcuts**

1. In the Shortcuts app, create a shortcut with a **Send Notification** action and your desired message (e.g. "Watering started").
2. In the Home app, go to **Automations → Add Automation** and choose **An Accessory is Controlled**.
3. Select **Watering Started**, then **Single Press**.
4. Set the action to **Run Shortcut** and pick the shortcut you created.
5. Repeat for **Watering Ended** with a separate shortcut.

### Low water alert

The "Low Water" leak sensor triggers HomeKit's built-in leak notifications automatically — no automation needed. Just go to the sensor's settings in the Home app and make sure **Allow Notifications** is enabled.

### "Water my plants" Siri shortcut

You can already say "Hey Siri, turn on Pump" and it works. For something more natural, open the **Shortcuts** app, create a shortcut that turns the Pump on via HomeKit, and name it "Water my plants." Siri will run it on command.

### Morning watering scene

Create a scene called "Good Morning" that turns the Pump on alongside other actions (lights, coffee maker, etc.). The pump runs for its configured duration and shuts off on its own.

### Vacation mode

Before leaving for a trip, run a "Leaving for a few days" shortcut or scene that:

- Turns **Cycle Watering** on (so the device waters on its own schedule while you are away)
- Optionally bumps the Pump duration to a longer value for deeper watering

Pair it with a **Low Water** notification so you know if the tank runs dry while you are gone.

### Skip watering when it rains

If you have a weather station or rain sensor in HomeKit (e.g. Netatmo, Eve Weather, Ecowitt), you can add a condition to your watering automation:

- Trigger: time (e.g. 06:00)
- Condition: **Rain Sensor** is not active (or humidity below a threshold)
- Action: turn Pump on

This keeps the automation but prevents watering after rainfall without any manual intervention.

### Child bridge (isolation)

If Homebridge hosts other plugins and you want to isolate a crash, you can run homebridge-letpot as a **Child Bridge**. In the Homebridge UI, go to the plugin settings and enable **Child Bridge**. The plugin gets its own process — a crash or restart does not affect the rest of your accessories.

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
