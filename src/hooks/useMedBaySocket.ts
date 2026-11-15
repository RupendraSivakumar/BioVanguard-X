import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientWsMessage,
  HazardScenarioId,
  ServerWsMessage,
  TelemetrySnapshot,
} from '../types/medbay.ts';

export type WsConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';

export function useMedBaySocket() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>('CONNECTING');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const backoffRef = useRef<number>(500);

  useEffect(() => {
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (unmounted) return;
        backoffRef.current = 500;
        setWsStatus('CONNECTED');
        setError(null);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerWsMessage;
          if (msg.type === 'telemetry:init' || msg.type === 'telemetry:tick') {
            setSnapshot(msg.snapshot);
          }
        } catch (err) {
          console.error('Failed to parse telemetry frame:', err);
        }
      };

      socket.onerror = () => {
        if (!unmounted) {
          setError('WebSocket link interrupted. Reconnecting...');
        }
      };

      socket.onclose = () => {
        if (unmounted) return;
        setWsStatus('RECONNECTING');
        const delay = backoffRef.current;
        backoffRef.current = Math.min(4000, delay * 1.5);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    };

    // Fetch initial telemetry snapshot via HTTP immediately so UI populates with zero latency
    fetch('/api/telemetry')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TelemetrySnapshot | null) => {
        if (data && !unmounted) {
          setSnapshot((prev) => prev ?? data);
        }
      })
      .catch(() => {});

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, []);

  const sendMessage = useCallback((msg: ClientWsMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const toggleCountermeasure = useCallback(
    (terminalId: string, active: boolean) => {
      // Optimistic local state update reconciled immediately by next WS tick
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          terminals: prev.terminals.map((t) =>
            t.id === terminalId
              ? {
                  ...t,
                  countermeasure: { ...t.countermeasure, active },
                }
              : t,
          ),
        };
      });
      sendMessage({ type: 'countermeasure:toggle', terminalId, active });
    },
    [sendMessage],
  );

  const triggerScenario = useCallback(
    (scenario: HazardScenarioId) => {
      sendMessage({ type: 'hazard:trigger', scenario });
    },
    [sendMessage],
  );

  const setSpeed = useCallback(
    (speed: number) => {
      sendMessage({ type: 'simulation:speed', speed });
    },
    [sendMessage],
  );

  const resetSimulation = useCallback(() => {
    sendMessage({ type: 'simulation:reset' });
  }, [sendMessage]);

  const generateSitRep = useCallback(() => {
    sendMessage({ type: 'report:generate' });
  }, [sendMessage]);

  return {
    snapshot,
    wsStatus,
    error,
    toggleCountermeasure,
    triggerScenario,
    setSpeed,
    resetSimulation,
    generateSitRep,
  };
}
