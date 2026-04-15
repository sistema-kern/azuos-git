import { useState, useEffect } from "react";
import { getTenantHeaders } from "@/lib/tenantHeaders";

export interface CompanyProfile {
  company_name: string;
  company_cnpj: string;
  company_phone: string;
  company_address: string;
  company_description: string;
  contact_email: string;
  contact_map_embed: string;
  logo_url: string;
  favicon_url: string;
  theme_primary: string;
  theme_background: string;
  theme_primary_foreground: string;
  instagram_handle: string;
  instagram_description: string;
  copa_page_name: string;
  copa_page_title: string;
  copa_page_description: string;
  nav_hidden: string;
  tenant_active: boolean;
  super_logo_url: string;
}

const DEFAULT_PROFILE: CompanyProfile = {
  company_name: "",
  company_cnpj: "",
  company_phone: "",
  company_address: "",
  company_description: "",
  contact_email: "",
  contact_map_embed: "",
  logo_url: "",
  favicon_url: "",
  theme_primary: "#c9a227",
  theme_background: "#0a0a0a",
  theme_primary_foreground: "#000000",
  instagram_handle: "",
  instagram_description: "",
  copa_page_name: "Copa",
  copa_page_title: "",
  copa_page_description: "",
  nav_hidden: "[]",
  tenant_active: true,
  super_logo_url: "",
};

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Returns true when the current page is the super admin panel */
function isOnSuperPath(): boolean {
  return window.location.pathname.endsWith("/super") ||
    window.location.pathname.includes("/super/");
}

/**
 * Applies a favicon to the browser tab.
 * Removes existing icon links and creates a fresh one with a cache-busting
 * timestamp so the browser is forced to re-fetch the image.
 * Skipped on /super routes (Super.tsx manages its own platform favicon).
 */
export function applyFavicon(faviconUrl: string, force = false) {
  if (!faviconUrl) return;
  if (!force && isOnSuperPath()) return;

  document.querySelectorAll("link[rel~='icon']").forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = faviconUrl.includes("?")
    ? `${faviconUrl}&_t=${Date.now()}`
    : `${faviconUrl}?_t=${Date.now()}`;
  document.head.appendChild(link);
}

function applyTheme(profile: CompanyProfile) {
  const root = document.documentElement;
  const primary = hexToHsl(profile.theme_primary);
  if (primary) {
    const hsl = `${primary.h} ${primary.s}% ${primary.l}%`;
    root.style.setProperty("--primary", hsl);
    root.style.setProperty("--accent", hsl);
    root.style.setProperty("--ring", hsl);
    const highlightL = Math.min(primary.l + 22, 90);
    const highlightS = Math.min(primary.s + 10, 100);
    root.style.setProperty("--primary-highlight", `${primary.h} ${highlightS}% ${highlightL}%`);
  }
  const bg = hexToHsl(profile.theme_background);
  if (bg) {
    root.style.setProperty("--background", `${bg.h} ${bg.s}% ${bg.l}%`);
  }
  const pfg = hexToHsl(profile.theme_primary_foreground);
  if (pfg) {
    root.style.setProperty("--primary-foreground", `${pfg.h} ${pfg.s}% ${pfg.l}%`);
    root.style.setProperty("--accent-foreground", `${pfg.h} ${pfg.s}% ${pfg.l}%`);
  }
}

let cachedProfile: CompanyProfile | null = null;
let cachedProfileTenantId: string | null = null;
const listeners: Array<(p: CompanyProfile) => void> = [];

function getCurrentTenantKey(): string {
  return new URLSearchParams(window.location.search).get("tenantId") ?? "__default__";
}

export function invalidateProfileCache() {
  cachedProfile = null;
  cachedProfileTenantId = null;
}

export function useCompanyProfile() {
  const tenantKey = getCurrentTenantKey();
  const validCache = cachedProfile && cachedProfileTenantId === tenantKey;
  const [profile, setProfile] = useState<CompanyProfile>(validCache ? cachedProfile! : DEFAULT_PROFILE);
  const [loading, setLoading] = useState(!validCache);

  useEffect(() => {
    if (validCache) {
      setProfile(cachedProfile!);
      setLoading(false);
      return;
    }
    fetch(`${import.meta.env.BASE_URL}api/profile`, { headers: getTenantHeaders() })
      .then((r) => r.json())
      .then((data: CompanyProfile) => {
        cachedProfile = data;
        cachedProfileTenantId = tenantKey;
        setProfile(data);
        applyTheme(data);
        // Set document title to the tenant's company name (skipped on /super)
        if (!isOnSuperPath() && data.company_name) {
          document.title = data.company_name;
        }
        // Apply favicon — skipped on /super so Super.tsx can manage its own
        applyFavicon(data.favicon_url);
        listeners.forEach((fn) => fn(data));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { profile, loading };
}

export function useApplyTheme() {
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/profile`, { headers: getTenantHeaders() })
      .then((r) => r.json())
      .then((data: CompanyProfile) => {
        cachedProfile = data;
        applyTheme(data);
      })
      .catch(() => {});
  }, []);
}
