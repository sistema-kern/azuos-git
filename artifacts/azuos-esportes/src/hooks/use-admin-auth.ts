import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "adminToken";
const AUTH_EVENT = "admin-auth-changed";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function readToken(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function getTokenExpiry(token: string): number | null {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return null;
    const payloadB64 = token.substring(0, dotIndex);
    // base64url → base64 standard
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const payload = JSON.parse(json);
    if (typeof payload.ts !== "number") return null;
    return payload.ts + TOKEN_TTL_MS;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const expiry = getTokenExpiry(token);
  if (expiry === null) return true;
  return Date.now() >= expiry;
}

export function useAdminAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExpiryTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleExpiry = (t: string) => {
    clearExpiryTimer();
    const expiry = getTokenExpiry(t);
    if (expiry === null) return;
    const msUntilExpiry = expiry - Date.now();
    if (msUntilExpiry <= 0) return;
    timerRef.current = setTimeout(() => {
      localStorage.removeItem(STORAGE_KEY);
      setToken(null);
      window.dispatchEvent(new Event(AUTH_EVENT));
    }, msUntilExpiry);
  };

  useEffect(() => {
    const sync = () => {
      const t = readToken();
      if (t && isTokenExpired(t)) {
        localStorage.removeItem(STORAGE_KEY);
        setToken(null);
      } else {
        setToken(t);
        if (t) scheduleExpiry(t);
      }
      setIsLoaded(true);
    };
    sync();
    window.addEventListener(AUTH_EVENT, sync);
    return () => {
      window.removeEventListener(AUTH_EVENT, sync);
      clearExpiryTimer();
    };
  }, []);

  const login = (newToken: string) => {
    localStorage.setItem(STORAGE_KEY, newToken);
    setToken(newToken);
    scheduleExpiry(newToken);
    window.dispatchEvent(new Event(AUTH_EVENT));
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    clearExpiryTimer();
    setToken(null);
    window.dispatchEvent(new Event(AUTH_EVENT));
  };

  const getAuthHeaders = (): Record<string, string> => {
    // Always read from localStorage directly to avoid stale closure issues
    const currentToken = readToken();
    const headers: Record<string, string> = currentToken ? { "x-admin-key": currentToken } : {};
    
    // If tenantId is in query param (for testing/development), add it to headers
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get("tenantId");
    if (tenantId) {
      headers["x-tenant-id"] = tenantId;
    }
    
    return headers;
  };

  return { token, isLoaded, login, logout, getAuthHeaders, isAuthenticated: !!token };
}
