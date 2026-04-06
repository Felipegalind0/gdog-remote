# gdog-remote

Web controller for the gdog simulator.

The app sends drive and posture commands at 50 Hz to the simulator backend and works on desktop or phone.

## Features

- Two virtual joysticks (pointer, mouse, touch)
- Control mapping:
  - Left stick: forward/back (`vx`) + yaw (`omega`)
  - Right stick: pitch/roll normalized commands (`pitch_cmd`, `roll_cmd`)
- Sensitivity sliders for velocity and yaw
- WebSocket default transport with optional WebRTC data channel
- Backend target UI where you can type IP/host (for example `192.168.1.25:8000`)
- URL parameter override via `?backend=...`
- Backend target persistence in local storage
- Fullscreen mode and mobile gesture suppression for better two-thumb control

## Prerequisites

- Node.js 20+
- npm
- Simulator backend running from sibling repo (`gdog-sim`)

## Install

```bash
npm install
```

## Local Run

```bash
npm run dev
```

Open the URL shown by Vite (usually `http://localhost:5173`).

## Backend Target Configuration

The controller now supports three ways to choose backend host:

1. Type host/IP in the app and click "Apply backend"
2. Open with query parameter: `?backend=192.168.1.25:8000`
3. Reuse previously saved target from local storage

Accepted backend input examples:

- `192.168.1.25:8000`
- `my-mac.local:8000`
- `https://my-random-name.trycloudflare.com`
- `https://robot.example.com`
- `http://10.0.0.5:8000`

Port behavior:

- Plain host input (`192.168.1.25` or `my-mac.local`) defaults to port `8000`
- Explicit URL input (`https://...` or `http://...`) keeps URL-style defaults unless a port is explicitly included

### Important HTTPS Note

If this page is served over HTTPS (for example GitHub Pages), browsers block insecure backend requests.

- HTTPS page + HTTP backend = blocked (mixed content)
- Use HTTPS/WSS backend endpoint (reverse proxy or tunnel) when serving remote from GitHub Pages

## Control Model

- Left stick:
  - `X` axis -> `omega`
  - `Y` axis -> `vx`
- Right stick:
  - `X` axis -> `roll_cmd`
  - `Y` axis -> `pitch_cmd` (inverted for natural up/down feel)
- Preferred transport:
  - WebRTC data channel if connected
  - fallback to WebSocket

## Deploy To GitHub Pages (Deploy From Branch)

This repo is configured for branch-based Pages deployment.

### One-time GitHub Settings

1. Push this repository to GitHub.
2. Open repository Settings -> Pages.
3. Under "Build and deployment", set Source to "Deploy from a branch".
4. Select branch `gh-pages` and folder `/ (root)`.
5. Save.

### Deploy Command

```bash
npm run deploy
```

What this does:

- Runs `npm run build:pages` with Vite base path set to `/gdog-remote/`
- Publishes `dist/` to the `gh-pages` branch

After deploy, your site URL will be similar to:

- `https://<github-user>.github.io/gdog-remote/`

Open with backend query parameter when needed:

- `https://<github-user>.github.io/gdog-remote/?backend=192.168.1.25:8000`
- `https://<github-user>.github.io/gdog-remote/?backend=https://my-random-name.trycloudflare.com`

## If Your Repository Name Is Different

The default `build:pages` script assumes repository name `gdog-remote`.
If your repo name differs, update `build:pages` in [package.json](package.json).

Example:

```json
"build:pages": "vite build --base /my-repo-name/"
```

## Troubleshooting

- Phone opens remote but cannot connect:
  - verify phone and Mac are on same network
  - verify backend target is correct (`<mac-ip>:8000`)
  - verify backend is running in gdog-sim
- GitHub Pages loads but controls do nothing:
  - likely mixed content (HTTPS page trying HTTP backend)
  - use HTTPS/WSS backend URL (tunnel or reverse proxy)
- WebRTC button stays disabled:
  - backend `/capabilities` is currently missing in gdog-sim
  - WebSocket mode is still expected to work
- White page or stale UI:
  - run `npm install`
  - hard refresh browser cache
