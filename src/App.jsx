import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const BACKEND_STORAGE_KEY = 'gdog.remote.backendTarget';
const DEFAULT_BACKEND_PORT = 8000;
const DEFAULT_JOYSTICK_GAIN = 5.0;

function getDefaultBackendTarget() {
  const host = window.location.hostname || 'localhost';
  return `${host}:${DEFAULT_BACKEND_PORT}`;
}

function getInitialBackendTarget() {
  const urlParams = new URLSearchParams(window.location.search);
  const queryTarget = (urlParams.get('backend') || '').trim();
  if (queryTarget) {
    return queryTarget;
  }

  try {
    const storedTarget = (window.localStorage.getItem(BACKEND_STORAGE_KEY) || '').trim();
    if (storedTarget) {
      return storedTarget;
    }
  } catch {
    // Ignore storage access failures.
  }

  return getDefaultBackendTarget();
}

function persistBackendTarget(target) {
  const value = String(target || '').trim();

  try {
    if (value) {
      window.localStorage.setItem(BACKEND_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(BACKEND_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access failures.
  }

  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set('backend', value);
  } else {
    url.searchParams.delete('backend');
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function normalizeBackendTarget(rawValue) {
  const fallbackHostPort = getDefaultBackendTarget();
  const pageIsHttps = window.location.protocol === 'https:';
  const defaultHttpProtocol = pageIsHttps ? 'https:' : 'http:';
  const defaultWsProtocol = pageIsHttps ? 'wss:' : 'ws:';

  let token = String(rawValue || '').trim();
  let httpProtocol = defaultHttpProtocol;
  let wsProtocol = defaultWsProtocol;
  let hostPort = '';
  let explicitScheme = false;

  if (!token) {
    token = fallbackHostPort;
  }

  const lowerToken = token.toLowerCase();
  const hasExplicitScheme =
    lowerToken.startsWith('http://')
    || lowerToken.startsWith('https://')
    || lowerToken.startsWith('ws://')
    || lowerToken.startsWith('wss://');

  if (hasExplicitScheme) {
    explicitScheme = true;
    try {
      const parsed = new URL(token);
      hostPort = (parsed.host || '').trim();
      if (parsed.protocol === 'https:' || parsed.protocol === 'wss:') {
        httpProtocol = 'https:';
        wsProtocol = 'wss:';
      } else {
        httpProtocol = 'http:';
        wsProtocol = 'ws:';
      }
    } catch {
      hostPort = fallbackHostPort;
      explicitScheme = false;
    }
  } else {
    hostPort = token.replace(/^\/+|\/+$/g, '');
  }

  if (!hostPort) {
    hostPort = fallbackHostPort;
  }

  const hasPort = hostPort.startsWith('[')
    ? hostPort.includes(']:')
    : hostPort.includes(':');
  if (!hasPort) {
    hostPort = `${hostPort}:${DEFAULT_BACKEND_PORT}`;
  }

  const normalizedInput = explicitScheme ? `${httpProtocol}//${hostPort}` : hostPort;
  const httpBase = `${httpProtocol}//${hostPort}`;

  return {
    input: normalizedInput,
    httpBase,
    wsUrl: `${wsProtocol}//${hostPort}/ws`,
    offerUrl: `${httpBase}/offer`,
    capabilitiesUrl: `${httpBase}/capabilities`,
    usingInsecureBackendFromHttpsPage: pageIsHttps && httpProtocol === 'http:',
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function Joystick({ label, color, onChange, size = 180 }) {
  const zoneRef = useRef(null);
  const pointerIdRef = useRef(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const updateFromPointer = useCallback((clientX, clientY) => {
    const zone = zoneRef.current;
    if (!zone) return;

    const rect = zone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.max(1, rect.width * 0.38);

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);

    if (distance > radius && distance > 0) {
      const scale = radius / distance;
      dx *= scale;
      dy *= scale;
    }

    const normX = radius > 0 ? dx / radius : 0;
    const normY = radius > 0 ? dy / radius : 0;

    setKnob({ x: dx, y: dy });
    onChange(normX, normY);
  }, [onChange]);

  const reset = useCallback(() => {
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  }, [onChange]);

  const handlePointerDown = useCallback((event) => {
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event.clientX, event.clientY);
  }, [updateFromPointer]);

  const handlePointerMove = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    updateFromPointer(event.clientX, event.clientY);
  }, [updateFromPointer]);

  const handlePointerEnd = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    reset();
  }, [reset]);

  const knobSize = Math.max(42, Math.round(size * 0.22));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
      <h3 style={{ margin: 0 }}>{label}</h3>
      <div
        ref={zoneRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          background: `radial-gradient(circle at 30% 30%, ${color}22, ${color}10)`,
          position: 'relative',
          touchAction: 'none',
          userSelect: 'none',
          cursor: 'grab',
          boxSizing: 'border-box'
        }}
      >
        <div
          style={{
            width: knobSize,
            height: knobSize,
            borderRadius: '50%',
            background: color,
            opacity: 0.9,
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            boxShadow: `0 8px 18px ${color}55`,
            pointerEvents: 'none'
          }}
        />
      </div>
    </div>
  );
}

function App() {
  const initialBackendInput = useMemo(() => normalizeBackendTarget(getInitialBackendTarget()).input, []);
  const [backendInput, setBackendInput] = useState(initialBackendInput);
  const [backendTarget, setBackendTarget] = useState(initialBackendInput);
  const [capabilities, setCapabilities] = useState({ loaded: false, webrtc: false });
  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [velocitySensitivity, setVelocitySensitivity] = useState(1.0);
  const [yawSensitivity, setYawSensitivity] = useState(1.0);
  const [statusMessage, setStatusMessage] = useState('Booting remote controller...');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  
  const appRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const wsRef = useRef(null);
  const unmountedRef = useRef(false);

  const vxRef = useRef(0.0);
  const omegaRef = useRef(0.0);
  const pitchCmdRef = useRef(0.0);
  const rollCmdRef = useRef(0.0);

  const backendConfig = useMemo(() => normalizeBackendTarget(backendTarget), [backendTarget]);

  const disconnectWebRTC = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.onopen = null;
      dcRef.current.onclose = null;
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    setWebrtcConnected(false);
  }, []);

  const disconnectWebSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;

    if (!ws) return;

    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();

    setWsConnected(false);
  }, []);

  const applyBackendTarget = useCallback(() => {
    const normalized = normalizeBackendTarget(backendInput);
    setBackendInput(normalized.input);
    persistBackendTarget(normalized.input);

    const currentNormalized = normalizeBackendTarget(backendTarget).input;
    const targetChanged = normalized.input !== currentNormalized;

    setCapabilities({ loaded: false, webrtc: false });
    if (targetChanged) {
      setBackendTarget(normalized.input);
      setStatusMessage(`Switching backend to ${normalized.httpBase} ...`);
      return;
    }

    setStatusMessage(`Reconnecting to ${normalized.httpBase} ...`);
    disconnectWebRTC();
    disconnectWebSocket();
    fetchCapabilities();
    connectWebSocket();
  }, [
    backendInput,
    backendTarget,
    connectWebSocket,
    disconnectWebRTC,
    disconnectWebSocket,
    fetchCapabilities,
  ]);

  const fetchCapabilities = useCallback(async () => {
    try {
      const res = await fetch(backendConfig.capabilitiesUrl);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();

      const webrtcAvailable = Boolean(data.webrtc);
      setCapabilities({ loaded: true, webrtc: webrtcAvailable });

      if (webrtcAvailable) {
        setStatusMessage(`Connected to ${backendConfig.httpBase}. WebSocket active, WebRTC available.`);
      } else {
        setStatusMessage(`Connected to ${backendConfig.httpBase}. WebSocket active, WebRTC unavailable on server.`);
      }
    } catch (err) {
      console.warn('Capabilities probe failed:', err);
      setCapabilities({ loaded: true, webrtc: false });
      setStatusMessage('Capabilities probe failed. Running in WebSocket mode.');
    }
  }, [backendConfig.capabilitiesUrl, backendConfig.httpBase]);

  const connectWebSocket = useCallback(() => {
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let ws;
    try {
      ws = new WebSocket(backendConfig.wsUrl);
    } catch (err) {
      console.error('Invalid WebSocket URL:', err);
      setStatusMessage(`Invalid backend target: ${backendConfig.input}`);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) return;
      setWsConnected(true);
      setStatusMessage((prev) => {
        if (prev.includes('WebRTC active')) return prev;
        return `WebSocket connected to ${backendConfig.wsUrl}. Ready for control input.`;
      });
    };

    ws.onclose = () => {
      if (unmountedRef.current) return;
      setWsConnected(false);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      if (unmountedRef.current) return;
      setStatusMessage(`WebSocket connection issue at ${backendConfig.wsUrl}. Retrying...`);
    };
  }, [backendConfig.input, backendConfig.wsUrl]);

  // -- WebRTC Logic --
  const connectWebRTC = async () => {
    if (!capabilities.webrtc) {
      setStatusMessage('WebRTC is not available on the backend. Use WebSocket fallback.');
      return;
    }

    try {
      disconnectWebRTC();

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      const dc = pc.createDataChannel('controls', { ordered: false, maxRetransmits: 0 });
      dcRef.current = dc;

      dc.onopen = () => {
        if (unmountedRef.current) return;
        setWebrtcConnected(true);
        setStatusMessage('WebRTC active. Control stream is using the data channel.');
      };

      dc.onclose = () => {
        if (unmountedRef.current) return;
        setWebrtcConnected(false);
        setStatusMessage('WebRTC disconnected. Continuing with WebSocket fallback.');
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' || state === 'closed' || state === 'disconnected') {
          if (!unmountedRef.current) {
            setWebrtcConnected(false);
            setStatusMessage('WebRTC connection lost. Continuing with WebSocket fallback.');
          }
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch(backendConfig.offerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type })
      });

      const answer = await res.json();
      if (answer.error) throw new Error(answer.error);
      
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('WebRTC connection failed', err);
      setWebrtcConnected(false);
      setStatusMessage('Failed to connect WebRTC. Continuing with WebSocket fallback.');
    }
  };

  useEffect(() => {
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      disconnectWebRTC();
      disconnectWebSocket();
    };
  }, [disconnectWebRTC, disconnectWebSocket]);

  useEffect(() => {
    if (unmountedRef.current) return;

    setStatusMessage(`Connecting to backend at ${backendConfig.httpBase} ...`);
    setCapabilities({ loaded: false, webrtc: false });
    disconnectWebRTC();
    disconnectWebSocket();
    fetchCapabilities();
    connectWebSocket();
  }, [
    backendConfig.httpBase,
    connectWebSocket,
    disconnectWebRTC,
    disconnectWebSocket,
    fetchCapabilities,
  ]);

  useEffect(() => {
    const getFullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement()));
    };

    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    const preventGesture = (event) => {
      event.preventDefault();
    };

    const preventTwoFingerTouchMove = (event) => {
      if (event.touches && event.touches.length >= 2) {
        event.preventDefault();
      }
    };

    const preventCtrlWheelZoom = (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };

    const passiveFalse = { passive: false };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    window.addEventListener('resize', handleResize);

    // Disable browser gesture recognizers that conflict with dual-thumb joystick control.
    document.addEventListener('gesturestart', preventGesture, passiveFalse);
    document.addEventListener('gesturechange', preventGesture, passiveFalse);
    document.addEventListener('gestureend', preventGesture, passiveFalse);
    document.addEventListener('touchmove', preventTwoFingerTouchMove, passiveFalse);
    window.addEventListener('wheel', preventCtrlWheelZoom, passiveFalse);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('gesturestart', preventGesture, passiveFalse);
      document.removeEventListener('gesturechange', preventGesture, passiveFalse);
      document.removeEventListener('gestureend', preventGesture, passiveFalse);
      document.removeEventListener('touchmove', preventTwoFingerTouchMove, passiveFalse);
      window.removeEventListener('wheel', preventCtrlWheelZoom, passiveFalse);
    };
  }, []);

  useEffect(() => {
    if (webrtcConnected || wsConnected) return;

    const timer = setTimeout(() => {
      if (!unmountedRef.current) connectWebSocket();
    }, 1500);

    return () => clearTimeout(timer);
  }, [webrtcConnected, wsConnected, connectWebSocket]);

  // 50Hz Control Loop over preferred channel
  useEffect(() => {
    const interval = setInterval(() => {
      const payload = JSON.stringify({
        vx: vxRef.current,
        omega: omegaRef.current,
        pitch_cmd: pitchCmdRef.current,
        roll_cmd: rollCmdRef.current,
      });
      
      // Prefer WebRTC Data Channel if ready, else fallback to WebSocket
      if (webrtcConnected && dcRef.current && dcRef.current.readyState === 'open') {
        try {
          dcRef.current.send(payload);
        } catch (err) {
          console.error('Data channel send failed:', err);
        }
      } else if (wsConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(payload);
        } catch (err) {
          console.error('WebSocket send failed:', err);
        }
      }
    }, 20); // 20ms = 50Hz

    return () => clearInterval(interval);
  }, [webrtcConnected, wsConnected]);

  const handleLeftJoystick = useCallback((x, y) => {
    const maxOmega = 3.0 * DEFAULT_JOYSTICK_GAIN;
    const maxVelocity = 5.0 * DEFAULT_JOYSTICK_GAIN;
    const normalizedYaw = clamp(-x, -1, 1);
    const normalizedVelocity = clamp(-y, -1, 1);

    omegaRef.current = normalizedYaw * maxOmega * yawSensitivity;
    vxRef.current = normalizedVelocity * maxVelocity * velocitySensitivity;
  }, [yawSensitivity, velocitySensitivity]);

  const handleRightJoystick = useCallback((x, y) => {
    // Right stick drives normalized body tilt setpoints consumed by the sim.
    rollCmdRef.current = clamp(x, -1, 1);
    pitchCmdRef.current = clamp(-y, -1, 1);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const target = appRef.current || document.documentElement;
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || null;

    try {
      if (!fullscreenElement) {
        if (target.requestFullscreen) {
          await target.requestFullscreen();
        } else if (target.webkitRequestFullscreen) {
          target.webkitRequestFullscreen();
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen toggle failed:', err);
      setStatusMessage('Fullscreen request was blocked by the browser.');
    }
  }, []);

  const joystickSize = isFullscreen
    ? clamp(Math.min(viewport.width * 0.42, viewport.height * 0.58), 240, 420)
    : 180;

  const panelStyle = {
    display: 'flex',
    justifyContent: 'center',
    gap: isFullscreen ? 'clamp(1rem, 6vw, 5rem)' : '2.5rem',
    flexWrap: 'wrap',
    marginTop: isFullscreen ? '0.8rem' : '1.5rem'
  };

  return (
    <div
      ref={appRef}
      style={{
        textAlign: 'center',
        padding: isFullscreen ? '0.85rem' : '2rem',
        fontFamily: 'system-ui, sans-serif',
        minHeight: isFullscreen ? '100vh' : undefined,
        backgroundColor: 'var(--bg)',
        color: 'var(--text-h)',
        boxSizing: 'border-box',
        touchAction: 'none',
        overscrollBehavior: 'none',
      }}
    >
      <h1>Robot Remote Controller</h1>
      <p style={{ margin: '0 0 1rem', color: 'var(--text)' }}>{statusMessage}</p>

      <div
        style={{
          margin: '0 auto 1rem',
          width: 'min(840px, 96vw)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '1rem',
          display: 'grid',
          gap: '0.7rem',
          textAlign: 'left',
          background: 'var(--code-bg)'
        }}
      >
        <div style={{ fontWeight: 600 }}>Backend Target</div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            value={backendInput}
            onChange={(event) => setBackendInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyBackendTarget();
              }
            }}
            placeholder="192.168.1.25:8000 or https://robot.example.com"
            style={{
              flex: '1 1 20rem',
              minWidth: 220,
              padding: '0.55rem 0.65rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: '0.95rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              background: 'var(--bg)',
              color: 'var(--text-h)'
            }}
          />

          <button
            onClick={applyBackendTarget}
            style={{
              padding: '0.55rem 0.85rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--social-bg)',
              color: 'var(--text-h)',
              cursor: 'pointer'
            }}
          >
            Apply backend
          </button>

          <button
            onClick={() => setBackendInput(getDefaultBackendTarget())}
            style={{
              padding: '0.55rem 0.85rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--social-bg)',
              color: 'var(--text-h)',
              cursor: 'pointer'
            }}
          >
            Use local default
          </button>
        </div>

        <div style={{ fontSize: '0.92rem', color: 'var(--text)' }}>
          Active backend: {backendConfig.httpBase}
        </div>

        <div style={{ fontSize: '0.84rem', color: 'var(--text)' }}>
          Tip: share a preconfigured link like <code>?backend=192.168.1.25:8000</code>
        </div>

        {backendConfig.usingInsecureBackendFromHttpsPage ? (
          <div style={{ fontSize: '0.84rem', color: '#b45309' }}>
            This page is HTTPS but the backend target is HTTP. Browsers will block mixed-content requests; use an HTTPS/WSS backend URL.
          </div>
        ) : null}
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button
          onClick={connectWebRTC}
          disabled={!capabilities.loaded || !capabilities.webrtc}
          style={{
            padding: '0.8rem 1rem',
            fontSize: '1rem',
            cursor: (!capabilities.loaded || !capabilities.webrtc) ? 'not-allowed' : 'pointer',
            backgroundColor: webrtcConnected ? 'rgba(76, 175, 80, 0.25)' : 'var(--social-bg)',
            opacity: (!capabilities.loaded || !capabilities.webrtc) ? 0.65 : 1,
            border: '1px solid var(--border)',
            color: 'var(--text-h)',
            borderRadius: 8
          }}
        >
          {webrtcConnected ? 'WebRTC Connected' : 'Connect WebRTC'}
        </button>
        
        <button
          onClick={connectWebSocket}
          style={{
            padding: '0.8rem 1rem',
            fontSize: '1rem',
            cursor: 'pointer',
            backgroundColor: (!webrtcConnected && wsConnected) ? 'rgba(76, 175, 80, 0.25)' : 'var(--social-bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-h)',
            borderRadius: 8
          }}
        >
          {wsConnected ? 'WebSocket Connected' : 'Reconnect WebSocket'}
        </button>

        <button
          onClick={toggleFullscreen}
          style={{
            padding: '0.8rem 1rem',
            fontSize: '1rem',
            cursor: 'pointer',
            backgroundColor: isFullscreen ? 'rgba(76, 175, 80, 0.25)' : 'var(--social-bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-h)',
            borderRadius: 8
          }}
        >
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>

      <div
        style={{
          margin: '0 auto 1.25rem',
          width: 'min(680px, 92vw)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '1rem 1rem 0.75rem',
          display: 'grid',
          gap: '0.9rem',
          textAlign: 'left',
          background: 'var(--code-bg)'
        }}
      >
        <div style={{ fontWeight: 600 }}>Sensitivity</div>

        <label style={{ display: 'grid', gap: '0.4rem' }}>
          <span>Velocity (L, Y): {velocitySensitivity.toFixed(1)}x</span>
          <input
            type="range"
            min="0.2"
            max="3.0"
            step="0.1"
            value={velocitySensitivity}
            onChange={(event) => setVelocitySensitivity(parseFloat(event.target.value))}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.4rem' }}>
          <span>Yaw (L, X): {yawSensitivity.toFixed(1)}x</span>
          <input
            type="range"
            min="0.2"
            max="3.0"
            step="0.1"
            value={yawSensitivity}
            onChange={(event) => setYawSensitivity(parseFloat(event.target.value))}
          />
        </label>

        <button
          onClick={() => {
            setVelocitySensitivity(1.0);
            setYawSensitivity(1.0);
          }}
          style={{
            justifySelf: 'start',
            marginTop: '0.15rem',
            padding: '0.45rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--social-bg)',
            color: 'var(--text-h)',
            cursor: 'pointer'
          }}
        >
          Reset sensitivity
        </button>
      </div>

      <div style={panelStyle}>
        <Joystick label="Drive + Yaw (L, X/Y axes)" color="#1f77b4" onChange={handleLeftJoystick} size={joystickSize} />
        <Joystick label="Pitch + Roll (R, X/Y axes)" color="#c0392b" onChange={handleRightJoystick} size={joystickSize} />
      </div>
    </div>
  );
}

export default App;
