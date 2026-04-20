import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const BACKEND_STORAGE_KEY = 'gdog.remote.backendTarget';
const DEFAULT_BACKEND_PORT = 8000;
const DEFAULT_JOYSTICK_GAIN = 5.0;
const DEFAULT_MANUAL_MOVE_METERS = 0.75;
const DEFAULT_MANUAL_TURN_DEGREES = 45.0;
const OPENAI_REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const OPENAI_KEY_QUERY_KEYS = ['openai_key', 'openaiKey', 'api_key', 'apikey', 'key'];

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

function getInitialOpenAiKey() {
  const urlParams = new URLSearchParams(window.location.search);
  for (const keyName of OPENAI_KEY_QUERY_KEYS) {
    const candidate = (urlParams.get(keyName) || '').trim();
    if (candidate) {
      return candidate;
    }
  }
  return '';
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
  let parsedHost = '';
  let parsedPort = '';
  let portProvidedByInput = false;
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
      parsedHost = (parsed.hostname || '').trim();
      parsedPort = (parsed.port || '').trim();
      portProvidedByInput = parsedPort !== '';

      // Accept accidental shorthand like https://host/8000 as host:8000.
      const pathPortMatch = /^\/(\d{2,5})\/?$/.exec(parsed.pathname || '');
      if (!parsedPort && pathPortMatch) {
        parsedPort = pathPortMatch[1];
        portProvidedByInput = true;
      }

      if (parsed.protocol === 'https:' || parsed.protocol === 'wss:') {
        httpProtocol = 'https:';
        wsProtocol = 'wss:';
      } else {
        httpProtocol = 'http:';
        wsProtocol = 'ws:';
      }
    } catch {
      explicitScheme = false;
    }
  }

  if (!parsedHost) {
    const tokenNoScheme = token.replace(/^[a-z]+:\/\//i, '').trim();
    const normalizedNoScheme = tokenNoScheme.replace(/^\/+|\/+$/g, '');

    try {
      const parsedNoScheme = new URL(`http://${normalizedNoScheme}`);
      parsedHost = (parsedNoScheme.hostname || '').trim();
      parsedPort = (parsedNoScheme.port || '').trim();
      portProvidedByInput = parsedPort !== '';

      // Accept shorthand like host/8000.
      const pathPortMatch = /^\/(\d{2,5})\/?$/.exec(parsedNoScheme.pathname || '');
      if (!parsedPort && pathPortMatch) {
        parsedPort = pathPortMatch[1];
        portProvidedByInput = true;
      }
    } catch {
      const slashPortMatch = /^([^/]+)\/(\d{2,5})$/.exec(normalizedNoScheme);
      if (slashPortMatch) {
        parsedHost = slashPortMatch[1].trim();
        parsedPort = slashPortMatch[2].trim();
        portProvidedByInput = true;
      } else {
        parsedHost = normalizedNoScheme;
      }
    }
  }

  if (!parsedHost) {
    try {
      const fallbackParsed = new URL(`http://${fallbackHostPort}`);
      parsedHost = (fallbackParsed.hostname || '').trim();
      parsedPort = (fallbackParsed.port || '').trim();
    } catch {
      parsedHost = 'localhost';
      parsedPort = String(DEFAULT_BACKEND_PORT);
    }
  }

  parsedHost = parsedHost.replace(/^\[|\]$/g, '');

  let finalPort = parsedPort;
  if (finalPort) {
    const numericPort = Number.parseInt(finalPort, 10);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      finalPort = '';
    } else {
      finalPort = String(numericPort);
    }
  }

  if (!finalPort && !explicitScheme) {
    finalPort = String(DEFAULT_BACKEND_PORT);
  }

  if (!finalPort && explicitScheme && portProvidedByInput) {
    // Fallback only when a bad explicit port was supplied.
    finalPort = String(DEFAULT_BACKEND_PORT);
  }

  const hostForUrl = parsedHost.includes(':') ? `[${parsedHost}]` : parsedHost;
  const hostPort = finalPort ? `${hostForUrl}:${finalPort}` : hostForUrl;

  const normalizedInput = explicitScheme ? `${httpProtocol}//${hostPort}` : hostPort;
  const httpBase = `${httpProtocol}//${hostPort}`;

  return {
    input: normalizedInput,
    httpBase,
    wsUrl: `${wsProtocol}//${hostPort}/ws`,
    commandUrl: `${httpBase}/command`,
    offerUrl: `${httpBase}/offer`,
    capabilitiesUrl: `${httpBase}/capabilities`,
    eventsUrl: `${httpBase}/events`,
    usingInsecureBackendFromHttpsPage: pageIsHttps && httpProtocol === 'http:',
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatRuntimeHardwareContext(runtimeInfo) {
  const info = runtimeInfo && typeof runtimeInfo === 'object' ? runtimeInfo : null;
  if (!info) {
    return 'The backend runtime hardware report is currently unavailable.';
  }

  const summary = info.summary && typeof info.summary === 'object' ? info.summary : {};
  const detailLines = [
    ['OS', summary.os],
    ['Host', summary.host],
    ['Kernel', summary.kernel],
    ['CPU', summary.cpu],
    ['GPU', summary.gpu],
    ['Memory', summary.memory],
  ]
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([label, value]) => `${label}: ${value.trim()}`);

  if (detailLines.length > 0) {
    return [
      'The hardware Genesis is running on (captured at backend launch via neofetch):',
      ...detailLines,
    ].join('\n');
  }

  const rawText = String(info.raw || '').trim();
  if (rawText) {
    const clipped = rawText.split('\n').slice(0, 24).join('\n');
    return [
      'The backend captured this neofetch output at launch:',
      clipped,
    ].join('\n');
  }

  const errorText = String(info.error || '').trim();
  if (errorText) {
    return `The backend attempted to run neofetch at launch, but it failed: ${errorText}`;
  }

  return 'The backend attempted to run neofetch at launch, but no hardware details were reported.';
}

function buildGoldyDogInstructions(runtimeInfo, controlDirective) {
  const controlText = String(controlDirective || '').trim();
  const sections = [
    "You refer to yourself as 'GoldyDog', an Open Source robot dog the size of spot-micro, with brushless motors, wheels and IMUs at the tips of the legs for terrain sensing.",
    "You are currently inside of a High Fidelity physics simulation powered by Genesis, the world's fastest physics engine.",
    formatRuntimeHardwareContext(runtimeInfo),
  ];

  if (controlText) {
    sections.push(controlText);
  }

  return sections.join('\n\n');
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
  const [openAiKey, setOpenAiKey] = useState(() => getInitialOpenAiKey());
  const [capabilities, setCapabilities] = useState({ loaded: false, webrtc: false, runtimeInfo: null });
  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [httpFallbackActive, setHttpFallbackActive] = useState(false);
  const [velocitySensitivity, setVelocitySensitivity] = useState(1.0);
  const [yawSensitivity, setYawSensitivity] = useState(1.0);
  const [voiceSessionActive, setVoiceSessionActive] = useState(false);
  const [voiceSessionConnecting, setVoiceSessionConnecting] = useState(false);
  const [voicePanelExpanded, setVoicePanelExpanded] = useState(false);
  const [pendingVoiceCommand, setPendingVoiceCommand] = useState(null);
  const [pendingVoiceElapsedSec, setPendingVoiceElapsedSec] = useState(0);
  const [pendingVoiceProgress, setPendingVoiceProgress] = useState(null);
  const [manualMoveMeters, setManualMoveMeters] = useState(DEFAULT_MANUAL_MOVE_METERS);
  const [manualTurnDegrees, setManualTurnDegrees] = useState(DEFAULT_MANUAL_TURN_DEGREES);
  const [statusMessage, setStatusMessage] = useState('Booting remote controller...');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [logs, setLogs] = useState([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [tuneVars, setTuneVars] = useState([]);
  const [selectedTuneVar, setSelectedTuneVar] = useState('');
  const [tunePanelExpanded, setTunePanelExpanded] = useState(false);
  
  const appRef = useRef(null);
  const joystickPanelRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const wsRef = useRef(null);
  const wsEverOpenedRef = useRef(false);
  const httpFallbackInFlightRef = useRef(false);
  const lastHttpFallbackSendMsRef = useRef(0);
  const lastHttpFallbackErrorLogMsRef = useRef(0);
  const eventsSinceIdRef = useRef(0);
  const httpEventPollInFlightRef = useRef(false);
  const lastHttpEventPollErrorLogMsRef = useRef(0);
  const openAiPcRef = useRef(null);
  const openAiDcRef = useRef(null);
  const openAiMicStreamRef = useRef(null);
  const openAiAudioRef = useRef(null);
  const pendingVoiceToolCallsRef = useRef(new Map());
  const pendingVoiceProgressStartRef = useRef(new Map());
  const pendingVoiceCommandRef = useRef(null);
  const handledVoiceToolCallIdsRef = useRef(new Set());
  const activeRealtimeToolCallRef = useRef(null);
  const unmountedRef = useRef(false);

  const vxRef = useRef(0.0);
  const omegaRef = useRef(0.0);
  const pitchCmdRef = useRef(0.0);
  const rollCmdRef = useRef(0.0);

  const backendConfig = useMemo(() => normalizeBackendTarget(backendTarget), [backendTarget]);
  const tokenRequestInstructions = useMemo(() => buildGoldyDogInstructions(
    capabilities.runtimeInfo,
    'Control the robot only with tools. Use move(direction, distance) for forward/backward meters. Use rotate(direction, degrees) for left/right turns in degrees. Use respawn() if the robot gets stuck or falls over. Never issue a new tool call until the previous tool call has returned.'
  ), [capabilities.runtimeInfo]);
  const sessionUpdateInstructions = useMemo(() => buildGoldyDogInstructions(
    capabilities.runtimeInfo,
    'You control a robot. Use move for forward/backward distance in meters, rotate for left/right angle in degrees, and respawn if the robot tips over or is unrecoverable. Wait for each tool output before calling another tool; never overlap tool calls.'
  ), [capabilities.runtimeInfo]);

  const addLog = useCallback((message, type = 'info') => {
    const msg = String(message || '').trim();
    if (!msg) return;

    const now = new Date();
    const time = now.toLocaleTimeString([], { hour12: false });
    const id = `${now.getTime()}-${Math.random().toString(36).slice(2, 9)}`;

    setLogs((current) => [...current.slice(-199), { id, time, msg, type }]);

    if (type === 'error') {
      setLogsExpanded(true);
    }
  }, []);

  const disconnectWebRTC = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.onopen = null;
      dcRef.current.onclose = null;
      dcRef.current.onmessage = null;
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
    ws.onmessage = null;
    ws.close();
    wsEverOpenedRef.current = false;

    setWsConnected(false);
  }, []);

  const sendHttpControlFallback = useCallback((payloadObject, options = {}) => {
    if (backendConfig.usingInsecureBackendFromHttpsPage) {
      return false;
    }

    const urgent = Boolean(options.urgent);
    const now = Date.now();
    if (!urgent && (now - lastHttpFallbackSendMsRef.current) < 110) {
      return true;
    }
    if (!urgent && httpFallbackInFlightRef.current) {
      return true;
    }

    lastHttpFallbackSendMsRef.current = now;
    httpFallbackInFlightRef.current = true;

    fetch(backendConfig.commandUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadObject),
      keepalive: false,
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }
        if (unmountedRef.current) return;

        setHttpFallbackActive((previous) => {
          if (!previous) {
            addLog(`HTTP fallback active: sending commands to ${backendConfig.commandUrl}`, 'info');
          }
          return true;
        });
        setStatusMessage((prev) => {
          if (prev.includes('WebRTC active') || prev.includes('WebSocket connected')) {
            return prev;
          }
          return `HTTP fallback active at ${backendConfig.httpBase}. Network appears to block WebSockets.`;
        });
      })
      .catch((err) => {
        console.warn('HTTP fallback send failed:', err);
        if (unmountedRef.current) return;
        setHttpFallbackActive(false);

        const nowMs = Date.now();
        if (nowMs - lastHttpFallbackErrorLogMsRef.current > 2500) {
          lastHttpFallbackErrorLogMsRef.current = nowMs;
          addLog(`HTTP fallback send failed: ${err?.message || String(err)}`, 'error');
        }
      })
      .finally(() => {
        httpFallbackInFlightRef.current = false;
      });

    return true;
  }, [addLog, backendConfig.commandUrl, backendConfig.httpBase, backendConfig.usingInsecureBackendFromHttpsPage]);

  const sendControlPayload = useCallback((payloadObject, options = {}) => {
    const payload = JSON.stringify(payloadObject);

    if (webrtcConnected && dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(payload);
        if (httpFallbackActive) {
          setHttpFallbackActive(false);
        }
        return true;
      } catch (err) {
        console.error('Data channel send failed:', err);
      }
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(payload);
        if (httpFallbackActive) {
          setHttpFallbackActive(false);
        }
        return true;
      } catch (err) {
        console.error('WebSocket send failed:', err);
      }
    }

    return sendHttpControlFallback(payloadObject, options);
  }, [httpFallbackActive, sendHttpControlFallback, webrtcConnected]);

  const sendHttpCommandWithAck = useCallback(async (payloadObject, options = {}) => {
    if (backendConfig.usingInsecureBackendFromHttpsPage) {
      return {
        ok: false,
        reason: 'Browser blocked HTTP backend from HTTPS page.',
      };
    }

    const attemptsRaw = Number(options.attempts);
    const attempts = Number.isFinite(attemptsRaw) ? clamp(Math.round(attemptsRaw), 1, 4) : 2;
    const retryDelayMs = Number(options.retryDelayMs) > 0 ? Number(options.retryDelayMs) : 120;
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await fetch(backendConfig.commandUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadObject),
          keepalive: false,
        });

        if (!res.ok) {
          throw new Error(`status ${res.status}`);
        }

        if (!unmountedRef.current) {
          setHttpFallbackActive((previous) => {
            if (!previous) {
              addLog(`HTTP fallback active: sending commands to ${backendConfig.commandUrl}`, 'info');
            }
            return true;
          });
        }

        return { ok: true };
      } catch (err) {
        lastError = err;
        if (attempt < attempts) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, retryDelayMs);
          });
        }
      }
    }

    const reason = lastError?.message || String(lastError || 'HTTP command send failed');
    if (!unmountedRef.current) {
      addLog(`HTTP command send failed after ${attempts} attempt(s): ${reason}`, 'error');
      setHttpFallbackActive(false);
    }

    return { ok: false, reason };
  }, [addLog, backendConfig.commandUrl, backendConfig.usingInsecureBackendFromHttpsPage]);

  const resolvePendingVoiceToolCall = useCallback((callId, resultPayload) => {
    const key = String(callId || '').trim();
    if (!key) return false;

    const pending = pendingVoiceToolCallsRef.current.get(key);
    if (!pending) return false;

    window.clearTimeout(pending.timeoutId);
    pendingVoiceToolCallsRef.current.delete(key);
    setPendingVoiceCommand((current) => (current && current.callId === key ? null : current));
    setPendingVoiceProgress((current) => (current && current.callId === key ? null : current));
    pending.resolve(resultPayload);
    return true;
  }, []);

  const resolvePendingVoiceProgressStart = useCallback((callId, progressPayload = null) => {
    const key = String(callId || '').trim();
    if (!key) return false;

    const pending = pendingVoiceProgressStartRef.current.get(key);
    if (!pending) return false;

    window.clearTimeout(pending.timeoutId);
    pendingVoiceProgressStartRef.current.delete(key);
    pending.resolve(progressPayload);
    return true;
  }, []);

  const clearPendingVoiceProgressStartWaiters = useCallback(() => {
    for (const pending of pendingVoiceProgressStartRef.current.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.resolve(null);
    }
    pendingVoiceProgressStartRef.current.clear();
  }, []);

  const clearPendingVoiceToolCalls = useCallback((reason = 'Voice command interrupted before completion.') => {
    const fallbackResult = {
      type: 'voice_command_result',
      status: 'failed',
      reason,
    };

    for (const pending of pendingVoiceToolCallsRef.current.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.resolve(fallbackResult);
    }
    pendingVoiceToolCallsRef.current.clear();
    setPendingVoiceCommand(null);
    setPendingVoiceProgress(null);
  }, []);

  const waitForVoiceToolResult = useCallback((callId, options = {}) => {
    const key = String(callId || '').trim();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 45000;
    const summary = String(options.summary || 'robot command');
    if (!key) {
      return Promise.resolve({
        type: 'voice_command_result',
        status: 'failed',
        reason: 'Missing command correlation id.',
      });
    }

    addLog(`Sending command [${key}]: ${summary}`, 'info');

    return new Promise((resolve) => {
      setPendingVoiceProgress(null);
      setPendingVoiceCommand({
        callId: key,
        summary,
        timeoutMs,
        startedAtMs: Date.now(),
      });

      const timeoutId = window.setTimeout(() => {
        pendingVoiceToolCallsRef.current.delete(key);
        resolvePendingVoiceProgressStart(key, null);
        setPendingVoiceCommand((current) => (current && current.callId === key ? null : current));
        setPendingVoiceProgress((current) => (current && current.callId === key ? null : current));
        addLog(`Command [${key}] timed out waiting for robot telemetry.`, 'error');
        resolve({
          type: 'voice_command_result',
          call_id: key,
          status: 'failed',
          reason: 'Timed out waiting for robot command completion.',
        });
      }, timeoutMs);

      pendingVoiceToolCallsRef.current.set(key, { resolve, timeoutId });
    });
  }, [addLog, resolvePendingVoiceProgressStart]);

  const progressEventShowsMovement = useCallback((payload) => {
    const command = String(payload?.command || '').trim().toLowerCase();
    const ratio = Number(payload?.progress_ratio);

    if (command === 'move') {
      const progressM = Number(payload?.progress_m);
      return progressM > 0.03 || ratio > 0.01;
    }

    if (command === 'rotate') {
      const progressRad = Number(payload?.progress_rad);
      return progressRad > ((2 * Math.PI) / 180) || ratio > 0.01;
    }

    return ratio > 0.01;
  }, []);

  useEffect(() => {
    pendingVoiceCommandRef.current = pendingVoiceCommand;
  }, [pendingVoiceCommand]);

  useEffect(() => {
    if (!pendingVoiceCommand) {
      setPendingVoiceElapsedSec(0);
      return undefined;
    }

    const tick = () => {
      const elapsedSec = (Date.now() - pendingVoiceCommand.startedAtMs) / 1000;
      setPendingVoiceElapsedSec(Math.max(0, elapsedSec));
    };

    tick();
    const timer = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [pendingVoiceCommand]);


  const handleRobotStatusMessage = useCallback((rawPayload) => {
    if (typeof rawPayload !== 'string') {
      return;
    }

    let message;
    try {
      message = JSON.parse(rawPayload);
    } catch {
      return;
    }

    const eventId = Number(message?._event_id);
    if (Number.isFinite(eventId)) {
      eventsSinceIdRef.current = Math.max(eventsSinceIdRef.current, eventId);
    }

    if (message?.type === 'tune_list') {
      const vars = Array.isArray(message.vars) ? message.vars : [];
      setTuneVars(vars);
      if (vars.length > 0) {
        setSelectedTuneVar((prev) => (vars.find((v) => v.name === prev) ? prev : vars[0].name));
      }
      return;
    }

    if (message?.type === 'tune_result') {
      if (message.ok) {
        setTuneVars((prev) =>
          prev.map((v) => (v.name === message.name ? { ...v, value: message.value } : v))
        );
      }
      return;
    }

    if (message?.type === 'voice_command_progress') {
      const callId = String(message.call_id || '').trim();
      if (!callId) {
        return;
      }

      if (progressEventShowsMovement(message)) {
        resolvePendingVoiceProgressStart(callId, message);
      }

      const activeCallId = pendingVoiceCommandRef.current?.callId || null;

      setPendingVoiceProgress((current) => {
        if (activeCallId && activeCallId === callId) {
          return { callId, payload: message };
        }
        if (current && current.callId === callId) {
          return { callId, payload: message };
        }
        return current;
      });
      return;
    }

    if (message?.type !== 'voice_command_result') {
      return;
    }

    const status = message.status;
    const reason = message.reason;
    addLog(`Command [${message.call_id}] finished: ${status}${reason ? ' - ' + reason : ''}`, status === 'completed' ? 'success' : 'error');

    resolvePendingVoiceProgressStart(message.call_id, null);
    resolvePendingVoiceToolCall(message.call_id, message);
  }, [resolvePendingVoiceToolCall, addLog, progressEventShowsMovement, resolvePendingVoiceProgressStart]);

  const pollHttpEventsOnce = useCallback(async () => {
    if (backendConfig.usingInsecureBackendFromHttpsPage) {
      return;
    }

    if (webrtcConnected || wsConnected) {
      return;
    }

    if (httpEventPollInFlightRef.current) {
      return;
    }

    httpEventPollInFlightRef.current = true;
    try {
      const since = Math.max(0, Number(eventsSinceIdRef.current) || 0);
      const url = `${backendConfig.eventsUrl}?since=${encodeURIComponent(String(since))}&limit=250`;
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }

      const data = await res.json();
      const events = Array.isArray(data?.events) ? data.events : [];

      for (const eventPayload of events) {
        const eventId = Number(eventPayload?._event_id);
        if (Number.isFinite(eventId)) {
          eventsSinceIdRef.current = Math.max(eventsSinceIdRef.current, eventId);
        }

        try {
          handleRobotStatusMessage(JSON.stringify(eventPayload));
        } catch {
          // Ignore malformed event payloads.
        }
      }

      const latestId = Number(data?.latest_event_id);
      if (Number.isFinite(latestId)) {
        eventsSinceIdRef.current = Math.max(eventsSinceIdRef.current, latestId);
      }
    } catch (err) {
      if (!unmountedRef.current) {
        const nowMs = Date.now();
        if (nowMs - lastHttpEventPollErrorLogMsRef.current > 3000) {
          lastHttpEventPollErrorLogMsRef.current = nowMs;
          addLog(`HTTP events polling failed: ${err?.message || String(err)}`, 'error');
        }
      }
    } finally {
      httpEventPollInFlightRef.current = false;
    }
  }, [addLog, backendConfig.eventsUrl, backendConfig.usingInsecureBackendFromHttpsPage, handleRobotStatusMessage, webrtcConnected, wsConnected]);

  const stopVoiceControl = useCallback((statusOverride = null) => {
    clearPendingVoiceToolCalls('Voice session ended before command completion.');
    clearPendingVoiceProgressStartWaiters();
    handledVoiceToolCallIdsRef.current.clear();
    activeRealtimeToolCallRef.current = null;

    const dataChannel = openAiDcRef.current;
    openAiDcRef.current = null;
    if (dataChannel) {
      dataChannel.onopen = null;
      dataChannel.onclose = null;
      dataChannel.onmessage = null;
      try {
        dataChannel.close();
      } catch {
        // Ignore close errors during teardown.
      }
    }

    const peer = openAiPcRef.current;
    openAiPcRef.current = null;
    if (peer) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      try {
        peer.close();
      } catch {
        // Ignore close errors during teardown.
      }
    }

    const micStream = openAiMicStreamRef.current;
    openAiMicStreamRef.current = null;
    if (micStream) {
      micStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors during teardown.
        }
      });
    }

    const audioEl = openAiAudioRef.current;
    openAiAudioRef.current = null;
    if (audioEl) {
      try {
        audioEl.pause();
      } catch {
        // Ignore pause errors during teardown.
      }
      audioEl.srcObject = null;
    }

    if (!unmountedRef.current) {
      setVoiceSessionConnecting(false);
      setVoiceSessionActive(false);
      if (typeof statusOverride === 'string' && statusOverride.trim()) {
        setStatusMessage(statusOverride);
      }
    }
  }, [clearPendingVoiceProgressStartWaiters, clearPendingVoiceToolCalls]);

  const sendVoiceRobotCommand = useCallback((voicePayload) => {
    return sendControlPayload({
      vx: 0.0,
      omega: 0.0,
      pitch_cmd: pitchCmdRef.current,
      roll_cmd: rollCmdRef.current,
      ...voicePayload,
    }, { urgent: true });
  }, [sendControlPayload]);

  const runRobotMotionAction = useCallback(async (options) => {
    const normalizedCallId = String(options?.callId || '').trim();
    const normalizedCommand = String(options?.command || '').trim().toLowerCase();
    const summary = String(options?.summary || normalizedCommand || 'robot action');
    const timeoutMs = Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : 45000;

    if (!normalizedCallId) {
      return {
        type: 'voice_command_result',
        status: 'failed',
        reason: 'Missing command correlation id.',
      };
    }

    if (normalizedCommand !== 'move' && normalizedCommand !== 'rotate') {
      return {
        type: 'voice_command_result',
        call_id: normalizedCallId,
        command: normalizedCommand || 'unknown',
        status: 'failed',
        reason: 'Unsupported robot action.',
      };
    }

    const resultPromise = waitForVoiceToolResult(normalizedCallId, {
      summary,
      timeoutMs,
    });

    const commandPayload = {
      voice_cmd: normalizedCommand,
      direction: options?.direction,
      amount: Number(options?.amount) || 0.0,
      call_id: normalizedCallId,
    };

    if (webrtcConnected || wsConnected) {
      const sent = sendVoiceRobotCommand(commandPayload);
      if (!sent) {
        resolvePendingVoiceProgressStart(normalizedCallId, null);
        const failedResult = {
          type: 'voice_command_result',
          call_id: normalizedCallId,
          command: normalizedCommand,
          status: 'failed',
          reason: 'Robot transport is not connected.',
        };
        resolvePendingVoiceToolCall(normalizedCallId, failedResult);
        return failedResult;
      }
    } else {
      const ack = await sendHttpCommandWithAck({
        vx: 0.0,
        omega: 0.0,
        pitch_cmd: pitchCmdRef.current,
        roll_cmd: rollCmdRef.current,
        ...commandPayload,
      }, {
        attempts: 3,
        retryDelayMs: 140,
      });

      if (!ack.ok) {
        resolvePendingVoiceProgressStart(normalizedCallId, null);
        const failedResult = {
          type: 'voice_command_result',
          call_id: normalizedCallId,
          command: normalizedCommand,
          status: 'failed',
          reason: ack.reason || 'Robot transport is not connected.',
        };
        resolvePendingVoiceToolCall(normalizedCallId, failedResult);
        return failedResult;
      }
    }

    return resultPromise;
  }, [resolvePendingVoiceProgressStart, resolvePendingVoiceToolCall, sendHttpCommandWithAck, sendVoiceRobotCommand, waitForVoiceToolResult, webrtcConnected, wsConnected]);

  const endActiveAction = useCallback(async () => {
    const activeCallId = String(pendingVoiceCommandRef.current?.callId || '').trim();
    const stopCallId = activeCallId || `manual-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stopPayload = {
      voice_cmd: 'stop',
      direction: 'none',
      amount: 0.0,
      call_id: stopCallId,
    };

    let sent = false;
    if (webrtcConnected || wsConnected) {
      sent = sendVoiceRobotCommand(stopPayload);
    } else {
      const ack = await sendHttpCommandWithAck({
        vx: 0.0,
        omega: 0.0,
        pitch_cmd: pitchCmdRef.current,
        roll_cmd: rollCmdRef.current,
        ...stopPayload,
      }, {
        attempts: 3,
        retryDelayMs: 130,
      });
      sent = Boolean(ack.ok);
    }

    if (sent) {
      if (activeCallId) {
        addLog(`Stop requested for command [${activeCallId}].`, 'info');
      } else {
        addLog(`Stop requested (no active command id was tracked). Using stop call id [${stopCallId}].`, 'info');
      }
      setStatusMessage('Stop requested for active action...');
      return;
    }

    if (activeCallId) {
      resolvePendingVoiceProgressStart(activeCallId, null);
      resolvePendingVoiceToolCall(activeCallId, {
        type: 'voice_command_result',
        call_id: activeCallId,
        command: 'unknown',
        status: 'failed',
        reason: 'Robot transport is not connected.',
      });
    }

    addLog('Failed to send stop command: robot transport is not connected.', 'error');
    setStatusMessage('Unable to stop action: robot transport is not connected.');
  }, [addLog, resolvePendingVoiceProgressStart, resolvePendingVoiceToolCall, sendHttpCommandWithAck, sendVoiceRobotCommand, webrtcConnected, wsConnected]);

  const triggerManualAction = useCallback((action) => {
    const activeCallId = String(pendingVoiceCommandRef.current?.callId || '').trim();
    if (activeCallId) {
      setStatusMessage('Another action is already running. Wait for it to finish or tap End Action.');
      return;
    }

    let command = '';
    let direction = '';
    let amount = 0.0;
    let timeoutMs = 45000;
    let summary = '';

    if (action === 'forward' || action === 'backward') {
      const distanceMeters = clamp(Math.abs(Number(manualMoveMeters) || 0), 0.05, 10.0);
      command = 'move';
      direction = action;
      amount = distanceMeters;
      timeoutMs = Math.max(250, Math.round(distanceMeters * 4000));
      summary = `manual move ${direction} ${distanceMeters.toFixed(2)} m`;
    } else if (action === 'left' || action === 'right') {
      const degrees = clamp(Math.abs(Number(manualTurnDegrees) || 0), 1.0, 720.0);
      command = 'rotate';
      direction = action;
      amount = (degrees * Math.PI) / 180.0;
      timeoutMs = Math.max(45000, 20000 + (degrees * 250));
      summary = `manual rotate ${direction} ${degrees.toFixed(0)} deg`;
    } else {
      return;
    }

    const callId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    addLog(`Manual action [${callId}] started: ${summary}`, 'info');

    void runRobotMotionAction({
      command,
      direction,
      amount,
      callId,
      summary,
      timeoutMs,
    })
      .then((result) => {
        const status = String(result?.status || 'failed').toLowerCase();
        const reason = String(result?.reason || '').trim();

        if (status === 'completed') {
          addLog(`Manual action [${callId}] completed.`, 'success');
          setStatusMessage(`Manual action completed: ${summary}.`);
        } else {
          addLog(`Manual action [${callId}] failed: ${reason || 'unknown reason'}`, 'error');
          setStatusMessage(`Manual action failed: ${reason || 'Robot command failed.'}`);
        }
      })
      .catch((err) => {
        const errText = err?.message || String(err);
        addLog(`Manual action [${callId}] error: ${errText}`, 'error');
        setStatusMessage(`Manual action error: ${errText}`);
      });
  }, [addLog, manualMoveMeters, manualTurnDegrees, runRobotMotionAction]);

  const fetchCapabilities = useCallback(async () => {
    if (backendConfig.usingInsecureBackendFromHttpsPage) {
      setCapabilities({ loaded: true, webrtc: false, runtimeInfo: null });
      setStatusMessage(
        'Blocked by browser security: this HTTPS page cannot call an HTTP backend. Use HTTPS/WSS for backend, or open the remote from local HTTP (npm run dev).'
      );
      return;
    }

    try {
      const res = await fetch(backendConfig.capabilitiesUrl);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();

      const webrtcAvailable = Boolean(data.webrtc);
      const runtimeInfo = (data && typeof data === 'object' && data.runtime_info && typeof data.runtime_info === 'object')
        ? data.runtime_info
        : null;
      setCapabilities({ loaded: true, webrtc: webrtcAvailable, runtimeInfo });

      if (webrtcAvailable) {
        setStatusMessage(`Connected to ${backendConfig.httpBase}. WebRTC available. Attempting WebSocket connection...`);
        addLog(`Backend reachable at ${backendConfig.httpBase}. WebRTC available.`, 'success');
      } else {
        setStatusMessage(`Connected to ${backendConfig.httpBase}. WebRTC unavailable on server. Attempting WebSocket connection...`);
        addLog(`Backend reachable at ${backendConfig.httpBase}. WebRTC unavailable.`, 'info');
      }
    } catch (err) {
      console.warn('Capabilities probe failed:', err);
      setCapabilities({ loaded: true, webrtc: false, runtimeInfo: null });
      setStatusMessage('Capabilities probe failed. Retrying WebSocket and falling back to HTTP commands if upgrades are blocked.');
      addLog(`Capabilities probe failed at ${backendConfig.capabilitiesUrl}: ${err?.message || String(err)}`, 'error');
    }
  }, [addLog, backendConfig.capabilitiesUrl, backendConfig.httpBase, backendConfig.usingInsecureBackendFromHttpsPage]);

  const connectWebSocket = useCallback(() => {
    if (backendConfig.usingInsecureBackendFromHttpsPage) {
      setWsConnected(false);
      setStatusMessage(
        'Blocked by browser security: this HTTPS page cannot open ws:// backends. Use HTTPS/WSS backend, or open the remote from local HTTP (npm run dev).'
      );
      return;
    }

    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    wsEverOpenedRef.current = false;

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
      wsEverOpenedRef.current = true;
      setWsConnected(true);
      setHttpFallbackActive(false);
      addLog(`WebSocket connected: ${backendConfig.wsUrl}`, 'success');
      try { ws.send(JSON.stringify({ tune_cmd: 'list' })); } catch {}
      setStatusMessage((prev) => {
        if (prev.includes('WebRTC active')) return prev;
        return `WebSocket connected to ${backendConfig.wsUrl}. Ready for control input.`;
      });
    };

    ws.onclose = (event) => {
      if (unmountedRef.current) return;
      setWsConnected(false);
      wsRef.current = null;

      const code = Number(event?.code) || 0;
      if (!wsEverOpenedRef.current) {
        setStatusMessage(
          `WebSocket handshake failed at ${backendConfig.wsUrl}. This network may block WebSocket upgrades; trying HTTP fallback at ${backendConfig.commandUrl}.`
        );
        addLog(
          `WebSocket handshake blocked (code ${code || 'n/a'}). Using HTTP fallback when available.`,
          'error'
        );
      } else {
        addLog(`WebSocket disconnected (code ${code || 'n/a'}).`, 'info');
      }

      wsEverOpenedRef.current = false;
    };

    ws.onmessage = (event) => {
      handleRobotStatusMessage(event.data);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      if (unmountedRef.current) return;
      let hint = '';
      if (backendConfig.wsUrl.startsWith('wss://')) {
        hint = ' Some guest/corporate Wi-Fi allows HTTPS but blocks WebSocket upgrade frames.';
      }
      setStatusMessage(
        `WebSocket connection issue at ${backendConfig.wsUrl}. Retrying...${hint} HTTP fallback endpoint: ${backendConfig.commandUrl}`
      );
      addLog(`WebSocket error at ${backendConfig.wsUrl}; retrying and using HTTP fallback when needed.`, 'error');
    };
  }, [addLog, backendConfig.commandUrl, backendConfig.input, backendConfig.usingInsecureBackendFromHttpsPage, backendConfig.wsUrl, handleRobotStatusMessage]);

  const applyBackendTarget = useCallback(() => {
    const normalized = normalizeBackendTarget(backendInput);
    setBackendInput(normalized.input);
    persistBackendTarget(normalized.input);

    const currentNormalized = normalizeBackendTarget(backendTarget).input;
    const targetChanged = normalized.input !== currentNormalized;

    setCapabilities({ loaded: false, webrtc: false });
    setHttpFallbackActive(false);
    wsEverOpenedRef.current = false;
    httpFallbackInFlightRef.current = false;
    lastHttpFallbackSendMsRef.current = 0;
    lastHttpFallbackErrorLogMsRef.current = 0;
    eventsSinceIdRef.current = 0;
    httpEventPollInFlightRef.current = false;
    lastHttpEventPollErrorLogMsRef.current = 0;
    if (targetChanged) {
      setBackendTarget(normalized.input);
      setStatusMessage(`Switching backend to ${normalized.httpBase} ...`);
      addLog(`Switching backend target to ${normalized.httpBase}`, 'info');
      return;
    }

    setStatusMessage(`Reconnecting to ${normalized.httpBase} ...`);
    addLog(`Reconnecting backend transport at ${normalized.httpBase}`, 'info');
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
    addLog,
  ]);

  // -- WebRTC Logic --
  const connectWebRTC = async () => {
    if (backendConfig.usingInsecureBackendFromHttpsPage) {
      setStatusMessage(
        'Blocked by browser security: this HTTPS page cannot use HTTP backend for WebRTC signaling. Use HTTPS/WSS backend, or open remote over local HTTP.'
      );
      return;
    }

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

      dc.onmessage = (event) => {
        handleRobotStatusMessage(event.data);
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
      stopVoiceControl(null);
      disconnectWebRTC();
      disconnectWebSocket();
    };
  }, [disconnectWebRTC, disconnectWebSocket, stopVoiceControl]);

  useEffect(() => {
    if (unmountedRef.current) return;

    setStatusMessage(`Connecting to backend at ${backendConfig.httpBase} ...`);
    setCapabilities({ loaded: false, webrtc: false });
    setHttpFallbackActive(false);
    wsEverOpenedRef.current = false;
    httpFallbackInFlightRef.current = false;
    lastHttpFallbackSendMsRef.current = 0;
    lastHttpFallbackErrorLogMsRef.current = 0;
    eventsSinceIdRef.current = 0;
    httpEventPollInFlightRef.current = false;
    lastHttpEventPollErrorLogMsRef.current = 0;
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

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    const joystickPanel = joystickPanelRef.current;
    if (!joystickPanel) {
      return undefined;
    }

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

    // Limit gesture suppression to the joystick region so the rest of the UI keeps normal touch behavior.
    joystickPanel.addEventListener('gesturestart', preventGesture, passiveFalse);
    joystickPanel.addEventListener('gesturechange', preventGesture, passiveFalse);
    joystickPanel.addEventListener('gestureend', preventGesture, passiveFalse);
    joystickPanel.addEventListener('touchmove', preventTwoFingerTouchMove, passiveFalse);
    joystickPanel.addEventListener('wheel', preventCtrlWheelZoom, passiveFalse);

    return () => {
      joystickPanel.removeEventListener('gesturestart', preventGesture, passiveFalse);
      joystickPanel.removeEventListener('gesturechange', preventGesture, passiveFalse);
      joystickPanel.removeEventListener('gestureend', preventGesture, passiveFalse);
      joystickPanel.removeEventListener('touchmove', preventTwoFingerTouchMove, passiveFalse);
      joystickPanel.removeEventListener('wheel', preventCtrlWheelZoom, passiveFalse);
    };
  }, []);

  useEffect(() => {
    if (webrtcConnected || wsConnected) return;

    const timer = setTimeout(() => {
      if (!unmountedRef.current) connectWebSocket();
    }, 1500);

    return () => clearTimeout(timer);
  }, [webrtcConnected, wsConnected, connectWebSocket]);

  useEffect(() => {
    if (backendConfig.usingInsecureBackendFromHttpsPage) {
      return undefined;
    }

    if (webrtcConnected || wsConnected) {
      return undefined;
    }

    let cancelled = false;

    const pollLoop = async () => {
      if (cancelled || unmountedRef.current) return;
      await pollHttpEventsOnce();
      if (cancelled || unmountedRef.current) return;
      window.setTimeout(pollLoop, 140);
    };

    void pollLoop();

    return () => {
      cancelled = true;
    };
  }, [backendConfig.usingInsecureBackendFromHttpsPage, pollHttpEventsOnce, webrtcConnected, wsConnected]);

  // 50Hz Control Loop over preferred channel
  useEffect(() => {
    const interval = setInterval(() => {
      sendControlPayload({
        vx: vxRef.current,
        omega: omegaRef.current,
        pitch_cmd: pitchCmdRef.current,
        roll_cmd: rollCmdRef.current,
      });
    }, 20); // 20ms = 50Hz

    return () => clearInterval(interval);
  }, [sendControlPayload]);

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

  const startVoiceControl = async () => {
    if (voiceSessionActive || voiceSessionConnecting) {
      setStatusMessage('Voice control session is already running.');
      return;
    }

    if (!openAiKey) {
      setStatusMessage('Please enter an OpenAI API key first.');
      return;
    }

    if (!(webrtcConnected || (wsRef.current && wsRef.current.readyState === WebSocket.OPEN))) {
      setStatusMessage('Connect to the robot backend before starting voice control.');
      return;
    }

    try {
      setVoiceSessionConnecting(true);
      setStatusMessage('Requesting OpenAI realtime session token...');

      const tokenResponse = await fetch('https://api.openai.com/v1/realtime/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_REALTIME_MODEL,
          voice: 'verse',
          modalities: ['audio', 'text'],
          instructions: tokenRequestInstructions,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`Failed to get realtime session token (${tokenResponse.status})`);
      }

      const data = await tokenResponse.json();
      const ephemeralKey = data?.client_secret?.value;
      if (!ephemeralKey) {
        throw new Error('Realtime session token response missing client secret.');
      }

      stopVoiceControl(null);
      setVoiceSessionConnecting(true);

      setStatusMessage('Starting OpenAI voice session...');
      addLog('Connecting to OpenAI realtime API...', 'info');
      const pc = new RTCPeerConnection();
      openAiPcRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      openAiAudioRef.current = audioEl;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      openAiMicStreamRef.current = micStream;
      micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

      const dc = pc.createDataChannel('oai-events');
      openAiDcRef.current = dc;

      const handleToolCall = (callId, toolName, argsString) => {
        const normalizedCallId = String(callId || '').trim();
        if (!normalizedCallId) {
          return;
        }

        if (handledVoiceToolCallIdsRef.current.has(normalizedCallId)) {
          return;
        }
        handledVoiceToolCallIdsRef.current.add(normalizedCallId);

        let args = {};
        try {
          args = argsString ? JSON.parse(argsString) : {};
        } catch {
          args = {};
        }

        const normalizedToolName = String(toolName || '').trim().toLowerCase();
        const busyReason = 'Robot is still executing another action. Wait for completion or end the current action first.';

        const submitToolOutput = (output) => {
          const channel = openAiDcRef.current;
          if (!channel || channel.readyState !== 'open') {
            return;
          }

          channel.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: normalizedCallId,
              output: JSON.stringify(output),
            },
          }));
          channel.send(JSON.stringify({ type: 'response.create' }));
        };

        const activeActionCallId = String(pendingVoiceCommandRef.current?.callId || '').trim();
        const activeRealtimeCallId = String(activeRealtimeToolCallRef.current || '').trim();

        if (
          (activeActionCallId && activeActionCallId !== normalizedCallId)
          || (activeRealtimeCallId && activeRealtimeCallId !== normalizedCallId)
        ) {
          submitToolOutput({
            success: false,
            status: 'failed',
            reason: busyReason,
            error: busyReason,
          });
          return;
        }

        activeRealtimeToolCallRef.current = normalizedCallId;

        (async () => {
          let output;

          try {
            if (normalizedToolName === 'move') {
              const directionRaw = String(args.direction || '').trim().toLowerCase();
              const direction = directionRaw === 'backward' || directionRaw === 'back' || directionRaw === 'reverse' || directionRaw === 'bwd'
                ? 'backward'
                : 'forward';
              const distanceMeters = clamp(Math.abs(Number(args.distance) || 0), 0.05, 10.0);
              const waitTimeoutMs = Math.max(250, Math.round(distanceMeters * 4000));
              const backendResult = await runRobotMotionAction({
                command: 'move',
                direction,
                amount: distanceMeters,
                callId: normalizedCallId,
                summary: `move ${direction} ${distanceMeters.toFixed(2)} m`,
                timeoutMs: waitTimeoutMs,
              });
              const backendStatus = String(backendResult?.status || 'failed').toLowerCase();
              const completed = backendStatus === 'completed';
              const reason = String(backendResult?.reason || '').trim();

              output = {
                success: completed,
                command: 'move',
                direction,
                distance_m: distanceMeters,
                status: completed ? 'completed' : 'failed',
                backend_status: backendStatus,
                result: backendResult,
              };
              if (!completed) {
                output.reason = reason || 'Robot command failed.';
              }
            } else if (normalizedToolName === 'rotate') {
              const directionRaw = String(args.direction || '').trim().toLowerCase();
              const direction = directionRaw === 'right' || directionRaw === 'r' || directionRaw === 'cw' || directionRaw === 'clockwise'
                ? 'right'
                : 'left';
              const degrees = clamp(Math.abs(Number(args.degrees) || 0), 1.0, 720.0);
              const radians = (degrees * Math.PI) / 180.0;
              const waitTimeoutMs = Math.max(45000, 20000 + (degrees * 250));
              const backendResult = await runRobotMotionAction({
                command: 'rotate',
                direction,
                amount: radians,
                callId: normalizedCallId,
                summary: `rotate ${direction} ${degrees.toFixed(0)} deg`,
                timeoutMs: waitTimeoutMs,
              });
              const backendStatus = String(backendResult?.status || 'failed').toLowerCase();
              const completed = backendStatus === 'completed';
              const reason = String(backendResult?.reason || '').trim();

              output = {
                success: completed,
                command: 'rotate',
                direction,
                degrees,
                status: completed ? 'completed' : 'failed',
                backend_status: backendStatus,
                result: backendResult,
              };
              if (!completed) {
                output.reason = reason || 'Robot command failed.';
              }
            } else if (normalizedToolName === 'respawn') {
              let sent = false;
              const respawnPayload = {
                cmd: 'respawn',
                voice_cmd: 'stop',
                direction: 'none',
                amount: 0.0,
                call_id: normalizedCallId,
              };
              if (webrtcConnected || wsConnected) {
                sent = sendVoiceRobotCommand(respawnPayload);
              } else {
                const ack = await sendHttpCommandWithAck({
                  vx: 0.0,
                  omega: 0.0,
                  pitch_cmd: pitchCmdRef.current,
                  roll_cmd: rollCmdRef.current,
                  ...respawnPayload,
                }, {
                  attempts: 3,
                  retryDelayMs: 130,
                });
                sent = Boolean(ack.ok);
              }
              if (sent) {
                addLog(`Command [${normalizedCallId}] respawn: robot reset to spawn pose`, 'info');
              } else {
                addLog(`Command [${normalizedCallId}] failed: robot transport not connected`, 'error');
              }
              output = {
                success: sent,
                command: 'respawn',
                status: sent ? 'sent' : 'failed',
                reason: sent ? '' : 'Robot transport is not connected.',
              };
            } else {
              output = {
                success: false,
                status: 'failed',
                error: `Unsupported tool: ${toolName}`,
              };
            }
          } catch (err) {
            output = {
              success: false,
              status: 'failed',
              error: err?.message || String(err),
            };
          } finally {
            if (activeRealtimeToolCallRef.current === normalizedCallId) {
              activeRealtimeToolCallRef.current = null;
            }
          }

          submitToolOutput(output);

          if (!output.success && !unmountedRef.current) {
            const reasonText = String(output.reason || output.error || 'Robot command failed.');
            setStatusMessage(`Voice command failed: ${reasonText}`);
          }
        })();
      };

      dc.onopen = () => {
        if (unmountedRef.current) return;
        setVoiceSessionConnecting(false);
        setVoiceSessionActive(true);
        setStatusMessage('Voice control ready. Start speaking!');
        addLog('Voice control session established.', 'success');

        dc.send(JSON.stringify({
          type: 'session.update',
          session: {
            instructions: sessionUpdateInstructions,
            tools: [
              {
                type: 'function',
                name: 'move',
                description: 'Move the robot forward or backward by a distance in meters.',
                parameters: {
                  type: 'object',
                  properties: {
                    direction: { type: 'string', enum: ['forward', 'backward'] },
                    distance: { type: 'number', description: 'Distance in meters' }
                  },
                  required: ['direction', 'distance']
                }
              },
              {
                type: 'function',
                name: 'rotate',
                description: 'Rotate the robot.',
                parameters: {
                  type: 'object',
                  properties: {
                    direction: { type: 'string', enum: ['left', 'right'] },
                    degrees: { type: 'number', description: 'Rotation amount in degrees' }
                  },
                  required: ['direction', 'degrees']
                }
              },
              {
                type: 'function',
                name: 'respawn',
                description: 'Respawn/reset the robot to the spawn pose.',
                parameters: {
                  type: 'object',
                  properties: {},
                  additionalProperties: false,
                }
              }
            ],
            tool_choice: 'auto',
          }
        }));
      };

      dc.onclose = () => {
        addLog('Voice control session ended.', 'info');
        stopVoiceControl('Voice control session disconnected.');
      };

      dc.onmessage = (eventMessage) => {
        let event;
        try {
          event = JSON.parse(eventMessage.data);
        } catch {
          return;
        }

        if (event.type === 'response.function_call_arguments.done') {
          handleToolCall(event.call_id, event.name, event.arguments);
          return;
        }

        if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
          handleToolCall(event.item.call_id, event.item.name, event.item.arguments);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const baseUrl = 'https://api.openai.com/v1/realtime';
      const sdpResponse = await fetch(`${baseUrl}?model=${encodeURIComponent(OPENAI_REALTIME_MODEL)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp'
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`Failed to establish OpenAI realtime session (${sdpResponse.status})`);
      }

      const answer = {
        type: 'answer',
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);

    } catch (err) {
      console.error('Voice control error:', err);
      addLog(`Failed to start voice control: ${err.message}`, 'error');
      stopVoiceControl(null);
      if (!unmountedRef.current) {
        setVoiceSessionConnecting(false);
      }
      setStatusMessage(`Voice control error: ${err.message}`);
    }
  };

  const endVoiceControl = useCallback(() => {
    sendVoiceRobotCommand({
      voice_cmd: 'stop',
      direction: 'none',
      amount: 0.0,
    });
    stopVoiceControl('Voice control session ended.');
  }, [sendVoiceRobotCommand, stopVoiceControl]);

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
    marginTop: isFullscreen ? '0.8rem' : '1.5rem',
    touchAction: 'none',
    overscrollBehavior: 'contain',
  };

  const pendingVoiceRemainingSec = pendingVoiceCommand
    ? Math.max(0, (pendingVoiceCommand.timeoutMs / 1000) - pendingVoiceElapsedSec)
    : 0;

  const actionInProgress = pendingVoiceCommand !== null;

  const pendingVoiceProgressView = useMemo(() => {
    if (!pendingVoiceCommand) {
      return null;
    }
    if (!pendingVoiceProgress || pendingVoiceProgress.callId !== pendingVoiceCommand.callId) {
      return null;
    }

    const payload = pendingVoiceProgress.payload || {};
    const command = String(payload.command || '').trim().toLowerCase();
    const ratioRaw = Number(payload.progress_ratio);
    const direction = String(payload.direction || '').trim().toLowerCase();
    const directionText = direction ? `${direction} ` : '';
    const speedRaw = Number(payload.current_speed || 0);

    if (command === 'move') {
      const target = Math.max(0, Number(payload.target_m) || 0);
      const progress = Math.max(0, Number(payload.progress_m) || 0);
      const remainingRaw = Number(payload.remaining_m);
      const remainingFallback = target > 0 ? Math.max(target - progress, 0) : 0;
      const remaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : remainingFallback;
      const ratio = Number.isFinite(ratioRaw)
        ? clamp(ratioRaw, 0, 1)
        : (target > 0 ? clamp(progress / target, 0, 1) : 0);

      return {
        ratio,
        headline: `Progress: ${directionText}${progress.toFixed(2)}m / ${target.toFixed(2)}m (${(ratio * 100).toFixed(0)}%)`,
        remaining: `${remaining.toFixed(2)}m remaining`,
        speed: `${Math.abs(speedRaw).toFixed(2)} m/s`,
      };
    }

    if (command === 'rotate') {
      const targetDegRaw = Number(payload.target_deg);
      const progressDegRaw = Number(payload.progress_deg);
      const remainingDegRaw = Number(payload.remaining_deg);

      const targetDegFallback = (Math.max(0, Number(payload.target_rad) || 0) * 180) / Math.PI;
      const progressDegFallback = (Math.max(0, Number(payload.progress_rad) || 0) * 180) / Math.PI;
      const remainingDegFallback = (Math.max(0, Number(payload.remaining_rad) || 0) * 180) / Math.PI;

      const targetDeg = Number.isFinite(targetDegRaw) ? Math.max(0, targetDegRaw) : targetDegFallback;
      const progressDeg = Number.isFinite(progressDegRaw) ? Math.max(0, progressDegRaw) : progressDegFallback;
      const remainingDeg = Number.isFinite(remainingDegRaw) ? Math.max(0, remainingDegRaw) : remainingDegFallback;
      const ratio = Number.isFinite(ratioRaw)
        ? clamp(ratioRaw, 0, 1)
        : (targetDeg > 0 ? clamp(progressDeg / targetDeg, 0, 1) : 0);
        
      const speedDeg = Math.abs(speedRaw) * 180 / Math.PI;

      return {
        ratio,
        headline: `Progress: ${directionText}${progressDeg.toFixed(0)}deg / ${targetDeg.toFixed(0)}deg (${(ratio * 100).toFixed(0)}%)`,
        remaining: `${remainingDeg.toFixed(0)}deg remaining`,
        speed: `${speedDeg.toFixed(1)} deg/s`,
      };
    }

    return null;
  }, [pendingVoiceCommand, pendingVoiceProgress]);

  const callButtonBusy = voiceSessionConnecting;
  const callButtonOn = voiceSessionActive || voiceSessionConnecting;
  const callButtonLabel = callButtonOn ? (callButtonBusy ? '📴 End Call (connecting...)' : '📴 End Call') : '📞 Start Call';

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
          Transport: {webrtcConnected
            ? 'WebRTC data channel'
            : wsConnected
              ? 'WebSocket'
              : httpFallbackActive
                ? 'HTTP fallback (restricted network mode)'
                : 'Connecting...'}
        </div>

        {httpFallbackActive ? (
          <div style={{ fontSize: '0.84rem', color: '#b45309' }}>
            WebSocket upgrades look blocked on this network. Commands are using HTTPS POST fallback at a reduced update rate.
          </div>
        ) : null}

        <div style={{ fontSize: '0.84rem', color: 'var(--text)' }}>
          Tip: share a preconfigured link like <code>?backend=192.168.1.25:8000</code>
        </div>

        {backendConfig.usingInsecureBackendFromHttpsPage ? (
          <div style={{ fontSize: '0.84rem', color: '#b45309' }}>
            This page is HTTPS but the backend target is HTTP. Browsers will block mixed-content requests; use an HTTPS/WSS backend URL.
          </div>
        ) : null}
      </div>

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
          <div style={{ fontWeight: 600 }}>Voice Control 🎙️</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                if (voiceSessionActive || voiceSessionConnecting) {
                  endVoiceControl();
                } else {
                  startVoiceControl();
                }
              }}
              disabled={!callButtonOn && !openAiKey}
              style={{
                padding: '0.45rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: callButtonOn ? 'rgba(76, 175, 80, 0.25)' : 'var(--social-bg)',
                color: 'var(--text-h)',
                cursor: (!callButtonOn && !openAiKey) ? 'not-allowed' : 'pointer',
                opacity: (!callButtonOn && !openAiKey) ? 0.65 : 1,
              }}
            >
              {callButtonLabel}
            </button>

            <button
              onClick={() => setVoicePanelExpanded((prev) => !prev)}
              style={{
                padding: '0.45rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--social-bg)',
                color: 'var(--text-h)',
                cursor: 'pointer'
              }}
            >
              {voicePanelExpanded ? '🔼 Hide Key' : '🔽 Show Key'}
            </button>
          </div>
        </div>

        {voicePanelExpanded ? (
          <>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="password"
                value={openAiKey}
                onChange={(event) => setOpenAiKey(event.target.value)}
                placeholder="OpenAI API Key (sk-...)"
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
            </div>
          </>
        ) : null}
        {/* Voice key panel is minimized by default. Use the call button above and show the key field only when needed. */}

        <div style={{ fontSize: '0.84rem', color: 'var(--text)' }}>
          Realtime session: {voiceSessionConnecting ? 'connecting...' : voiceSessionActive ? 'active' : 'idle'}
          {callButtonBusy ? ' ⏳' : voiceSessionActive ? ' ✅' : ' ⭕'}
        </div>

        {pendingVoiceCommand ? (
          <div style={{ fontSize: '0.84rem', color: 'var(--text)', display: 'grid', gap: '0.35rem' }}>
            <div>
              Waiting on robot: {pendingVoiceCommand.summary}
            </div>
            <div>
              Timer: {pendingVoiceElapsedSec.toFixed(1)}s elapsed / {(pendingVoiceCommand.timeoutMs / 1000).toFixed(0)}s limit · {pendingVoiceRemainingSec.toFixed(1)}s remaining ⏱️
            </div>

            {pendingVoiceProgressView ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                  <span>{pendingVoiceProgressView.headline}</span>
                  <span>{pendingVoiceProgressView.speed} · {pendingVoiceProgressView.remaining}</span>
                </div>
                <div
                  style={{
                    height: 8,
                    borderRadius: 999,
                    background: 'var(--social-bg)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(pendingVoiceProgressView.ratio * 100).toFixed(1)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #34d399, #10b981)',
                      transition: 'width 120ms linear',
                    }}
                  />
                </div>
              </>
            ) : (
              <div>Progress: waiting for robot telemetry...</div>
            )}
          </div>
        ) : null}

        <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.7rem', display: 'grid', gap: '0.7rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Action Controls</div>
            <button
              onClick={endActiveAction}
              disabled={!actionInProgress}
              style={{
                padding: '0.4rem 0.7rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: actionInProgress ? 'rgba(239, 68, 68, 0.18)' : 'var(--social-bg)',
                color: 'var(--text-h)',
                cursor: actionInProgress ? 'pointer' : 'not-allowed',
                opacity: actionInProgress ? 1 : 0.65,
              }}
            >
              End Action
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'grid', gap: '0.25rem', minWidth: 160 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>Move step (meters)</span>
              <input
                type="number"
                min="0.05"
                max="10"
                step="0.05"
                value={manualMoveMeters}
                onChange={(event) => setManualMoveMeters(clamp(Math.abs(Number(event.target.value) || 0), 0.05, 10.0))}
                style={{
                  padding: '0.4rem 0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg)',
                  color: 'var(--text-h)',
                }}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.25rem', minWidth: 160 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>Turn step (degrees)</span>
              <input
                type="number"
                min="1"
                max="720"
                step="1"
                value={manualTurnDegrees}
                onChange={(event) => setManualTurnDegrees(clamp(Math.abs(Number(event.target.value) || 0), 1.0, 720.0))}
                style={{
                  padding: '0.4rem 0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg)',
                  color: 'var(--text-h)',
                }}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
            <button
              onClick={() => triggerManualAction('forward')}
              disabled={actionInProgress}
              style={{
                padding: '0.55rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--social-bg)',
                color: 'var(--text-h)',
                cursor: actionInProgress ? 'not-allowed' : 'pointer',
                opacity: actionInProgress ? 0.65 : 1,
              }}
            >
              Forward
            </button>

            <button
              onClick={() => triggerManualAction('backward')}
              disabled={actionInProgress}
              style={{
                padding: '0.55rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--social-bg)',
                color: 'var(--text-h)',
                cursor: actionInProgress ? 'not-allowed' : 'pointer',
                opacity: actionInProgress ? 0.65 : 1,
              }}
            >
              Backward
            </button>

            <button
              onClick={() => triggerManualAction('left')}
              disabled={actionInProgress}
              style={{
                padding: '0.55rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--social-bg)',
                color: 'var(--text-h)',
                cursor: actionInProgress ? 'not-allowed' : 'pointer',
                opacity: actionInProgress ? 0.65 : 1,
              }}
            >
              Turn Left
            </button>

            <button
              onClick={() => triggerManualAction('right')}
              disabled={actionInProgress}
              style={{
                padding: '0.55rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--social-bg)',
                color: 'var(--text-h)',
                cursor: actionInProgress ? 'not-allowed' : 'pointer',
                opacity: actionInProgress ? 0.65 : 1,
              }}
            >
              Turn Right
            </button>
          </div>

          <div style={{ fontSize: '0.82rem', color: 'var(--text)' }}>
            {actionInProgress
              ? 'Action in progress. Wait for completion or tap End Action before triggering another movement.'
              : 'Manual buttons trigger discrete move/turn actions using the step values above.'}
          </div>
        </div>
        
        <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.7rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Diagnostic Logs</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <button
                onClick={() => setLogs([])}
                disabled={logs.length === 0}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text-h)',
                  cursor: logs.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: '0.8rem',
                  padding: '0.2rem 0.5rem',
                  opacity: logs.length === 0 ? 0.45 : 1,
                }}
              >
                Clear
              </button>
              <button
                onClick={() => setLogsExpanded(!logsExpanded)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-h)',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                {logsExpanded ? '🔼 Hide' : `🔽 Show (${logs.length})`}
              </button>
            </div>
          </div>
          
          {logsExpanded && (
            <div style={{
              marginTop: '0.5rem',
              maxHeight: '200px',
              overflowY: 'auto',
              background: 'var(--bg)',
              borderRadius: 6,
              padding: '0.5rem',
              fontSize: '0.8rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem'
            }}>
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text)', fontStyle: 'italic' }}>No logs yet...</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} style={{ display: 'flex', gap: '0.5rem' }}>
                    <span style={{ color: 'var(--text)', opacity: 0.7, flexShrink: 0 }}>[{log.time}]</span>
                    <span style={{ 
                      color: log.type === 'error' ? '#ef4444' : log.type === 'success' ? '#10b981' : 'var(--text-h)',
                      wordBreak: 'break-word'
                    }}>{log.msg}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
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

      {tuneVars.length > 0 && (
        <div
          style={{
            borderRadius: 12,
            padding: '1rem 1rem 0.75rem',
            display: 'grid',
            gap: '0.9rem',
            textAlign: 'left',
            background: 'var(--code-bg)'
          }}
        >
          <div
            style={{ fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setTunePanelExpanded((v) => !v)}
          >
            Tune {tunePanelExpanded ? '▾' : '▸'}
          </div>

          {tunePanelExpanded && (() => {
            const selected = tuneVars.find((v) => v.name === selectedTuneVar) || tuneVars[0];
            return (
              <>
                <select
                  value={selected.name}
                  onChange={(e) => setSelectedTuneVar(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.4rem',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--social-bg)',
                    color: 'var(--text-h)',
                    fontSize: '0.85rem'
                  }}
                >
                  {tuneVars.map((v) => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))}
                </select>

                <label style={{ display: 'grid', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.85rem' }}>
                    {selected.value.toFixed(4)} &nbsp;
                    <span style={{ opacity: 0.5 }}>[{selected.min} … {selected.max}] step {selected.step}</span>
                  </span>
                  <input
                    type="range"
                    min={selected.min}
                    max={selected.max}
                    step={selected.step}
                    value={selected.value}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setTuneVars((prev) =>
                        prev.map((v) => (v.name === selected.name ? { ...v, value: val } : v))
                      );
                      sendControlPayload({ tune_cmd: 'set', name: selected.name, value: val });
                    }}
                  />
                </label>

                <button
                  onClick={() => {
                    sendControlPayload({ tune_cmd: 'set', name: selected.name, value: selected.default });
                    setTuneVars((prev) =>
                      prev.map((v) => (v.name === selected.name ? { ...v, value: selected.default } : v))
                    );
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
                  Reset to default ({selected.default})
                </button>
              </>
            );
          })()}
        </div>
      )}

      <div ref={joystickPanelRef} style={panelStyle}>
        <Joystick label="Drive + Yaw (L, X/Y axes)" color="#1f77b4" onChange={handleLeftJoystick} size={joystickSize} />
        <Joystick label="Pitch + Roll (R, X/Y axes)" color="#c0392b" onChange={handleRightJoystick} size={joystickSize} />
      </div>
    </div>
  );
}

export default App;
