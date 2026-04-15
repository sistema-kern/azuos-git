import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const SESSION_KEY = "arenix_session_id";

function getSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

function getDeviceType(): string {
  const w = window.innerWidth;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

const BASE = import.meta.env.BASE_URL;

function isAdminSession(): boolean {
  try {
    return !!localStorage.getItem("adminToken");
  } catch {
    return false;
  }
}

function sendTrack(path: string, durationSeconds?: number) {
  if (isAdminSession()) return;
  const body: Record<string, unknown> = {
    sessionId: getSessionId(),
    path,
    referrer: document.referrer || null,
    deviceType: getDeviceType(),
  };
  if (durationSeconds != null) body.durationSeconds = durationSeconds;
  const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(`${BASE}api/analytics/track`, blob);
  } else {
    fetch(`${BASE}api/analytics/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  }
}

export function usePageTracking() {
  const [location] = useLocation();
  const startRef = useRef<number>(Date.now());
  const prevPathRef = useRef<string>(location);

  useEffect(() => {
    // If location changed, record duration for previous page
    const prev = prevPathRef.current;
    if (prev !== location) {
      const duration = Math.round((Date.now() - startRef.current) / 1000);
      if (duration > 0) sendTrack(prev, duration);
    }
    // Register new pageview
    startRef.current = Date.now();
    prevPathRef.current = location;
    sendTrack(location);

    const handleUnload = () => {
      const duration = Math.round((Date.now() - startRef.current) / 1000);
      sendTrack(location, duration);
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [location]);
}
