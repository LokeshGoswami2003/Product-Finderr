import { useCallback, useEffect, useRef, useState } from "react";
import { log, logError } from "../lib/logger";

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/chat`;
}

function eventSummary(event) {
  if (!event || typeof event !== "object") return { type: "unknown" };
  return {
    type: event.type,
    requestId: event.requestId,
    stage: event.stage,
    code: event.code,
    productCount: event.products?.length,
    sourceCount: event.sources?.length,
    stopReason: event.stopReason,
  };
}

export function useChatSocket({ enabled, onEvent }) {
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const connectRef = useRef(null);
  const attemptsRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const [status, setStatus] = useState("disconnected");

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (!enabled || socketRef.current?.readyState === WebSocket.OPEN) return;

    window.clearTimeout(reconnectTimerRef.current);
    const url = socketUrl();
    const connecting =
      attemptsRef.current === 0 ? "connecting" : "reconnecting";
    setStatus(connecting);
    log("socket", connecting, { url, attempt: attemptsRef.current });
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      attemptsRef.current = 0;
      setStatus("connected");
      log("socket", "connected", { url });
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== "answer.delta") {
          log("socket", "event", eventSummary(payload));
        }
        onEventRef.current(payload);
      } catch {
        logError("socket", "unreadable_event");
        onEventRef.current({
          type: "error",
          message: "The server returned an unreadable response.",
        });
      }
    });
    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setStatus("disconnected");
      log("socket", "disconnected");
      if (shouldReconnectRef.current) {
        const delay = Math.min(1_000 * 2 ** attemptsRef.current, 10_000);
        attemptsRef.current += 1;
        log("socket", "reconnect_scheduled", {
          delay,
          attempt: attemptsRef.current,
        });
        reconnectTimerRef.current = window.setTimeout(
          () => connectRef.current?.(),
          delay,
        );
      }
    });
  }, [enabled]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    shouldReconnectRef.current = enabled;
    if (enabled) connect();
    return () => {
      shouldReconnectRef.current = false;
      window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connect, enabled]);

  const send = useCallback((event) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      log("socket", "send_skipped", {
        type: event?.type,
        readyState: socketRef.current?.readyState,
      });
      return false;
    }
    log("socket", "send", eventSummary(event));
    socketRef.current.send(JSON.stringify(event));
    return true;
  }, []);

  return { status, connect, send };
}
