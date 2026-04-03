# gdog-remote

Web controller for the gdog simulator.

This app sends control commands at 50 Hz to the simulator backend on port 8000.

## Features

- Two virtual joysticks with pointer, mouse, and touch support
- Correct dual-stick control mapping:
  - Left joystick (`X`) controls yaw rate (`omega`)
  - Right joystick (`Y`) controls forward/back velocity (`vx`)
- Strong default response (amplified base joystick gain)
- Independent sensitivity sliders for velocity and yaw
- Auto WebSocket connection on page load
- Optional WebRTC control channel when backend supports it
- Backend capability probe via `/capabilities`
- Fullscreen toggle to maximize joystick area on mobile
- Dynamic joystick sizing in fullscreen
- Dark-mode-aware UI (follows system/browser theme)
- Multi-touch gesture suppression to avoid pinch/two-finger interference while driving

## Prerequisites

- Node.js 20+
- npm
- Simulator backend running from the sibling repository on `http://localhost:8000`

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Open the URL shown by Vite, usually `http://localhost:5173`.

## Control Model

- Left joystick (`X`) controls angular velocity `omega`
- Right joystick (`Y`) controls linear velocity `vx`
- If WebRTC connects, commands are sent over data channel
- Otherwise commands continue over WebSocket fallback

## Mobile Notes

- Use `Fullscreen` for larger controls and better thumb reach
- Two-finger/pinch browser gestures are blocked in-app to reduce accidental interference
- Dark mode should apply to panels, buttons, and page background

## Troubleshooting

- White page at startup:
  - Open browser devtools and check console errors
  - Ensure dependencies were installed with `npm install`
  - Make sure you are running `npm run dev` and not `nmp run dev`
- Controls visible but robot does not move:
  - Confirm simulator is running in the other repo
  - Confirm backend is reachable at `http://localhost:8000/capabilities`
  - Check status text in the UI for WebSocket or WebRTC connection state
- WebRTC button disabled:
  - Backend likely does not have `aiortc` installed
  - Install optional dependency in the simulator repo and restart backend
- UI appears stuck in old light colors on phone:
  - Hard refresh once to invalidate cached CSS/JS
