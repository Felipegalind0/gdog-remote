# gdog-remote

Web controller for the gdog simulator.

This app sends control commands at 50 Hz to the simulator backend on port 8000.

## Features

- Two virtual joysticks with pointer, mouse, and touch support
- Auto WebSocket connection on page load
- Optional WebRTC control channel when backend supports it
- Backend capability probe via `/capabilities`

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

- Left joystick controls linear velocity `vx`
- Right joystick controls angular velocity `omega`
- If WebRTC connects, commands are sent over data channel
- Otherwise commands continue over WebSocket fallback

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
