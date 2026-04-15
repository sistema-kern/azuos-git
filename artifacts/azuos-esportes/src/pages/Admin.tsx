import { PageLayout } from "@/components/layout/PageLayout";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { useLocation } from "wouter";
import { Button, Card, Input, Label, Badge, Modal } from "@/components/ui";
import { showToast, showConfirm, showMatchResult } from "@/lib/toast";
import { AdminClientes } from "@/components/AdminClientes";
import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import {
  Shield, LogOut, Plus, Trash2, Edit2, Play, Image as ImageIcon, Settings, Key, Save, Clock, Calendar, Ban, ToggleLeft, ToggleRight, Upload, DollarSign, CalendarDays, Bell, BellOff, Circle, RefreshCw, X, ChevronDown, Phone, MessageSquare, QrCode, User, Building2, Palette, CheckCircle2, Instagram, Trophy, Mail, Send, Eye, Users, Filter, ChevronRight, AlertTriangle, Check, Loader2, Search, Tag, Globe, TrendingUp, FileText,
} from "lucide-react";
import {
  useGetTournaments, useCreateTournament, useUpdateTournament, useDeleteTournament,
  useGetTournamentCategories, useCreateCategory, useDeleteCategory,
  useGenerateGroups,
  useGetPairs, useCreatePair, useDeletePair, useGetMatches, useUpdateMatchResult,
  useGetCourtBookings, useGetClassBookings,
  useGetGallery, useAddGalleryPhoto, useDeleteGalleryPhoto,
  useGetSponsors, useCreateSponsor, useUpdateSponsor, useDeleteSponsor,
} from "@workspace/api-client-react";
import type {
  CourtBooking, ClassBooking, GalleryPhoto, Match, Pair, Sponsor,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { formatDate, cn, formatCurrency } from "@/lib/utils";
import { useCompanyProfile, invalidateProfileCache } from "@/hooks/useCompanyProfile";
import { EmailEditor } from "@/components/EmailEditor";
import AdminDesempenho from "@/components/AdminDesempenho";
import AdminRelatorios from "@/components/AdminRelatorios";

const maskCurrency = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  const intValue = parseInt(digits || "0", 10);
  return (intValue / 100).toFixed(2).replace(".", ",");
};

const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

const maskCNPJ = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
};

const unmaskCurrency = (value: string): string => {
  return value.replace(/\D/g, "");
};

const formatPrice = (value: string | number | undefined): string => {
  if (!value) return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";
  return num.toFixed(2).replace(".", ",");
};

const getStatusLabel = (status: string, isCompleted?: boolean): string => {
  if (isCompleted) return "Concluída";
  switch (status) {
    case "confirmed": return "Confirmado";
    case "pending": return "Pendente";
    case "cancelled": return "Cancelado";
    default: return status;
  }
};

const getStatusShort = (status: string): string => {
  switch (status) {
    case "confirmed": return "C";
    case "pending": return "P";
    case "cancelled": return "Ca";
    default: return status;
  }
};

const formatDuration = (hours: number): string => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
};

type AdminTab = "reservas" | "clientes" | "torneios" | "galeria" | "configuracoes" | "perfil" | "email" | "desempenho" | "relatorios";
type ReservaTab = "quadras" | "aulas";
type CatSubTab = "duplas" | "jogos" | "quadras";

function PushNotificationButton({ tenantId, authHeaders }: { tenantId: number | null; authHeaders: Record<string, string> }) {
  const [status, setStatus] = useState<"unknown" | "unsupported" | "denied" | "subscribed" | "unsubscribed">("unknown");
  const [loading, setLoading] = useState(false);
  const BASE = import.meta.env.BASE_URL;

  const getSubscription = async (): Promise<PushSubscription | null> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  };

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    getSubscription().then(sub => {
      if (Notification.permission === "denied") setStatus("denied");
      else if (sub) setStatus("subscribed");
      else setStatus("unsubscribed");
    }).catch(() => setStatus("unsupported"));
  }, []);

  const subscribe = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const vapidRes = await fetch(`${BASE}api/push/vapid-public-key`);
      const { publicKey } = await vapidRes.json() as { publicKey: string };

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await fetch(`${BASE}api/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ tenantId, subscription: sub.toJSON() }),
      });
      setStatus("subscribed");
    } catch {
      if (Notification.permission === "denied") setStatus("denied");
    } finally { setLoading(false); }
  };

  const unsubscribe = async () => {
    setLoading(true);
    try {
      const sub = await getSubscription();
      if (sub) {
        await fetch(`${BASE}api/push/unsubscribe`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("unsubscribed");
    } finally { setLoading(false); }
  };

  if (status === "unknown" || status === "unsupported") return null;

  if (status === "denied") {
    return (
      <button disabled title="Notificações bloqueadas no navegador" className="p-2 rounded-lg border border-white/10 text-muted-foreground opacity-50 cursor-not-allowed">
        <BellOff size={18} />
      </button>
    );
  }

  if (status === "subscribed") {
    return (
      <button
        onClick={unsubscribe}
        disabled={loading}
        title="Push ativo — clique para desativar"
        className="relative p-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
        <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
      </button>
    );
  }

  return (
    <button
      onClick={subscribe}
      disabled={loading}
      title="Ativar notificações no celular"
      className="p-2 rounded-lg border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors"
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : <BellOff size={18} />}
    </button>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function NotificationBell({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const getMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };

  const isDismissed = () =>
    localStorage.getItem("notifDismissedMonth") === getMonthKey();

  const dismiss = () =>
    localStorage.setItem("notifDismissedMonth", getMonthKey());

  const fetchCount = () => {
    setLoading(true);
    const debug = typeof window !== "undefined" && localStorage.getItem("DEBUG_NEAR_MONTH_END") === "true";
    const url = `${import.meta.env.BASE_URL}api/clients/plans/near-expiry${debug ? "?debug=true" : ""}`;
    fetch(url, { headers: authHeaders })
      .then(r => r.json())
      .then((d: { count?: number }) => setCount(d.count ?? 0))
      .catch(() => setCount(0))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (Object.keys(authHeaders).length === 0) return;
    fetchCount();
    const interval = setInterval(fetchCount, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [authHeaders]);

  const hasNotification = count > 0 && !isDismissed();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "relative p-2 rounded-lg border transition-colors",
          hasNotification
            ? "border-yellow-500/60 text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20"
            : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20",
        )}
        title="Notificações do sistema"
      >
        <Bell size={18} />
        {hasNotification && (
          <span className="absolute -top-1.5 -right-1.5 bg-yellow-500 text-black text-[10px] font-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-0.5">
            1
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 md:bg-transparent" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-card border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-secondary">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-primary" />
                <span className="font-bold text-sm">Notificações</span>
                {hasNotification && <Badge variant="gold" className="text-[10px] px-1.5 py-0">1</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); fetchCount(); }}
                  className="p-1 hover:text-primary text-muted-foreground transition-colors rounded"
                  title="Atualizar"
                >
                  <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                </button>
                <button onClick={() => setOpen(false)} className="p-1 hover:text-foreground text-muted-foreground transition-colors rounded">
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {count === 0 ? (
                <div className="px-4 py-6 text-center">
                  <Bell size={24} className="text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhuma notificação no momento.</p>
                </div>
              ) : (
                <div className="px-4 py-4">
                  <div className={cn(
                    "rounded-xl p-4 border",
                    hasNotification
                      ? "bg-yellow-500/8 border-yellow-500/25"
                      : "bg-white/5 border-white/10 opacity-50"
                  )}>
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-9 h-9 rounded-full bg-yellow-500/15 border border-yellow-500/25 flex items-center justify-center mt-0.5">
                        <Bell size={15} className="text-yellow-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-yellow-300">Planos Mensalistas a Expirar</p>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                          {count} plano{count !== 1 ? "s" : ""} ativo{count !== 1 ? "s" : ""} {count !== 1 ? "precisam" : "precisa"} de cobrança para renovação no próximo mês.
                        </p>
                        <p className="text-xs text-yellow-400/80 mt-2 font-semibold leading-relaxed">
                          Acesse: Clientes → filtre por "Ativo – Aguardando próx. pgto" e realize as cobranças.
                        </p>
                        {hasNotification && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dismiss();
                              setOpen(false);
                            }}
                            className="mt-3 text-[11px] text-muted-foreground hover:text-foreground transition-colors border border-white/10 hover:border-white/20 rounded-lg px-3 py-1.5 w-full text-center"
                          >
                            Ciente — ocultar até o próximo mês
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Admin() {
  const { isAuthenticated, isLoaded, logout, getAuthHeaders } = useAdminAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isLoaded && !isAuthenticated) navigate("/login");
  }, [isLoaded, isAuthenticated]);
  const [activeTab, setActiveTab] = useState<AdminTab>("reservas");
  const [displayCompanyName, setDisplayCompanyName] = useState("Azuos Esportes");
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenantActive, setTenantActive] = useState(true);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/profile`, { headers: getAuthHeaders() });
        const data = await res.json() as { company_name?: string; tenant_id?: number; tenant_active?: boolean };
        if (data.company_name) setDisplayCompanyName(data.company_name);
        if (data.tenant_id) setTenantId(data.tenant_id);
        if (data.tenant_active !== undefined) setTenantActive(data.tenant_active);
      } catch { /* keep default */ }
    };
    void loadProfile();
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
    }
  }, []);

  if (!isAuthenticated) {
    return null;
  }

  if (!tenantActive) {
    return (
      <PageLayout hideFooter>
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="text-center">
            <AlertTriangle className="w-16 h-16 text-destructive mx-auto mb-4" />
            <h1 className="text-3xl font-bold mb-2">Acesso Negado</h1>
            <p className="text-muted-foreground mb-6 max-w-md">Este espaço foi cancelado ou suspenso e não está disponível para acesso.</p>
            <Button onClick={() => window.location.href = "/"} variant="outline">Voltar para Home</Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout hideFooter>
      <div className="max-w-[1600px] mx-auto px-2 md:px-4 py-4 md:py-8">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-4 md:mb-8 gap-4">
          <div className="flex-1">
            <h1 className="text-2xl md:text-4xl font-display font-bold gold-gradient-text">PAINEL</h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden md:block">Gerencie o sistema completo da {displayCompanyName}</p>
          </div>
          <div className="flex items-center gap-2 self-end md:self-center">
            <PushNotificationButton tenantId={tenantId} authHeaders={getAuthHeaders()} />
            <NotificationBell authHeaders={getAuthHeaders()} />
            <Button variant="outline" onClick={logout} className="gap-1 md:gap-2 border-white/10 text-xs md:text-sm px-2 md:px-4 py-1 md:py-2">
              <LogOut size={14} /> <span className="hidden md:inline">Sair</span>
            </Button>
          </div>
        </div>

        <div className="flex space-x-1 md:space-x-2 border-b border-white/10 mb-4 md:mb-8 overflow-x-auto">
          {(["reservas", "clientes", "torneios", "galeria", "email", "configuracoes", "perfil", "desempenho", "relatorios"] as AdminTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={cn(
                "px-2 md:px-6 py-2 md:py-3 font-bold uppercase tracking-wider text-xs md:text-sm rounded-t-lg transition-colors whitespace-nowrap flex items-center gap-1 md:gap-2",
                activeTab === t ? "bg-primary text-black" : "bg-card text-muted-foreground hover:bg-white/5",
              )}
            >
              {t === "configuracoes" && <Settings size={12} className="md:w-[14px] md:h-[14px]" />}
              {t === "perfil" && <User size={12} className="md:w-[14px] md:h-[14px]" />}
              {t === "email" && <Mail size={12} className="md:w-[14px] md:h-[14px]" />}
              {t === "desempenho" && <TrendingUp size={12} className="md:w-[14px] md:h-[14px]" />}
              {t === "relatorios" && <FileText size={12} className="md:w-[14px] md:h-[14px]" />}
              <span className="hidden md:inline">
                {t === "configuracoes" ? "Configurações" : t === "perfil" ? "Meu Perfil" : t === "email" ? "Email MKT" : t === "desempenho" ? "Desempenho" : t === "relatorios" ? "Relatórios" : t}
              </span>
              <span className="md:hidden">
                {t === "reservas" ? "RES" : t === "clientes" ? "CLI" : t === "torneios" ? "TOR" : t === "galeria" ? "GAL" : t === "perfil" ? "PRF" : t === "email" ? "EML" : t === "desempenho" ? "DES" : t === "relatorios" ? "REL" : "CONF"}
              </span>
            </button>
          ))}
        </div>

        {activeTab === "reservas" && <AdminReservas />}
        {activeTab === "clientes" && <AdminClientes />}
        {activeTab === "torneios" && <AdminTorneios />}
        {activeTab === "galeria" && <AdminGaleria />}
        {activeTab === "email" && <AdminEmailMKT />}
        {activeTab === "configuracoes" && <AdminConfiguracoes />}
        {activeTab === "perfil" && <AdminMeuPerfil onCompanyNameChange={setDisplayCompanyName} />}
        {activeTab === "desempenho" && <AdminDesempenho />}
        {activeTab === "relatorios" && <AdminRelatorios />}
      </div>
    </PageLayout>
  );
}

function AdminReservas() {
  const { getAuthHeaders } = useAdminAuth();
  const { profile } = useCompanyProfile();
  const beachTennisHidden = (() => { try { return JSON.parse(profile.nav_hidden ?? "[]").includes("/beach-tennis"); } catch { return false; } })();
  const [tab, setTab] = useState<ReservaTab>("quadras");
  const [isNewBookingOpen, setIsNewBookingOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<(CourtBooking | ClassBooking) & { type: "court" | "class" } | null>(null);
  const [pixData, setPixData] = useState<{ pixQrCode: string; pixQrCodeBase64: string; amount: number } | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [markPaidLoading, setMarkPaidLoading] = useState(false);
  const [pixKey, setPixKey] = useState("");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/settings/pix-key`)
      .then(r => r.json())
      .then((d: { pix_key?: string }) => { if (d.pix_key) setPixKey(d.pix_key); })
      .catch(() => {});
  }, []);

  const { data: courts, refetch: refetchCourts } = useGetCourtBookings({ request: { headers: getAuthHeaders() }, query: { staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true } });
  const { data: classes, refetch: refetchClasses } = useGetClassBookings({ request: { headers: getAuthHeaders() }, query: { staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true } });

  // Get today's date in YYYY-MM-DD format
  const getTodayDate = (): string => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCourt, setFilterCourt] = useState<number | "">("");
  const [filterDate, setFilterDate] = useState(getTodayDate());
  const [filterStatus, setFilterStatus] = useState<"upcoming_confirmed" | "all" | "confirmed" | "pending" | "cancelled">("upcoming_confirmed");
  const [showFilters, setShowFilters] = useState(false);

  // Get time until reservation starts (in milliseconds)
  const getTimeUntilStart = (date: string, time: string): number => {
    const [hours, minutes] = time.split(":").map(Number);
    const [year, month, day] = date.split("-").map(Number);
    const reservationTime = new Date(year, month - 1, day, hours, minutes).getTime();
    return reservationTime - Date.now();
  };

  // Get end time based on start time and duration
  const getEndTime = (time: string, durationHours: number | string): string => {
    const [h, m] = time.split(":").map(Number);
    const totalMins = h * 60 + m + Math.round(Number(durationHours) * 60);
    const endH = Math.floor(totalMins / 60) % 24;
    const endM = totalMins % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  };

  // Create a map of court numbers to names from data
  const courtNameMap = new Map<number, string>();
  (courts ?? []).forEach((b: CourtBooking) => {
    const courtNum = (b as CourtBooking & { courtNumber?: number }).courtNumber ?? 1;
    const courtName = (b as CourtBooking & { courtName?: string }).courtName;
    if (courtName) {
      courtNameMap.set(courtNum, courtName);
    }
  });

  // Map court numbers to names (from database)
  const getCourtName = (courtNumber: number) => {
    return courtNameMap.get(courtNumber) || `Quadra ${courtNumber}`;
  };

  // Extract unique courts from data
  const uniqueCourts = Array.from(
    new Set((courts ?? []).map((b: CourtBooking) => (b as CourtBooking & { courtNumber?: number }).courtNumber ?? 1))
  ).sort((a, b) => a - b);

  // Filter function
  const filterBookings = (bookings: (CourtBooking | ClassBooking)[] | undefined) => {
    if (!bookings) return [];
    return bookings.filter((b) => {
      const matchSearch = !searchQuery || 
        b.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.customerPhone.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchCourt = !filterCourt || (b as CourtBooking & { courtNumber?: number }).courtNumber === filterCourt;
      
      const matchDate = !filterDate || b.date === filterDate;
      
      // Status filter logic
      let matchStatus = true;
      if (filterStatus === "upcoming_confirmed") {
        // Show only confirmed bookings that haven't started yet
        const timeUntilStart = getTimeUntilStart(b.date, b.time);
        matchStatus = b.status === "confirmed" && timeUntilStart > 0;
      } else if (filterStatus === "all") {
        // Show all regardless of status
        matchStatus = true;
      } else {
        // Show specific status
        matchStatus = b.status === filterStatus;
      }
      
      return matchSearch && matchCourt && matchDate && matchStatus;
    });
  };

  const filteredCourts = filterBookings(courts);
  const filteredClasses = filterBookings(classes);

  const handleCancelBooking = async (bookingId: number, type: "court" | "class") => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/bookings/${bookingId}/cancel`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ type }),
      });

      if (res.ok) {
        showToast.success("Reserva cancelada com sucesso!");
        if (type === "court") {
          void refetchCourts();
        } else {
          void refetchClasses();
        }
      } else {
        showToast.error("Erro ao cancelar reserva");
      }
    } catch (err) {
      console.error("Erro:", err);
      showToast.error("Erro ao cancelar reserva");
    }
  };

  const handleGeneratePix = async (bookingId: number, type: "court" | "class") => {
    setPixLoading(true);
    setPixData(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/bookings/${bookingId}/generate-pix`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ type }),
      });
      const data = await res.json() as { pixQrCode?: string; pixQrCodeBase64?: string; amount?: number; error?: string };
      if (!res.ok) { showToast.error(data.error ?? "Erro ao gerar PIX"); return; }
      setPixData({ pixQrCode: data.pixQrCode ?? "", pixQrCodeBase64: data.pixQrCodeBase64 ?? "", amount: data.amount ?? 0 });
    } catch {
      showToast.error("Erro ao gerar PIX");
    } finally {
      setPixLoading(false);
    }
  };

  const handleMarkPaid = async (bookingId: number, type: "court" | "class") => {
    setMarkPaidLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/bookings/${bookingId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ type }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) { showToast.error(data.error ?? "Erro ao confirmar pagamento"); return; }
      showToast.success("Pagamento confirmado! Reserva confirmada.");
      if (type === "court") void refetchCourts(); else void refetchClasses();
      setSelectedBooking(prev => prev ? { ...prev, status: "confirmed" } : null);
      setPixData(null);
    } catch {
      showToast.error("Erro ao confirmar pagamento");
    } finally {
      setMarkPaidLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <NovaReservaModal
        isOpen={isNewBookingOpen}
        onClose={() => setIsNewBookingOpen(false)}
        onSuccess={() => { void refetchCourts(); void refetchClasses(); }}
        beachTennisHidden={beachTennisHidden}
      />

      <div className="flex items-center justify-between border-b border-white/10 mb-6 pb-1">
        <div className="flex gap-2">
          {(["quadras", ...(!beachTennisHidden ? ["aulas"] : [])] as ReservaTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-5 py-2 font-bold uppercase text-sm",
                tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground",
              )}
            >
              {t === "quadras" ? "Quadras" : "Aulas (Beach Tennis)"}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => setIsNewBookingOpen(true)} className="border-yellow-500 text-yellow-400 hover:bg-yellow-500/10 text-xs md:text-sm px-2 md:px-4">
          <Calendar size={14} className="md:mr-2" /> <span className="hidden md:inline">Nova Reserva</span>
        </Button>
      </div>

      {tab === "quadras" && (
        <Card className="p-3 md:p-6">
          <h2 className="text-lg md:text-2xl font-display font-bold mb-4 md:mb-6">Reservas de Quadra</h2>
          
          {/* Mobile Filter Button */}
          <div className="md:hidden mb-3 flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors border border-primary/30 flex items-center justify-center gap-2"
            >
              <div className="w-4 h-4 flex flex-col justify-center gap-1">
                <div className="h-0.5 bg-current w-full"></div>
                <div className="h-0.5 bg-current w-full"></div>
                <div className="h-0.5 bg-current w-full"></div>
              </div>
              Filtros
            </button>
          </div>

          {/* Filters Panel */}
          <div className={cn("grid gap-2 md:gap-3 mb-4 md:mb-6", showFilters ? "grid-cols-1 md:grid-cols-4" : "hidden md:grid md:grid-cols-4")}>
            <Input
              placeholder="Nome/tel"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-secondary border-white/10 text-xs md:text-sm"
            />
            <select
              value={filterCourt}
              onChange={(e) => setFilterCourt(e.target.value ? Number(e.target.value) : "")}
              className="bg-secondary border border-white/10 rounded-lg px-2 md:px-3 py-2 text-xs md:text-sm text-foreground"
            >
              <option value="">Quadras</option>
              {uniqueCourts.map((court) => (
                <option key={court} value={court}>{getCourtName(court)}</option>
              ))}
            </select>
            <Input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="bg-secondary border-white/10 text-xs md:text-sm"
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as "upcoming_confirmed" | "all" | "confirmed" | "pending" | "cancelled")}
              className="bg-secondary border border-white/10 rounded-lg px-2 md:px-3 py-2 text-xs md:text-sm text-foreground"
            >
              <option value="upcoming_confirmed">Em breve</option>
              <option value="all">Todos</option>
              <option value="confirmed">Confirmado</option>
              <option value="pending">Pendente</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>

          {filteredCourts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery || filterCourt || filterDate || filterStatus ? "Nenhuma reserva encontrada com esses filtros." : "Nenhuma reserva."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredCourts
                .sort((a, b) => getTimeUntilStart(a.date, a.time) - getTimeUntilStart(b.date, b.time))
                .map((b: CourtBooking) => {
                  const timeUntil = getTimeUntilStart(b.date, b.time);
                  const hoursUntil = Math.floor(timeUntil / (1000 * 60 * 60));
                  const minutesUntil = Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60));
                  const courtNum = (b as CourtBooking & { courtNumber?: number }).courtNumber ?? 1;
                  
                  return (
                    <div 
                      key={b.id} 
                      onClick={() => setSelectedBooking({ ...b, type: "court" })}
                      className="bg-secondary rounded-lg border border-white/10 p-4 hover:border-primary/30 cursor-pointer transition-all hover:shadow-lg"
                    >
                      {/* Time badge */}
                      <div className="flex items-center gap-2 mb-3">
                        {b.status === "confirmed" && timeUntil > 0 && (
                          <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                            <Clock className="w-3 h-3 mr-1" />
                            EM {hoursUntil}H{minutesUntil > 0 ? ` ${minutesUntil}M` : ""}
                          </Badge>
                        )}
                      </div>

                      {/* Time and Client name */}
                      <div className="text-sm mb-3">
                        <div className="flex justify-between items-baseline">
                          <div className="font-bold text-base text-white">
                            {b.time} às {getEndTime(b.time, (b as CourtBooking & { durationHours?: number }).durationHours ?? 1)}
                          </div>
                          <div className="font-bold text-base text-white">
                            {b.customerName === "BLOQUEADO" ? "BLOQUEADO PELO SISTEMA" : b.customerName}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">{formatDate(b.date)}</div>
                      </div>

                      {/* Status and Court/Location */}
                      <div className="flex justify-between items-start mb-3 pb-3 border-b border-white/5">
                        <Badge 
                          variant={b.status === "confirmed" && timeUntil > 0 ? "gold" : "outline"} 
                          className={`text-xs ${b.status === "cancelled" ? "bg-red-500/20 text-red-400 border-red-500/30" : ""}`}
                        >
                          {getStatusLabel(b.status, b.status === "confirmed" && timeUntil <= 0)}
                        </Badge>
                      </div>

                      {/* Court and price */}
                      <div className="flex justify-between items-end">
                        <div className="text-xs text-muted-foreground">
                          <div className="font-bold text-white">
                            {(b as CourtBooking & { courtName?: string }).courtName || getCourtName(courtNum)}
                          </div>
                        </div>
                        <div className="font-bold text-primary text-lg">R$ {b.amount}</div>
                      </div>

                      {/* Quick action buttons for pending bookings */}
                      {b.status === "pending" && b.customerName !== "BLOQUEADO" && (
                        <div className="flex gap-2 mt-2 pt-2 border-t border-white/5" onClick={e => e.stopPropagation()}>
                          {b.customerPhone && b.customerPhone !== "-" && (
                            <a
                              href={`https://wa.me/55${b.customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${b.customerName}! 🎾\n\nSua reserva de quadra está aguardando pagamento.\n📅 ${formatDate(b.date)} às ${b.time}\n💰 Valor: R$ ${b.amount}\n${pixKey ? `\n🔑 Chave PIX: *${pixKey}*` : ""}\n\nFavor realizar o pagamento via PIX para confirmar sua reserva.`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors"
                            >
                              <Phone size={12} /> WhatsApp
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => { setSelectedBooking({ ...b, type: "court" }); void handleGeneratePix(b.id, "court"); }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/30 transition-colors"
                          >
                            <QrCode size={12} /> QR Code PIX
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      )}

      {tab === "aulas" && (
        <Card className="p-3 md:p-6">
          <h2 className="text-lg md:text-2xl font-display font-bold mb-4 md:mb-6">Reservas de Aulas</h2>
          
          {/* Mobile Filter Button */}
          <div className="md:hidden mb-3 flex gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-primary/20 text-primary hover:bg-primary/30 transition-colors border border-primary/30 flex items-center justify-center gap-2"
            >
              <div className="w-4 h-4 flex flex-col justify-center gap-1">
                <div className="h-0.5 bg-current w-full"></div>
                <div className="h-0.5 bg-current w-full"></div>
                <div className="h-0.5 bg-current w-full"></div>
              </div>
              Filtros
            </button>
          </div>

          {/* Filters Panel */}
          <div className={cn("grid gap-2 md:gap-3 mb-4 md:mb-6", showFilters ? "grid-cols-1 md:grid-cols-3" : "hidden md:grid md:grid-cols-3")}>
            <Input
              placeholder="Nome/tel"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-secondary border-white/10 text-xs md:text-sm"
            />
            <Input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="bg-secondary border-white/10 text-xs md:text-sm"
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as "upcoming_confirmed" | "all" | "confirmed" | "pending" | "cancelled")}
              className="bg-secondary border border-white/10 rounded-lg px-2 md:px-3 py-2 text-xs md:text-sm text-foreground"
            >
              <option value="upcoming_confirmed">Em breve</option>
              <option value="all">Todos</option>
              <option value="confirmed">Confirmado</option>
              <option value="pending">Pendente</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>

          {filteredClasses.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery || filterDate || filterStatus ? "Nenhuma reserva encontrada com esses filtros." : "Nenhuma reserva."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredClasses
                .sort((a, b) => getTimeUntilStart(a.date, a.time) - getTimeUntilStart(b.date, b.time))
                .map((b: ClassBooking) => {
                  const timeUntil = getTimeUntilStart(b.date, b.time);
                  const hoursUntil = Math.floor(timeUntil / (1000 * 60 * 60));
                  const minutesUntil = Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60));
                  
                  return (
                    <div 
                      key={b.id} 
                      onClick={() => setSelectedBooking({ ...b, type: "class" })}
                      className="bg-secondary rounded-lg border border-white/10 p-4 hover:border-primary/30 cursor-pointer transition-all hover:shadow-lg"
                    >
                      {/* Time badge */}
                      <div className="flex items-center gap-2 mb-3">
                        {b.status === "confirmed" && timeUntil > 0 && (
                          <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                            <Clock className="w-3 h-3 mr-1" />
                            EM {hoursUntil}H{minutesUntil > 0 ? ` ${minutesUntil}M` : ""}
                          </Badge>
                        )}
                      </div>

                      {/* Time and Client name */}
                      <div className="text-sm mb-3">
                        <div className="flex justify-between items-baseline">
                          <div className="font-bold text-base text-white">{b.time}</div>
                          <div className="font-bold text-base text-white">
                            {b.customerName === "BLOQUEADO" ? "BLOQUEADO PELO SISTEMA" : b.customerName}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">{formatDate(b.date)}</div>
                      </div>

                      {/* Status and Type */}
                      <div className="flex justify-between items-start mb-3 pb-3 border-b border-white/5">
                        <Badge 
                          variant={b.status === "confirmed" && timeUntil > 0 ? "gold" : "outline"} 
                          className={`text-xs ${b.status === "cancelled" ? "bg-red-500/20 text-red-400 border-red-500/30" : ""}`}
                        >
                          {getStatusLabel(b.status, b.status === "confirmed" && timeUntil <= 0)}
                        </Badge>
                      </div>

                      {/* Class info and price */}
                      <div className="flex justify-between items-end">
                        <div className="text-xs text-muted-foreground">
                          <div className="font-bold text-white">Aula - {b.numberOfPeople} {b.numberOfPeople === 1 ? "pessoa" : "pessoas"}</div>
                        </div>
                        <div className="font-bold text-primary text-lg">R$ {b.amount}</div>
                      </div>

                      {/* Quick action buttons for pending class bookings */}
                      {b.status === "pending" && b.customerName !== "BLOQUEADO" && (
                        <div className="flex gap-2 mt-2 pt-2 border-t border-white/5" onClick={e => e.stopPropagation()}>
                          {b.customerPhone && b.customerPhone !== "-" && (
                            <a
                              href={`https://wa.me/55${b.customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${b.customerName}! 🎾\n\nSua reserva de aula de Beach Tennis está aguardando pagamento.\n📅 ${formatDate(b.date)} às ${b.time}\n💰 Valor: R$ ${b.amount}\n${pixKey ? `\n🔑 Chave PIX: *${pixKey}*` : ""}\n\nFavor realizar o pagamento via PIX para confirmar sua reserva.`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors"
                            >
                              <Phone size={12} /> WhatsApp
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => { setSelectedBooking({ ...b, type: "class" }); void handleGeneratePix(b.id, "class"); }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/30 transition-colors"
                          >
                            <QrCode size={12} /> QR Code PIX
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </Card>
      )}

      {/* Booking Details Modal */}
      {selectedBooking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-secondary rounded-lg border border-white/10 max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-display font-bold mb-1">
                  {selectedBooking.type === "court" ? "Reserva de Quadra" : "Aula"}
                </h2>
                <p className="text-sm text-muted-foreground">ID #{selectedBooking.id}</p>
              </div>
              <button 
                onClick={() => setSelectedBooking(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mb-6 pb-6 border-b border-white/5">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Status</span>
                <Badge variant={selectedBooking.status === "confirmed" ? "gold" : "outline"}>
                  {getStatusLabel(selectedBooking.status)}
                </Badge>
              </div>

              {/* Client Info */}
              <div>
                <span className="text-muted-foreground text-sm block mb-1">Cliente</span>
                <p className="font-bold">{selectedBooking.customerName}</p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-muted-foreground">{selectedBooking.customerPhone}</p>
                  <a
                    href={`https://wa.me/55${selectedBooking.customerPhone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded hover:bg-green-500/20 text-green-400 transition-colors"
                    title="Enviar WhatsApp"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </a>
                  <a
                    href={`tel:+55${selectedBooking.customerPhone.replace(/\D/g, '')}`}
                    className="p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                    title="Fazer chamada"
                  >
                    <Phone className="w-4 h-4" />
                  </a>
                </div>
                {selectedBooking.customerEmail && (
                  <p className="text-xs text-muted-foreground mt-2">{selectedBooking.customerEmail}</p>
                )}
              </div>

              {/* Date and Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-muted-foreground text-xs block mb-1">Data</span>
                  <p className="text-sm font-bold">{formatDate(selectedBooking.date)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs block mb-1">Horário</span>
                  <p className="text-sm font-bold">{selectedBooking.time}</p>
                </div>
              </div>

              {/* Court/Class Details */}
              {selectedBooking.type === "court" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Duração</span>
                      <p className="text-sm font-bold">{formatDuration((selectedBooking as CourtBooking).durationHours)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs block mb-1">Quadra</span>
                      <p className="text-sm font-bold text-primary">
                        {(selectedBooking as CourtBooking & { courtName?: string }).courtName || 
                          `Q${(selectedBooking as CourtBooking & { courtNumber?: number }).courtNumber ?? 1}`}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {selectedBooking.type === "class" && (
                <div>
                  <span className="text-muted-foreground text-xs block mb-1">Número de Pessoas</span>
                  <p className="text-sm font-bold">{(selectedBooking as ClassBooking).numberOfPeople}</p>
                </div>
              )}

              {/* Amount */}
              <div className="flex justify-between items-center pt-2 text-lg font-bold">
                <span className="text-muted-foreground">Total</span>
                <span className="text-primary">R$ {selectedBooking.amount}</span>
              </div>
            </div>

            {/* PIX QR Code display */}
            {pixData && (
              <div className="bg-white rounded-lg p-4 text-center border border-gray-200">
                <p className="text-gray-700 text-xs font-semibold mb-3">QR Code PIX — R$ {Number(pixData.amount).toFixed(2).replace(".", ",")}</p>
                {pixData.pixQrCodeBase64 ? (
                  <img
                    src={`data:image/png;base64,${pixData.pixQrCodeBase64}`}
                    alt="QR Code PIX"
                    className="mx-auto w-40 h-40 object-contain mb-3"
                  />
                ) : (
                  <p className="text-xs text-gray-400 mb-3">QR Code não disponível</p>
                )}
                {pixData.pixQrCode && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-2">Copia e Cola:</p>
                    <div className="flex gap-1.5 items-center">
                      <input
                        readOnly
                        value={pixData.pixQrCode}
                        className="flex-1 text-xs bg-gray-100 text-black rounded px-2 py-1.5 border border-gray-300 truncate"
                      />
                      <button
                        type="button"
                        onClick={() => { void navigator.clipboard.writeText(pixData.pixQrCode); showToast.success("Código copiado!"); }}
                        className="bg-primary text-black rounded px-2.5 py-1.5 text-xs font-bold whitespace-nowrap hover:bg-yellow-400"
                      >Copiar</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Payment action buttons for pending bookings */}
            {selectedBooking.status === "pending" && selectedBooking.customerName !== "BLOQUEADO" && (
              <div className="flex gap-2 mt-3">
                <Button
                  onClick={() => void handleGeneratePix(selectedBooking.id, selectedBooking.type)}
                  disabled={pixLoading}
                  className="flex-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-bold py-2"
                >
                  {pixLoading ? "Gerando..." : "Gerar QR PIX"}
                </Button>
                <Button
                  onClick={() => void handleMarkPaid(selectedBooking.id, selectedBooking.type)}
                  disabled={markPaidLoading}
                  className="flex-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 text-xs font-bold py-2"
                >
                  {markPaidLoading ? "Confirmando..." : "Marcar como Pago"}
                </Button>
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <Button 
                onClick={() => { setSelectedBooking(null); setPixData(null); }}
                variant="outline" 
                className="flex-1"
              >
                Fechar
              </Button>
              {selectedBooking.status !== "cancelled" && (
                <Button 
                  onClick={async () => {
                    const confirmed = await showConfirm("Cancelar esta reserva?");
                    if (confirmed) {
                      await handleCancelBooking(selectedBooking.id, selectedBooking.type);
                      setSelectedBooking(null);
                      setPixData(null);
                    }
                  }}
                  className="flex-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                >
                  Cancelar Reserva
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type NovaReservaType = "court" | "class";

function NovaReservaModal({ isOpen, onClose, onSuccess, beachTennisHidden }: { isOpen: boolean; onClose: () => void; onSuccess: () => void; beachTennisHidden?: boolean }) {
  const { getAuthHeaders } = useAdminAuth();
  const [tipo, setTipo] = useState<NovaReservaType>("court");
  const [courtNumber, setCourtNumber] = useState<number>(1);
  const [availableCourts, setAvailableCourts] = useState<{ id: number; name: string; number: number }[]>([]);
  const [date, setDate] = useState("");
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [slots, setSlots] = useState<{ time: string; available: boolean; price?: number }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [numberOfPeople, setNumberOfPeople] = useState(1);
  const [actionType, setActionType] = useState<"block" | "manual">("block");
  const [durationHours, setDurationHours] = useState(1);
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Derived helpers
  const isBlocking = actionType === "block";

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/courts`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then((data: { id: number; name: string; number: number; active: boolean }[]) => {
        const active = Array.isArray(data) ? data.filter(c => c.active) : [];
        setAvailableCourts(active);
        if (active.length > 0) setCourtNumber(active[0].number);
      })
      .catch(() => setAvailableCourts([]));
  }, []);

  useEffect(() => {
    if (!date) { setSlots([]); setSelectedTimes([]); return; }
    setLoadingSlots(true);
    setSelectedTimes([]);
    const apiType = tipo === "court" ? "futvolei" : "beach_tennis";
    const courtParam = tipo === "court" ? `&courtNumber=${courtNumber}` : "";
      fetch(`${import.meta.env.BASE_URL}api/bookings/availability?date=${date}&type=${apiType}${courtParam}`)
      .then(r => r.json())
      .then((d: { slots: { time: string; available: boolean; price?: number }[] }) => setSlots(d.slots ?? []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [date, tipo, courtNumber]);

  const toggleTime = (t: string) => {
    setSelectedTimes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const handleClose = () => {
    setDate(""); setSelectedTimes([]); setSlots([]);
    setCustomerName(""); setCustomerPhone(""); setCustomerEmail(""); setActionType("block");
    setNumberOfPeople(1); setTipo("court"); setCourtNumber(1); setDurationHours(1); setExtraMinutes(0);
    onClose();
  };

  const handleSubmit = async () => {
    if (!date || selectedTimes.length === 0) { showToast.error("Selecione a data e ao menos um horário"); return; }
    if (!isBlocking && !customerName.trim()) { showToast.error("Nome do cliente é obrigatório"); return; }
    if (!isBlocking && !customerPhone.trim()) { showToast.error("Telefone é obrigatório"); return; }
    if (!isBlocking && !customerEmail.trim()) { showToast.error("E-mail é obrigatório"); return; }
    setSubmitting(true);
    try {
      const endpoint = tipo === "court" ? "courts" : "classes";
      const body: Record<string, unknown> = {
        date,
        times: selectedTimes,
        customerName: isBlocking ? "BLOQUEADO" : customerName.trim(),
        customerPhone: isBlocking ? "-" : customerPhone.trim(),
      };
      if (!isBlocking && customerEmail.trim()) body.customerEmail = customerEmail.trim();
      if (tipo === "court") { body.courtNumber = courtNumber; body.durationHours = durationHours; }
      if (tipo === "class") body.numberOfPeople = numberOfPeople;
      if (!isBlocking && extraMinutes > 0) body.extraMinutes = extraMinutes;

      const res = await fetch(`${import.meta.env.BASE_URL}api/bookings/${endpoint}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        showToast.error(errData?.error ?? "Erro ao criar reserva/bloqueio");
        return;
      }
      const successMsg = isBlocking ? "Horário(s) bloqueado(s) com sucesso!" : "Reserva criada com sucesso!";
      showToast.success(successMsg);
      onSuccess();
      handleClose();
    } catch {
      showToast.error("Erro ao criar reserva/bloqueio");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Nova Reserva / Bloquear Horário">
      <div className="space-y-4">
        <div>
          <Label>Tipo</Label>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setTipo("court")}
              className={cn("px-4 py-2 rounded-lg text-sm font-bold border", tipo === "court" ? "bg-primary text-black border-primary" : "border-white/20 text-muted-foreground")}
            >Quadra (Futvolei)</button>
            {!beachTennisHidden && (
              <button
                type="button"
                onClick={() => setTipo("class")}
                className={cn("px-4 py-2 rounded-lg text-sm font-bold border", tipo === "class" ? "bg-primary text-black border-primary" : "border-white/20 text-muted-foreground")}
              >Aulas (Beach Tennis)</button>
            )}
          </div>
        </div>

        {tipo === "court" && (
          <div>
            <Label>Quadra</Label>
            <div className={cn("grid gap-2 mt-1", availableCourts.length <= 4 ? "grid-cols-4" : "grid-cols-3")}>
              {availableCourts.length === 0 ? (
                <p className="col-span-4 text-xs text-muted-foreground py-2">Nenhuma quadra cadastrada.</p>
              ) : availableCourts.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCourtNumber(c.number)}
                  className={cn(
                    "py-2 px-1 rounded-lg text-xs font-bold border text-center",
                    courtNumber === c.number
                      ? "bg-primary text-black border-primary"
                      : "border-white/20 text-muted-foreground hover:border-primary/50"
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <Label>Tipo de Ação</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            <button
              type="button"
              onClick={() => { setActionType("block"); setSelectedTimes([]); }}
              className={cn("px-4 py-2 rounded-lg text-sm font-bold border flex items-center gap-1", actionType === "block" ? "bg-red-600 text-white border-red-600" : "border-white/20 text-muted-foreground")}
            ><Ban size={14} /> Bloquear</button>
            <button
              type="button"
              onClick={() => { setActionType("manual"); setSelectedTimes([]); }}
              className={cn("px-4 py-2 rounded-lg text-sm font-bold border flex items-center gap-1", actionType === "manual" ? "bg-primary text-black border-primary" : "border-white/20 text-muted-foreground")}
            ><Plus size={14} /> Reserva Manual</button>
          </div>
        </div>

        {!isBlocking && (
          <>
            <div>
              <Label>Nome do Cliente</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Ex: João Silva" />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(maskPhone(e.target.value))} placeholder="(00) 00000-0000" required />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="cliente@email.com" required />
            </div>
            {tipo === "court" && (
              <>
                <div>
                  <Label>Duração (horas)</Label>
                  <div className="flex gap-2 mt-1">
                    {[1, 2, 3, 4, 5, 6].map(h => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setDurationHours(h)}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                          durationHours === h ? "bg-primary text-black border-primary" : "border-white/20 text-muted-foreground hover:border-white/40"
                        )}
                      >
                        {h}h
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Duração extra (minutos)</Label>
                  <div className="flex gap-2 mt-1">
                    {[0, 15, 30, 45].map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setExtraMinutes(m)}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                          extraMinutes === m ? "bg-primary text-black border-primary" : "border-white/20 text-muted-foreground hover:border-white/40"
                        )}
                      >
                        {m === 0 ? "0" : `+${m}`}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {tipo === "class" && (
              <div>
                <Label>Número de Pessoas</Label>
                <select
                  value={numberOfPeople}
                  onChange={e => setNumberOfPeople(Number(e.target.value))}
                  className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} pessoa{n > 1 ? "s" : ""}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        {(tipo === "class" || (tipo === "court" && courtNumber > 0)) && (
          <div>
            <Label>Data</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        )}

        {date && (tipo === "class" || (tipo === "court" && courtNumber > 0)) && (
          <div>
            <Label>Horários {loadingSlots && <span className="text-xs text-muted-foreground ml-1">(carregando...)</span>}</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {slots.map(s => {
                const isSelected = selectedTimes.includes(s.time);
                return (
                  <button
                    key={s.time}
                    type="button"
                    onClick={() => toggleTime(s.time)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                      isSelected
                        ? "bg-primary text-black border-primary"
                        : s.available
                        ? "border-white/20 text-foreground hover:border-white/40"
                        : "border-red-800 text-red-400 opacity-60",
                    )}
                  >
                    {s.time}
                    {!s.available && !isSelected && " (ocup.)"}
                  </button>
                );
              })}
              {!loadingSlots && slots.length === 0 && (
                <p className="text-xs text-muted-foreground">Selecione uma data válida</p>
              )}
            </div>
          </div>
        )}

        {selectedTimes.length > 0 && (() => {
          const totalDuration = durationHours + extraMinutes / 60;
          const estimatedTotal = tipo === "court"
            ? selectedTimes.reduce((sum, t) => {
                const slot = slots.find(s => s.time === t);
                return sum + Math.round((slot?.price ?? 0) * totalDuration * 100) / 100;
              }, 0)
            : tipo === "class"
              ? (slots.find(s => s.time === selectedTimes[0])?.price ?? 0) * numberOfPeople * selectedTimes.length
              : 0;
          return (
            <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 space-y-1">
              <p className="text-xs text-muted-foreground">
                {selectedTimes.length} horário(s): {selectedTimes.sort().join(", ")}
                {tipo === "court" && ` · ${durationHours}h${extraMinutes > 0 ? `${extraMinutes}min` : ""}`}
              </p>
              {!isBlocking && estimatedTotal > 0 && (
                <p className="text-sm font-bold text-primary">
                  Valor estimado: R$ {estimatedTotal.toFixed(2).replace(".", ",")}
                </p>
              )}
            </div>
          );
        })()}

        <Button
          type="button"
          variant={isBlocking ? "outline" : "gold"}
          className={cn("w-full mt-2", isBlocking && "border-red-600 text-red-400 hover:bg-red-600/10")}
          onClick={handleSubmit}
          isLoading={submitting}
          disabled={!date || selectedTimes.length === 0}
        >
          {isBlocking ? <><Ban size={14} className="mr-2" /> Bloquear Horários</> : <><Plus size={14} className="mr-2" /> Criar Reserva</>}
        </Button>
      </div>
    </Modal>
  );
}

type GaleriaAddMode = "upload" | "url";

function AdminGaleria() {
  const { getAuthHeaders } = useAdminAuth();
  const qc = useQueryClient();
  const { data: photos, isLoading } = useGetGallery({ query: { staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true } });
  const addPhoto = useAddGalleryPhoto({ request: { headers: getAuthHeaders() } });
  const deletePhoto = useDeleteGalleryPhoto({ request: { headers: getAuthHeaders() } });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<GaleriaAddMode>("upload");
  const [uploading, setUploading] = useState(false);
  const { register, handleSubmit, reset } = useForm({ defaultValues: { url: "", caption: "", category: "" } });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const caption = (document.getElementById("upload-caption") as HTMLInputElement)?.value ?? "";
    const category = (document.getElementById("upload-category") as HTMLInputElement)?.value ?? "";

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers = getAuthHeaders();
      const res = await fetch("/api/gallery/upload", { method: "POST", headers, body: formData });
      if (!res.ok) throw new Error("Upload falhou");
      const { url } = await res.json() as { url: string };
      addPhoto.mutate(
        { data: { url, caption: caption.trim() || undefined, category: category.trim() || undefined } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/gallery"] });
            setIsAddOpen(false);
          },
          onError: () => showToast.error("Erro ao salvar foto"),
        },
      );
    } catch {
      showToast.error("Erro ao fazer upload do arquivo");
    } finally {
      setUploading(false);
    }
  };

  const onUrlSubmit = ({ url, caption, category }: { url: string; caption: string; category: string }) => {
    if (!url.trim()) return;
    addPhoto.mutate(
      { data: { url: url.trim(), caption: caption.trim() || undefined, category: category.trim() || undefined } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/api/gallery"] });
          reset();
          setIsAddOpen(false);
        },
        onError: () => showToast.error("Erro ao adicionar foto"),
      },
    );
  };

  const handleDelete = async (id: number) => {
    const confirmed = await showConfirm("Remover esta foto?");
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/gallery/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error("Erro ao remover");
      qc.invalidateQueries({ queryKey: ["/api/gallery"] });
      showToast.success("Foto removida com sucesso!");
    } catch (err) {
      console.error("Erro ao deletar:", err);
      showToast.error("Erro ao remover foto");
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4 md:mb-6 flex-col md:flex-row gap-3 md:gap-0">
        <h2 className="text-lg md:text-2xl font-display font-bold">Galeria de Fotos</h2>
        <Button variant="gold" onClick={() => setIsAddOpen(true)} className="gap-2 w-full md:w-auto text-xs md:text-sm px-2 md:px-4">
          <Plus size={16} /> <span className="hidden sm:inline">Adicionar Foto</span><span className="sm:hidden">Foto</span>
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm md:text-base">Carregando...</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        {photos?.map((photo: GalleryPhoto) => (
          <div key={photo.id} className="relative group rounded-xl overflow-hidden border border-white/5 bg-card">
            <img
              src={photo.url}
              alt={photo.caption ?? "Foto da galeria"}
              className="w-full aspect-square object-cover"
              onError={(e) => { (e.target as HTMLImageElement).src = "https://placehold.co/300x300/1a1a1a/555?text=Foto"; }}
            />
            <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
              {photo.caption && <p className="text-xs text-white/80 mb-1">{photo.caption}</p>}
              {photo.category && <Badge variant="outline" className="text-[10px] self-start mb-2">{photo.category}</Badge>}
              <button
                onClick={() => handleDelete(photo.id)}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 mt-auto self-end"
              >
                <Trash2 size={13} /> Remover
              </button>
            </div>
          </div>
        ))}
        {!isLoading && !photos?.length && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
            <ImageIcon size={48} className="opacity-20" />
            Nenhuma foto adicionada ainda.
          </div>
        )}
      </div>

      <Modal isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); reset(); }} title="Adicionar Foto à Galeria">
        <div className="flex gap-2 mb-4 border-b border-white/10 pb-3">
          {(["upload", "url"] as GaleriaAddMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setAddMode(m)}
              className={cn("px-2 md:px-4 py-1.5 text-xs md:text-sm font-bold rounded", addMode === m ? "bg-primary text-black" : "text-muted-foreground hover:text-white")}
            >
              {m === "upload" ? <span><span className="hidden md:inline">Enviar Arquivo</span><span className="md:hidden">Arquivo</span></span> : <span><span className="hidden md:inline">Link (URL)</span><span className="md:hidden">URL</span></span>}
            </button>
          ))}
        </div>

        {addMode === "upload" ? (
          <div className="space-y-3 md:space-y-4">
            <div>
              <Label className="text-xs md:text-sm">Legenda (opcional)</Label>
              <Input id="upload-caption" placeholder="Descrição da foto..." className="text-xs md:text-sm" />
            </div>
            <div>
              <Label className="text-xs md:text-sm">Categoria (opcional)</Label>
              <Input id="upload-category" placeholder="ex: Copa Azuos..." className="text-xs md:text-sm" />
            </div>
            <div>
              <Label className="text-xs md:text-sm">Arquivo de Imagem *</Label>
              <label className={cn("mt-1 flex flex-col items-center justify-center w-full h-24 md:h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors", uploading ? "opacity-50 cursor-not-allowed border-white/20" : "border-primary/40 hover:border-primary bg-black/20")}>
                <div className="flex flex-col items-center text-muted-foreground text-xs md:text-sm">
                  <ImageIcon size={20} className="mb-1 text-primary/60 md:w-6 md:h-6" />
                  {uploading ? "Enviando..." : <span><span className="hidden md:inline">Clique para escolher ou arraste a imagem</span><span className="md:hidden">Clique ou arraste</span></span>}
                  <span className="text-[10px] md:text-xs mt-1">JPG, PNG, WEBP ou GIF — máx 10MB</span>
                </div>
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onUrlSubmit)} className="space-y-3 md:space-y-4">
            <div>
              <Label className="text-xs md:text-sm">URL da Imagem *</Label>
              <Input placeholder="https://exemplo.com/foto.jpg" {...register("url", { required: true })} className="text-xs md:text-sm" />
            </div>
            <div>
              <Label className="text-xs md:text-sm">Legenda (opcional)</Label>
              <Input placeholder="Descrição da foto..." {...register("caption")} className="text-xs md:text-sm" />
            </div>
            <div>
              <Label className="text-xs md:text-sm">Categoria (opcional)</Label>
              <Input placeholder="ex: Copa Azuos..." {...register("category")} className="text-xs md:text-sm" />
            </div>
            <Button type="submit" variant="gold" className="w-full mt-2 text-xs md:text-sm" isLoading={addPhoto.isPending}>
              Adicionar
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

type TournamentStatus = "upcoming" | "open_registration" | "ongoing" | "finished";

function AdminTorneios() {
  const qc = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const { data: tournaments } = useGetTournaments({ query: { staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true } });
  const createMutation = useCreateTournament({ request: { headers: getAuthHeaders() } });
  const updateMutation = useUpdateTournament({ request: { headers: getAuthHeaders() } });
  const deleteMutation = useDeleteTournament({ request: { headers: getAuthHeaders() } });

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTournament, setEditingTournament] = useState<{ id: number; name: string; startDate: string; endDate?: string; location?: string; description?: string; status: TournamentStatus } | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);

  const createForm = useForm({ defaultValues: { name: "", startDate: "" } });
  const editForm = useForm({ defaultValues: { name: "", startDate: "", endDate: "", location: "", description: "", status: "upcoming" as TournamentStatus, registrationPrice: "", registrationInfo: "", registrationType: "dupla" as const } });

  const onSubmitCreate = ({ name, startDate, description }: { name: string; startDate: string; description?: string }) => {
    createMutation.mutate({ data: { name, startDate, description: description || undefined, status: "upcoming" } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/tournaments"] });
        setIsCreateOpen(false);
        createForm.reset();
      },
    });
  };

  const onSubmitEdit = ({ name, startDate, endDate, location, description, status }: { name: string; startDate: string; endDate: string; location: string; description?: string; status: TournamentStatus }) => {
    if (!editingTournament) return;
    const { registrationPrice, registrationInfo, registrationType } = editForm.getValues();
    updateMutation.mutate(
      { id: editingTournament.id, data: { name, startDate, endDate: endDate || undefined, location: location || undefined, description: description || undefined, status, registrationPrice: registrationPrice ? String(registrationPrice) : undefined, registrationInfo: registrationInfo || undefined, registrationType: (registrationType || "dupla") as any } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/api/tournaments"] });
          qc.invalidateQueries({ queryKey: ["/api/tournaments", editingTournament.id.toString()] });
          setEditingTournament(null);
        },
        onError: () => showToast.error("Erro ao atualizar torneio"),
      },
    );
  };

  const handleEditClick = (e: React.MouseEvent, t: { id: number; name: string; startDate: string; endDate?: string | null; location?: string | null; description?: string | null; status: TournamentStatus; registrationPrice?: string | null; registrationInfo?: string | null; registrationType?: string | null }) => {
    e.stopPropagation();
    editForm.reset({ name: t.name, startDate: t.startDate, endDate: t.endDate ?? "", location: t.location ?? "", description: t.description ?? "", status: t.status, registrationPrice: t.registrationPrice ?? "", registrationInfo: t.registrationInfo ?? "", registrationType: (t.registrationType ?? "dupla") as any });
    setEditingTournament({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate ?? undefined, location: t.location ?? undefined, description: t.description ?? undefined, status: t.status });
  };

  const handleDeleteTournament = async (e: React.MouseEvent, t: { id: number; name: string }) => {
    e.stopPropagation();
    const confirmed = await showConfirm(`Excluir o torneio "${t.name}"? Esta ação não pode ser desfeita.`);
    if (!confirmed) return;
    deleteMutation.mutate({ id: t.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["/api/tournaments"] });
        if (selectedTournamentId === t.id) setSelectedTournamentId(null);
      },
      onError: () => showToast.error("Erro ao excluir torneio"),
    });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-8">
      <div className="w-full lg:w-1/3">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg md:text-2xl font-display font-bold">Torneios</h2>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}><Plus size={16} /></Button>
        </div>
        <div className="space-y-3">
          {tournaments?.map((t) => (
            <Card
              key={t.id}
              className={cn(
                "p-4 cursor-pointer transition-colors border text-sm md:text-base",
                selectedTournamentId === t.id ? "border-primary bg-primary/5" : "border-transparent hover:border-white/20",
              )}
              onClick={() => setSelectedTournamentId(t.id)}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="font-bold text-base md:text-lg leading-tight flex-1">{t.name}</div>
                <div className="flex items-center gap-1 shrink-0 mt-1">
                  <button
                    onClick={(e) => handleEditClick(e, t as typeof t & { status: TournamentStatus })}
                    className="text-muted-foreground hover:text-white"
                    title="Editar torneio"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={(e) => handleDeleteTournament(e, t)}
                    className="text-muted-foreground hover:text-red-400"
                    title="Excluir torneio"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{formatDate(t.startDate)}</div>
              {t.location && <div className="text-xs text-muted-foreground/70">{t.location}</div>}
              <Badge className="mt-2 text-[10px]" variant="outline">
                {t.status === "upcoming" ? "Em breve" : t.status === "open_registration" ? "🏆 Inscrições Abertas" : t.status === "ongoing" ? "Em andamento" : "Finalizado"}
              </Badge>
            </Card>
          ))}
          {!tournaments?.length && (
            <p className="text-muted-foreground text-sm text-center py-8">Nenhum torneio criado.</p>
          )}
        </div>
      </div>

      <div className="w-full lg:w-2/3">
        {selectedTournamentId ? (
          <div className="space-y-3">
            <AdminTournamentDetail tournamentId={selectedTournamentId} />
          </div>
        ) : (
          <Card className="p-8 md:p-12 text-center text-muted-foreground flex flex-col items-center justify-center h-full border-dashed border-white/10 text-sm md:text-base">
            Selecione um torneio para gerenciar
          </Card>
        )}
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Novo Torneio">
        <form onSubmit={createForm.handleSubmit(onSubmitCreate)} className="space-y-4">
          <div><Label>Nome do Torneio</Label><Input {...createForm.register("name", { required: true })} /></div>
          <div><Label>Data de Início</Label><Input type="date" {...createForm.register("startDate", { required: true })} /></div>
          <div><Label>Descrição (opcional)</Label><textarea {...createForm.register("description")} placeholder="Descreva o torneio..." className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm" rows={3} /></div>
          <Button type="submit" variant="gold" className="w-full mt-4" isLoading={createMutation.isPending}>
            Criar Torneio
          </Button>
        </form>
      </Modal>

      <Modal isOpen={!!editingTournament} onClose={() => setEditingTournament(null)} title="Editar Torneio">
        <form onSubmit={editForm.handleSubmit(onSubmitEdit)} className="space-y-4">
          <div><Label>Nome do Torneio</Label><Input {...editForm.register("name", { required: true })} /></div>
          <div><Label>Data de Início</Label><Input type="date" {...editForm.register("startDate", { required: true })} /></div>
          <div><Label>Data de Término (opcional)</Label><Input type="date" {...editForm.register("endDate")} /></div>
          <div><Label>Local (opcional)</Label><Input placeholder="ex: Quadra Central Azuos" {...editForm.register("location")} /></div>
          <div><Label>Descrição (opcional)</Label><textarea {...editForm.register("description")} placeholder="Descreva o torneio..." className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm" rows={3} /></div>
          <div>
            <Label>Status</Label>
            <select className="w-full mt-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm" {...editForm.register("status")}>
              <option value="upcoming">Em breve</option>
              <option value="open_registration">🏆 Inscrições Abertas</option>
              <option value="ongoing">Em andamento</option>
              <option value="finished">Finalizado</option>
            </select>
          </div>
          <div>
            <Label>Modalidade de Inscrição</Label>
            <select className="w-full mt-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm" {...editForm.register("registrationType")}>
              <option value="individual">Individual (1 jogador)</option>
              <option value="dupla">Dupla (2 jogadores)</option>
              <option value="trio">Trio (3 jogadores)</option>
            </select>
          </div>
          <div>
            <Label>Informações de Inscrição (texto público no formulário)</Label>
            <textarea rows={2} placeholder="ex: Inscrições abertas até 15/05. Pague via PIX após inscrever-se." {...editForm.register("registrationInfo")} className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <Label>Foto do Torneio (para exibição no card)</Label>
            <label className="flex items-center justify-center gap-2 cursor-pointer w-full mt-1 px-3 py-2 bg-background border border-white/10 rounded-lg hover:border-primary/50 transition-colors">
              <ImageIcon size={16} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Clique para fazer upload</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !editingTournament) return;
                  try {
                    const fd = new FormData();
                    fd.append("file", file);
                    const res = await fetch("/api/gallery/upload", {
                      method: "POST",
                      headers: getAuthHeaders(),
                      body: fd,
                    });
                    if (!res.ok) throw new Error("Upload falhou");
                    const { url } = await res.json() as { url: string };
                    updateMutation.mutate(
                      { id: editingTournament.id, data: { name: editForm.getValues("name"), startDate: editForm.getValues("startDate"), endDate: editForm.getValues("endDate") || undefined, location: editForm.getValues("location") || undefined, status: editForm.getValues("status"), photoUrl: url } },
                      {
                        onSuccess: () => {
                          qc.invalidateQueries({ queryKey: ["/api/tournaments"] });
                          setEditingTournament(null);
                          showToast.success("Foto do torneio atualizada!");
                        },
                        onError: () => showToast.error("Erro ao atualizar torneio"),
                      },
                    );
                  } catch {
                    showToast.error("Erro ao fazer upload de foto");
                  }
                }}
              />
            </label>
          </div>
          <Button type="submit" variant="gold" className="w-full mt-4" isLoading={updateMutation.isPending}>
            Salvar Alterações
          </Button>
        </form>
      </Modal>
    </div>
  );
}

interface TournamentCoupon {
  id: number;
  code: string;
  type: "percentage" | "fixed";
  value: string;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
}

function AdminTournamentCoupons({ tournamentId }: { tournamentId: number }) {
  const { getAuthHeaders } = useAdminAuth();
  const [coupons, setCoupons] = useState<TournamentCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const loadCoupons = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/coupons`, { headers: getAuthHeaders() });
      if (res.ok) setCoupons(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadCoupons(); }, [tournamentId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !discountValue) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/coupons`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          discountType,
          discountValue: parseFloat(discountValue),
          maxUses: maxUses ? parseInt(maxUses) : null,
          expiresAt: expiresAt || null,
        }),
      });
      if (res.ok) {
        setCode(""); setDiscountValue(""); setMaxUses(""); setExpiresAt("");
        showToast.success("Cupom criado!");
        loadCoupons();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast.error(err.error || "Erro ao criar cupom");
      }
    } catch { showToast.error("Erro ao criar cupom"); }
    setSaving(false);
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirmId === null) return;
    await fetch(`/api/tournaments/${tournamentId}/coupons/${deleteConfirmId}`, { method: "DELETE", headers: getAuthHeaders() });
    showToast.success("Cupom excluído");
    setDeleteConfirmId(null);
    loadCoupons();
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="space-y-4 p-4 bg-white/5 rounded-lg border border-white/10">
        <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Tag size={14} /> Novo Cupom de Desconto
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Código *</Label>
            <Input
              placeholder="ex: PROMO10"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono"
            />
          </div>
          <div>
            <Label>Tipo de Desconto *</Label>
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")}
              className="w-full h-10 px-3 rounded-md bg-background border border-input text-sm"
            >
              <option value="percentage">Percentual (%)</option>
              <option value="fixed">Valor fixo (R$)</option>
            </select>
          </div>
          <div>
            <Label>Valor do Desconto *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder={discountType === "percent" ? "ex: 10 = 10%" : "ex: 25 = R$25"}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          </div>
          <div>
            <Label>Limite de Usos</Label>
            <Input
              type="number"
              min="1"
              placeholder="Sem limite"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Validade (opcional)</Label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>
        <Button type="submit" variant="gold" size="sm" isLoading={saving} disabled={!code.trim() || !discountValue}>
          <Plus size={14} className="mr-1" /> Criar Cupom
        </Button>
      </form>

      <div>
        <h3 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-3">Cupons Cadastrados</h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando cupons...</p>
        ) : coupons.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum cupom cadastrado para este torneio.</p>
        ) : (
          <div className="space-y-2">
            {coupons.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-primary text-sm">{c.code}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {c.type === "percentage" ? `${c.value}%` : `R$ ${parseFloat(c.value).toFixed(2)}`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Usos: {c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : " (sem limite)"}
                    {c.expiresAt && ` · Expira: ${new Date(c.expiresAt).toLocaleDateString("pt-BR")}`}
                  </p>
                </div>
                <button
                  onClick={() => setDeleteConfirmId(c.id)}
                  className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={deleteConfirmId !== null} onClose={() => setDeleteConfirmId(null)} title="Excluir Cupom">
        <p className="text-sm text-muted-foreground mb-6">Tem certeza que deseja excluir este cupom? Essa ação não pode ser desfeita.</p>
        <div className="flex gap-3">
          <Button onClick={() => setDeleteConfirmId(null)} variant="outline" className="flex-1">
            Cancelar
          </Button>
          <Button onClick={handleDeleteConfirm} variant="destructive" className="flex-1">
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  );
}

type DetailTab = "categorias" | "inscrições" | "patrocinadores" | "cupons";

function AdminTournamentDetail({ tournamentId }: { tournamentId: number }) {
  const qc = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const { data: categories } = useGetTournamentCategories(tournamentId, { query: { staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true } });
  const [selectedCat, setSelectedCat] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("categorias");
  const [isAddCatOpen, setIsAddCatOpen] = useState(false);

  const [catName, setCatName] = useState("");
  const [catOrder, setCatOrder] = useState("0");
  const [catPrice, setCatPrice] = useState("");
  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatOrder, setEditCatOrder] = useState("0");
  const [editCatPrice, setEditCatPrice] = useState("");
  const [isSavingCat, setIsSavingCat] = useState(false);

  const createCat = useCreateCategory({ request: { headers: getAuthHeaders() } });
  const deleteCat = useDeleteCategory({ request: { headers: getAuthHeaders() } });

  const handleCreateCategory = () => {
    const displayOrder = catOrder ? parseInt(catOrder) : 0;
    const registrationPrice = catPrice.trim() ? catPrice.trim().replace(",", ".") : undefined;
    createCat.mutate({ id: tournamentId, data: { name: catName.trim(), displayOrder, registrationPrice: registrationPrice ?? null } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/categories`] });
        setIsAddCatOpen(false);
        setCatName("");
        setCatOrder("0");
        setCatPrice("");
      },
      onError: () => showToast.error("Erro ao adicionar categoria"),
    });
  };

  const handleDeleteCategory = async (e: React.MouseEvent, categoryId: number, categoryName: string) => {
    e.stopPropagation();
    const confirmed = await showConfirm(`Remover categoria "${categoryName}"? Todos os dados relacionados serão perdidos.`);
    if (!confirmed) return;
    deleteCat.mutate({ id: tournamentId, categoryId }, {
      onSuccess: () => {
        if (selectedCat === categoryId) setSelectedCat(null);
        qc.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/categories`] });
      },
      onError: () => showToast.error("Erro ao remover categoria"),
    });
  };

  const openEditCat = (e: React.MouseEvent, cat: { id: number; name: string; displayOrder?: number | null; registrationPrice?: string | null }) => {
    e.stopPropagation();
    setEditCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatOrder(String(cat.displayOrder ?? 0));
    setEditCatPrice(cat.registrationPrice ?? "");
  };

  const handleSaveEditCategory = async () => {
    if (!editCatId || !editCatName.trim()) return;
    setIsSavingCat(true);
    try {
      const registrationPrice = editCatPrice.trim() ? editCatPrice.trim().replace(",", ".") : null;
      const res = await fetch(`/api/tournaments/${tournamentId}/categories/${editCatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ name: editCatName.trim(), displayOrder: parseInt(editCatOrder) || 0, registrationPrice }),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      qc.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/categories`] });
      setEditCatId(null);
      showToast.success("Categoria atualizada!");
    } catch {
      showToast.error("Erro ao atualizar categoria");
    } finally {
      setIsSavingCat(false);
    }
  };

  return (
    <>
    <Card className="p-4 md:p-6 bg-card/50 border-white/5">
      <div className="flex gap-2 mb-6 border-b border-white/10 pb-4 overflow-x-auto">
        {(["categorias", "inscrições", "patrocinadores", "cupons"] as DetailTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setDetailTab(tab)}
            className={cn(
              "px-3 py-1.5 text-sm font-bold rounded capitalize transition-colors whitespace-nowrap shrink-0",
              detailTab === tab ? "bg-primary text-black" : "text-muted-foreground hover:text-white",
            )}
          >
            {tab === "categorias" ? "Categorias" : tab === "inscrições" ? "Inscrições" : tab === "patrocinadores" ? "Patrocinadores" : "Cupons"}
          </button>
        ))}
      </div>

      {detailTab === "categorias" && (
        <>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-display font-bold">Categorias</h3>
            <Button size="sm" variant="outline" onClick={() => setIsAddCatOpen(true)}>
              <Plus size={16} className="mr-2" /> Add Categoria
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 pb-4 border-b border-white/10 mb-6">
            {[...(categories ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name)).map((c) => (
              <div key={c.id} className="flex items-center gap-1 group min-w-0">
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <button
                    type="button"
                    className={cn(
                      "w-full px-3 py-1.5 rounded-md text-sm font-semibold whitespace-nowrap transition-colors border text-left",
                      selectedCat === c.id
                        ? "bg-primary text-black border-primary"
                        : "bg-secondary text-white border-transparent hover:bg-white/10",
                    )}
                    onClick={() => setSelectedCat(selectedCat === c.id ? null : c.id)}
                  >
                    {c.name}
                  </button>
                  {c.registrationPrice && (
                    <span className="text-[10px] text-primary/80 font-medium pl-1 mt-0.5">
                      R$ {Number(c.registrationPrice).toFixed(2).replace(".", ",")}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => openEditCat(e, c)}
                  className="text-blue-400/60 hover:text-blue-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Editar categoria"
                >
                  <Edit2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteCategory(e, c.id, c.name)}
                  className="text-red-500/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remover categoria"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {!categories?.length && (
              <p className="text-muted-foreground text-sm py-2">Nenhuma categoria adicionada.</p>
            )}
          </div>

          {!selectedCat && (
            <div className="text-center py-8 text-muted-foreground text-sm">Clique em uma categoria acima para gerenciar</div>
          )}
        </>
      )}

      {detailTab === "inscrições" && (
        <AdminTournamentRegistrations tournamentId={tournamentId} />
      )}

      {detailTab === "patrocinadores" && (
        <AdminSponsorSection tournamentId={tournamentId} />
      )}

      {detailTab === "cupons" && (
        <AdminTournamentCoupons tournamentId={tournamentId} />
      )}

    </Card>

    {selectedCat && detailTab === "categorias" && (
      <Card className="p-6 bg-card/50 border-white/5 mt-4">
        <AdminCategoryDetail key={selectedCat} tournamentId={tournamentId} categoryId={selectedCat} />
      </Card>
    )}

    <Modal isOpen={isAddCatOpen} onClose={() => { setIsAddCatOpen(false); setCatName(""); setCatOrder("0"); setCatPrice(""); }} title="Adicionar Categoria">
      <form onSubmit={(e) => { e.preventDefault(); handleCreateCategory(); }} className="space-y-4">
        <div>
          <Label>Nome da Categoria *</Label>
          <Input
            placeholder="ex: Iniciante, Misto, Profissional"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <Label>Valor da Inscrição (R$)</Label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="ex: 150,00 (deixe vazio para usar o preço do torneio)"
            value={catPrice}
            onChange={(e) => setCatPrice(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">Se informado, substituirá o preço geral do torneio para esta categoria</p>
        </div>
        <div>
          <Label>Ordem de Exibição</Label>
          <Input
            type="number"
            placeholder="ex: 1, 2, 3..."
            value={catOrder}
            onChange={(e) => setCatOrder(e.target.value)}
            min="0"
          />
          <p className="text-xs text-muted-foreground mt-1">Menor número aparece primeiro na aba Campeões</p>
        </div>
        <Button type="submit" variant="gold" className="w-full mt-2" isLoading={createCat.isPending} disabled={!catName.trim()}>
          Criar Categoria
        </Button>
      </form>
    </Modal>

    <Modal isOpen={editCatId !== null} onClose={() => { setEditCatId(null); setEditCatPrice(""); }} title="Editar Categoria">
      <form onSubmit={(e) => { e.preventDefault(); handleSaveEditCategory(); }} className="space-y-4">
        <div>
          <Label>Nome da Categoria *</Label>
          <Input
            placeholder="ex: Iniciante, Misto, Profissional"
            value={editCatName}
            onChange={(e) => setEditCatName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <Label>Valor da Inscrição (R$)</Label>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="ex: 150,00 (deixe vazio para usar o preço do torneio)"
            value={editCatPrice}
            onChange={(e) => setEditCatPrice(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">Se informado, substituirá o preço geral do torneio para esta categoria</p>
        </div>
        <div>
          <Label>Ordem de Exibição</Label>
          <Input
            type="number"
            placeholder="ex: 1, 2, 3..."
            value={editCatOrder}
            onChange={(e) => setEditCatOrder(e.target.value)}
            min="0"
          />
          <p className="text-xs text-muted-foreground mt-1">Menor número aparece primeiro na aba Campeões</p>
        </div>
        <Button type="submit" variant="gold" className="w-full mt-2" isLoading={isSavingCat} disabled={!editCatName.trim()}>
          Salvar Alterações
        </Button>
      </form>
    </Modal>
    </>
  );
}

interface AdminMatchCreateProps {
  tournamentId: number;
  categoryId: number;
  pairs?: Pair[];
  matches?: Match[];
}

interface Court {
  id: number;
  name: string;
  number: number;
  active: boolean;
}

function AdminMatchCreate({ tournamentId, categoryId, pairs, matches }: AdminMatchCreateProps) {
  const qc = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [courts, setCourts] = useState<Court[]>([]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/courts`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(data => setCourts((Array.isArray(data) ? data : []).filter((c: Court) => c.active)))
      .catch(err => console.error("Failed to fetch courts:", err));
  }, []);
  
  const form = useForm({
    defaultValues: { phase: "group_stage", groupName: "Grupo A", pair1Id: "", pair2Id: "", pair1Sets: "0", pair2Sets: "0", matchOrder: "0", court: "" }
  });
  const watchedPhase = form.watch("phase");

  const handleCreate = async (data: any) => {
    setLoading(true);
    try {
      const pair1Id = parseInt(data.pair1Id, 10);
      const pair2Id = parseInt(data.pair2Id, 10);
      const groupName = data.phase === "group_stage" ? data.groupName : undefined;
      
      // Validação: na fase de grupos, verificar se as duplas já estão em grupos diferentes
      // Usa os matches existentes (não o groupId da dupla, que pode estar desatualizado)
      if (data.phase === "group_stage" && groupName && matches) {
        const groupStageMatches = matches.filter(m => m.phase === "group_stage" && m.groupName);
        
        const pair1Group = groupStageMatches.find(m => m.pair1Id === pair1Id || m.pair2Id === pair1Id)?.groupName;
        const pair2Group = groupStageMatches.find(m => m.pair1Id === pair2Id || m.pair2Id === pair2Id)?.groupName;
        
        if (pair1Group && pair1Group !== groupName) {
          showToast.error(`Dupla 1 já está no ${pair1Group}`);
          setLoading(false);
          return;
        }
        
        if (pair2Group && pair2Group !== groupName) {
          showToast.error(`Dupla 2 já está no ${pair2Group}`);
          setLoading(false);
          return;
        }
      }
      
      const res = await fetch(`/api/tournaments/${tournamentId}/categories/${categoryId}/matches`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          pair1Id,
          pair2Id,
          phase: data.phase,
          groupName,
          matchOrder: parseInt(data.matchOrder || "0", 10),
          pair1Sets: parseInt(data.pair1Sets || "0", 10),
          pair2Sets: parseInt(data.pair2Sets || "0", 10),
          court: data.court || null,
        }),
      });
      if (res.ok) {
        form.reset();
        setShowForm(false);
        void qc.invalidateQueries();
      } else {
        showToast.error("Erro ao criar jogo");
      }
    } catch {
      showToast.error("Erro ao criar jogo");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-black/40 p-4 rounded-lg border border-white/5">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-green-500 text-black font-bold rounded-lg hover:bg-green-600 transition-colors"
        >
          + Criar Novo Jogo
        </button>
      ) : (
        <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-muted-foreground">Fase</label>
              <select {...form.register("phase")} className="w-full bg-background border border-white/10 rounded px-2 py-1 text-sm">
                <option value="group_stage">Fase de Grupos</option>
                <option value="eighthfinals">Oitavas</option>
                <option value="quarterfinals">Quartas</option>
                <option value="semifinals">Semifinal</option>
                <option value="third_place">3º Lugar</option>
                <option value="final">Final</option>
              </select>
            </div>
            {watchedPhase === "group_stage" && (
              <div>
                <label className="text-xs font-bold text-muted-foreground">Grupo</label>
                <input {...form.register("groupName")} placeholder="Grupo A" className="w-full bg-background border border-white/10 rounded px-2 py-1 text-sm" />
              </div>
            )}
            <div>
              <label className="text-xs font-bold text-muted-foreground">Dupla 1</label>
              <select {...form.register("pair1Id")} className="w-full bg-background border border-white/10 rounded px-2 py-1 text-sm">
                <option value="">Selecionar...</option>
                {pairs?.map(p => <option key={p.id} value={p.id}>{p.player1Name} / {p.player2Name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">Dupla 2</label>
              <select {...form.register("pair2Id")} className="w-full bg-background border border-white/10 rounded px-2 py-1 text-sm">
                <option value="">Selecionar...</option>
                {pairs?.map(p => <option key={p.id} value={p.id}>{p.player1Name} / {p.player2Name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">Quadra</label>
              <select {...form.register("court")} className="w-full bg-background border border-white/10 rounded px-2 py-1 text-sm">
                <option value="">Sem quadra</option>
                {courts.map(court => <option key={court.id} value={court.name}>{court.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">PTS Dupla 1</label>
              <input type="number" {...form.register("pair1Sets")} min="0" className="w-full bg-background border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">PTS Dupla 2</label>
              <input type="number" {...form.register("pair2Sets")} min="0" className="w-full bg-background border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="flex-1 px-3 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-600 disabled:opacity-50">
              {loading ? "Criando..." : "Criar Jogo"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function AutoGenerateGroups({ tournamentId, categoryId, pairs, matches }: AdminMatchCreateProps) {
  const qc = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groupMode, setGroupMode] = useState<"numeric" | "alphabetic">("numeric");
  const [groupsOf4, setGroupsOf4] = useState("");
  const [groupsOf3, setGroupsOf3] = useState("");

  const completedPairs = (pairs ?? []).length;
  const canGenerate = completedPairs >= 2;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/tournaments/${tournamentId}/categories/${categoryId}/generate-groups-auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ groupMode, groups4: Number(groupsOf4), groups3: Number(groupsOf3) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast.error(data.error ?? "Erro ao gerar fase de grupos");
        return;
      }
      await qc.invalidateQueries();
      showToast.success("Fase de grupos gerada!");
      setOpen(false);
    } catch {
      showToast.error("Erro ao gerar fase de grupos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-black/40 p-4 rounded-lg border border-white/5">
      <button
        onClick={() => setOpen(true)}
        disabled={!canGenerate}
        className="px-4 py-2 bg-primary text-black font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50"
      >
        Gerar fase de grupos automático
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Gerar fase de grupos">
        <div className="space-y-4">
          <div>
            <Label>Sequência dos grupos</Label>
            <select value={groupMode} onChange={(e) => setGroupMode(e.target.value as "numeric" | "alphabetic")} className="w-full bg-background border border-white/10 rounded px-2 py-2 text-sm">
              <option value="numeric">Numérico: Grupo 1, Grupo 2...</option>
              <option value="alphabetic">Alfabético: Grupo A, Grupo B...</option>
            </select>
          </div>
          <div>
            <Label>Quantidade de grupos com 4 duplas</Label>
            <select value={groupsOf4} onChange={(e) => setGroupsOf4(e.target.value)} className="w-full bg-background border border-white/10 rounded px-2 py-2 text-sm">
              <option value="">Selecione</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Quantidade de grupos com 3 duplas</Label>
            <select value={groupsOf3} onChange={(e) => setGroupsOf3(e.target.value)} className="w-full bg-background border border-white/10 rounded px-2 py-2 text-sm">
              <option value="">Selecione</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>{n}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground">
            Exemplo para 26 duplas: 5 grupos de 4 + 2 grupos de 3. Os jogos já serão criados com quadras alternadas.
          </div>
          <div className="flex gap-2">
            <Button onClick={handleGenerate} disabled={loading || !canGenerate} className="flex-1">
              {loading ? "Gerando..." : "Gerar fase de grupos"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancelar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface BracketGeneratorProps {
  matches?: Match[];
  pairs?: Pair[];
  tournamentId: number;
  categoryId: number;
  getAuthHeaders: () => Record<string, string>;
  qc: ReturnType<typeof useQueryClient>;
}

function BracketGenerator({ matches, pairs, tournamentId, categoryId, getAuthHeaders, qc }: BracketGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [bestThirds, setBestThirds] = useState(0);
  const [generating, setGenerating] = useState(false);

  if (!matches || !pairs) return null;

  const groupMatches = matches.filter((m) => m.phase === "group_stage" || m.phase === "group");
  const completedGroupMatches = groupMatches.filter((m) => m.completed);
  const isAllCompleted = groupMatches.length > 0 && groupMatches.length === completedGroupMatches.length;
  const knockoutMatches = matches.filter((m) => m.phase !== "group_stage" && m.phase !== "group");

  // Compute per-group standings from matches and pairs
  type PairStats = { wins: number; setsFor: number; setsAgainst: number };
  const pairStatsMap = new Map<number, PairStats>();

  for (const p of pairs) {
    pairStatsMap.set(p.id, { wins: 0, setsFor: 0, setsAgainst: 0 });
  }

  for (const m of completedGroupMatches) {
    if (!m.pair1Id || !m.pair2Id) continue;
    const p1 = pairStatsMap.get(m.pair1Id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
    const p2 = pairStatsMap.get(m.pair2Id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
    const s1 = m.pair1Sets ?? 0;
    const s2 = m.pair2Sets ?? 0;
    p1.setsFor += s1; p1.setsAgainst += s2;
    p2.setsFor += s2; p2.setsAgainst += s1;
    if (m.winnerId === m.pair1Id) p1.wins++;
    else if (m.winnerId === m.pair2Id) p2.wins++;
    pairStatsMap.set(m.pair1Id, p1);
    pairStatsMap.set(m.pair2Id, p2);
  }

  // Group pairs by groupId
  const groupMap = new Map<number, typeof pairs>();
  for (const p of pairs) {
    if (!p.groupId) continue;
    if (!groupMap.has(p.groupId)) groupMap.set(p.groupId, []);
    groupMap.get(p.groupId)!.push(p);
  }

  const sortPairs = (pairList: typeof pairs) =>
    [...pairList].sort((a, b) => {
      const as = pairStatsMap.get(a.id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
      const bs = pairStatsMap.get(b.id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
      if (bs.wins !== as.wins) return bs.wins - as.wins;
      return (bs.setsFor - bs.setsAgainst) - (as.setsFor - as.setsAgainst);
    });

  // Per-group sorted standings
  const groupStandings = Array.from(groupMap.entries()).map(([groupId, pairList]) => ({
    groupId,
    sorted: sortPairs(pairList),
  }));

  // Best thirds: 3rd from each group, sorted by performance
  const thirdCandidates = groupStandings
    .filter((g) => g.sorted.length >= 3)
    .map((g) => ({ pair: g.sorted[2], stats: pairStatsMap.get(g.sorted[2].id)! }))
    .sort((a, b) => {
      if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
      return (b.stats.setsFor - b.stats.setsAgainst) - (a.stats.setsFor - a.stats.setsAgainst);
    });

  const numGroups = groupStandings.length;
  const autoQualified = numGroups * 2;
  const totalQualified = autoQualified + Math.min(bestThirds, thirdCandidates.length);
  const bracketPhase = totalQualified > 8 ? "Oitavas de Final" : totalQualified > 4 ? "Quartas de Final" : "Semifinal";

  const phaseLabels: Record<string, string> = {
    eighthfinals: "Oitavas",
    quarterfinals: "Quartas",
    semifinals: "Semifinal",
    final: "Final",
    third_place: "3° Lugar",
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/tournaments/${tournamentId}/categories/${categoryId}/generate-bracket`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ bestThirds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast.error(data.error ?? "Erro ao gerar chaves");
        return;
      }
      const result = await res.json();
      showToast.success(`Chaves geradas! ${result.matchesCreated} jogos criados (${result.bracketType === "eighthfinals" ? "Oitavas" : result.bracketType === "quarterfinals" ? "Quartas" : "Semifinal"})`);
      void qc.invalidateQueries();
      setOpen(false);
    } catch {
      showToast.error("Erro ao gerar chaves");
    } finally {
      setGenerating(false);
    }
  };

  // Not a group stage category
  if (groupMatches.length === 0) return null;

  // Group stage in progress
  if (!isAllCompleted) {
    return (
      <div className="bg-black/40 rounded-lg border border-white/5 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Fase de Grupos: {completedGroupMatches.length}/{groupMatches.length} jogos concluídos
          </p>
          <span className="text-xs text-yellow-400/80">{groupMatches.length - completedGroupMatches.length} restantes</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${groupMatches.length > 0 ? (completedGroupMatches.length / groupMatches.length) * 100 : 0}%` }}
          />
        </div>
      </div>
    );
  }

  // Group stage complete, bracket not yet generated
  return (
    <>
      {knockoutMatches.length > 0 ? (
        // Knockout already generated — show phases
        <div className="bg-green-500/5 rounded-lg border border-green-500/20 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-green-400 uppercase tracking-wider">✓ Fase de Grupos Completa — Eliminatórias Geradas</span>
            <button
              onClick={() => { setBestThirds(0); setOpen(true); }}
              className="text-[10px] text-yellow-400/70 hover:text-yellow-400 underline transition-colors"
            >
              Regerar
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from(new Set(knockoutMatches.map((m) => m.phase))).map((p) => (
              <span key={p} className="px-2 py-0.5 text-[10px] bg-green-500/15 text-green-400 rounded font-bold uppercase tracking-wider">
                {phaseLabels[p] ?? p}
              </span>
            ))}
          </div>
        </div>
      ) : (
        // Bracket not yet generated
        <div className="bg-primary/5 rounded-xl border border-primary/30 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-black text-primary uppercase tracking-wider">✓ Fase de Grupos Concluída!</p>
            <p className="text-xs text-muted-foreground mt-0.5">{numGroups} grupos · {autoQualified} duplas classificadas automaticamente</p>
          </div>
          <button
            onClick={() => { setBestThirds(0); setOpen(true); }}
            className="shrink-0 px-4 py-2 rounded-lg bg-primary text-black font-black text-sm hover:bg-primary/90 transition-all active:scale-95"
          >
            Gerar Chaves
          </button>
        </div>
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Gerar Chaves Eliminatórias">
        <div className="space-y-5 py-1">
          {/* Group standings preview */}
          {groupStandings.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-black text-muted-foreground uppercase tracking-wider">Classificação por Grupo</p>
              {groupStandings.map(({ groupId, sorted }, gi) => (
                <div key={groupId} className="bg-black/40 rounded-lg p-3 space-y-1.5">
                  <p className="text-[10px] font-black text-primary/80 uppercase tracking-wider">Grupo {String.fromCharCode(65 + gi)}</p>
                  {sorted.map((p, idx) => {
                    const st = pairStatsMap.get(p.id) ?? { wins: 0, setsFor: 0, setsAgainst: 0 };
                    const name = `${p.player1Name} / ${p.player2Name}`;
                    return (
                      <div key={p.id} className={`flex items-center justify-between text-xs ${idx < 2 ? "text-white" : "text-muted-foreground"}`}>
                        <span className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black ${idx === 0 ? "bg-yellow-500/20 text-yellow-400" : idx === 1 ? "bg-white/10 text-white/60" : "bg-red-500/10 text-red-400/60"}`}>
                            {idx + 1}°
                          </span>
                          {name}
                          {idx < 2 && <span className="text-[9px] text-green-400 font-bold">✓</span>}
                        </span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{st.wins}V · {st.setsFor}-{st.setsAgainst}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Best thirds selector */}
          {thirdCandidates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-muted-foreground uppercase tracking-wider">Melhores Terceiros Colocados</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Quantos avançam?</span>
                  <div className="flex gap-1">
                    {Array.from({ length: thirdCandidates.length + 1 }, (_, i) => i).map((n) => (
                      <button
                        key={n}
                        onClick={() => setBestThirds(n)}
                        className={`w-7 h-7 rounded text-xs font-black transition-all ${bestThirds === n ? "bg-primary text-black" : "bg-white/10 text-muted-foreground hover:bg-white/20"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {thirdCandidates.map((tc, idx) => {
                  const name = `${tc.pair.player1Name} / ${tc.pair.player2Name}`;
                  const willAdvance = idx < bestThirds;
                  return (
                    <div key={tc.pair.id} className={`flex items-center justify-between text-xs rounded px-2 py-1.5 ${willAdvance ? "bg-primary/10 border border-primary/20" : "bg-black/20 border border-white/5"}`}>
                      <span className="flex items-center gap-2">
                        <span className={`text-[10px] font-black ${willAdvance ? "text-primary" : "text-muted-foreground"}`}>{idx + 1}°</span>
                        <span className={willAdvance ? "text-white" : "text-muted-foreground"}>{name}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{tc.stats.wins}V · {tc.stats.setsFor}-{tc.stats.setsAgainst}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bracket preview */}
          <div className="bg-black/40 rounded-xl p-4 border border-white/5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total classificadas</p>
              <p className="text-2xl font-black text-white tabular-nums">{totalQualified} <span className="text-sm text-muted-foreground font-normal">duplas</span></p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Próxima fase</p>
              <p className="text-lg font-black text-primary">{bracketPhase}</p>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-3 rounded-xl bg-primary text-black font-black text-sm hover:bg-primary/90 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {generating ? "Gerando..." : `Gerar ${bracketPhase}`}
          </button>
        </div>
      </Modal>
    </>
  );
}

function AdminCategoryDetail({ tournamentId, categoryId }: { tournamentId: number; categoryId: number }) {
  const qc = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();

  const [activeSubTab, setActiveSubTab] = useState<CatSubTab>("duplas");
  const [dashboardFullscreen, setDashboardFullscreen] = useState(false);

  const pairsQ = { query: { staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true } } as const;
  const matchesQ = { query: { staleTime: 0, refetchInterval: dashboardFullscreen ? 2000 : 30000, refetchOnWindowFocus: true } };
  const { data: pairs } = useGetPairs(tournamentId, categoryId, pairsQ);
  const { data: matches } = useGetMatches(tournamentId, categoryId, matchesQ);

  const createPair = useCreatePair({ request: { headers: getAuthHeaders() } });
  const delPair = useDeletePair({ request: { headers: getAuthHeaders() } });
  const genGroups = useGenerateGroups({ request: { headers: getAuthHeaders() } });
  const [matchGroupView, setMatchGroupView] = useState<"group" | "court">("group");
  const [isAddPairOpen, setIsAddPairOpen] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [editingPair, setEditingPair] = useState<Pair | null>(null);
  const [savingPairEdit, setSavingPairEdit] = useState(false);

  const addPairForm = useForm<{ player1Name: string; player1School: string; player2Name: string; player2School: string }>({
    defaultValues: { player1Name: "", player1School: "", player2Name: "", player2School: "" },
  });

  const editPairForm = useForm<{ player1Name: string; player1School: string; player2Name: string; player2School: string }>({
    defaultValues: { player1Name: "", player1School: "", player2Name: "", player2School: "" },
  });

  const openEditPair = (p: Pair) => {
    setEditingPair(p);
    editPairForm.reset({ player1Name: p.player1Name, player1School: p.player1School ?? "", player2Name: p.player2Name, player2School: p.player2School ?? "" });
  };

  const handleEditPairSubmit = async (data: { player1Name: string; player1School: string; player2Name: string; player2School: string }) => {
    if (!editingPair) return;
    setSavingPairEdit(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/tournaments/${tournamentId}/categories/${categoryId}/pairs/${editingPair.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ player1Name: data.player1Name.trim(), player1School: data.player1School.trim() || null, player2Name: data.player2Name.trim(), player2School: data.player2School.trim() || null }),
        },
      );
      if (!res.ok) throw new Error("Falhou");
      showToast.success("Dupla atualizada!");
      qc.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/categories/${categoryId}/pairs`] });
      setEditingPair(null);
    } catch {
      showToast.error("Erro ao atualizar dupla");
    } finally {
      setSavingPairEdit(false);
    }
  };

  const handleAddPair = (data: { player1Name: string; player1School: string; player2Name: string; player2School: string }) => {
    createPair.mutate(
      { id: tournamentId, categoryId, data: { player1Name: data.player1Name.trim(), player1School: data.player1School.trim() || null, player2Name: data.player2Name.trim(), player2School: data.player2School.trim() || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/categories/${categoryId}/pairs`] });
          addPairForm.reset();
          setIsAddPairOpen(false);
        },
        onError: () => showToast.error("Erro ao registrar dupla"),
      },
    );
  };

  const handleGenGroups = async () => {
    const confirmed = await showConfirm("Gerar grupos sorteará as duplas e criará os jogos da fase de grupos. Continuar?");
    if (confirmed) {
      genGroups.mutate({ id: tournamentId, categoryId }, {
        onSuccess: () => { showToast.success("Grupos e jogos gerados!"); qc.invalidateQueries(); },
      });
    }
  };


  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-6 p-4 bg-black/40 rounded-xl border border-white/5">
        <Button size="sm" variant="outline" onClick={() => setIsAddPairOpen(true)} className="border-green-500 text-green-400 hover:bg-green-500/10">
          <Plus size={14} className="mr-2" /> Registrar Dupla
        </Button>
      </div>

      <Modal isOpen={isAddPairOpen} onClose={() => { setIsAddPairOpen(false); addPairForm.reset(); }} title="Registrar Dupla">
        <form onSubmit={addPairForm.handleSubmit(handleAddPair)} className="space-y-4">
          <div>
            <Label>Nome do Jogador 1</Label>
            <Input placeholder="Ex: João Silva" {...addPairForm.register("player1Name", { required: true })} />
          </div>
          <div>
            <Label>Escola do Jogador 1 (opcional)</Label>
            <Input placeholder="Ex: Azuos Esportes" {...addPairForm.register("player1School")} />
          </div>
          <div>
            <Label>Nome do Jogador 2</Label>
            <Input placeholder="Ex: Pedro Costa" {...addPairForm.register("player2Name", { required: true })} />
          </div>
          <div>
            <Label>Escola do Jogador 2 (opcional)</Label>
            <Input placeholder="Ex: Azuos Esportes" {...addPairForm.register("player2School")} />
          </div>
          <Button type="submit" variant="gold" className="w-full mt-4" isLoading={createPair.isPending}>
            Registrar Dupla
          </Button>
        </form>
      </Modal>

      <Modal isOpen={!!editingPair} onClose={() => setEditingPair(null)} title="Editar Dupla">
        <form onSubmit={editPairForm.handleSubmit(handleEditPairSubmit)} className="space-y-4">
          <div>
            <Label>Nome do Jogador 1</Label>
            <Input placeholder="Ex: João Silva" {...editPairForm.register("player1Name", { required: true })} />
          </div>
          <div>
            <Label>Escola do Jogador 1 (opcional)</Label>
            <Input placeholder="Ex: Azuos Esportes" {...editPairForm.register("player1School")} />
          </div>
          <div>
            <Label>Nome do Jogador 2</Label>
            <Input placeholder="Ex: Pedro Costa" {...editPairForm.register("player2Name", { required: true })} />
          </div>
          <div>
            <Label>Escola do Jogador 2 (opcional)</Label>
            <Input placeholder="Ex: Azuos Esportes" {...editPairForm.register("player2School")} />
          </div>
          <Button type="submit" variant="gold" className="w-full mt-4" isLoading={savingPairEdit}>
            Salvar Alterações
          </Button>
        </form>
      </Modal>

      <div className="flex border-b border-white/10 mb-4 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab("duplas")}
          className={cn("px-3 py-2 font-bold text-sm whitespace-nowrap shrink-0", activeSubTab === "duplas" ? "text-primary border-b-2 border-primary" : "text-muted-foreground")}
        >
          Duplas ({pairs?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveSubTab("jogos")}
          className={cn("px-3 py-2 font-bold text-sm whitespace-nowrap shrink-0", activeSubTab === "jogos" ? "text-primary border-b-2 border-primary" : "text-muted-foreground")}
        >
          Jogos ({matches?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveSubTab("quadras")}
          className={cn("px-3 py-2 font-bold text-sm whitespace-nowrap shrink-0", activeSubTab === "quadras" ? "text-primary border-b-2 border-primary" : "text-muted-foreground")}
        >
          Dashboard
        </button>
        {activeSubTab === "quadras" && (
          <button
            onClick={() => setDashboardFullscreen(true)}
            className="ml-auto mr-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-lg transition-colors"
            title="Modo TV"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            Modo TV
          </button>
        )}
      </div>

      {activeSubTab === "duplas" && (
        <div>
          <div className="space-y-2">
            {pairs?.map((p: Pair) => (
              <div key={p.id} className="flex justify-between items-center bg-background p-3 rounded-lg border border-white/5">
                <div className="flex items-center gap-3">
                  {p.photoUrl && (
                    <div className="relative">
                      <img src={p.photoUrl} alt={`${p.player1Name} / ${p.player2Name}`} className="w-10 h-10 rounded-full object-cover" />
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-sm">{p.player1Name}</div>
                    <div className="font-bold text-sm text-muted-foreground">{p.player2Name}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="cursor-pointer text-primary hover:text-primary/80">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          const res = await fetch("/api/pairs/upload", {
                            method: "POST",
                            headers: getAuthHeaders(),
                            body: fd,
                          });
                          if (!res.ok) throw new Error("Upload falhou");
                          const { url } = await res.json() as { url: string };
                          await fetch(`${import.meta.env.BASE_URL}api/tournaments/${tournamentId}/categories/${categoryId}/pairs/${p.id}/photo`, {
                            method: "PUT",
                            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                            body: JSON.stringify({ photoUrl: url }),
                          });
                          qc.invalidateQueries();
                          showToast.success("Foto atualizada!");
                        } catch {
                          showToast.error("Erro ao fazer upload de foto");
                        }
                      }}
                    />
                    <ImageIcon size={16} />
                  </label>
                  {p.photoUrl && (
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`${import.meta.env.BASE_URL}api/tournaments/${tournamentId}/categories/${categoryId}/pairs/${p.id}/photo`, {
                            method: "PUT",
                            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                            body: JSON.stringify({ photoUrl: null }),
                          });
                          qc.invalidateQueries();
                          showToast.success("Foto removida!");
                        } catch {
                          showToast.error("Erro ao remover foto");
                        }
                      }}
                      className="text-destructive hover:text-red-400"
                      title="Remover foto"
                    >
                      <X size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => openEditPair(p)}
                    className="text-blue-400 hover:text-blue-300"
                    title="Editar dupla"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={async () => {
                      const confirmed = await showConfirm("Remover dupla?");
                      if (confirmed) {
                        delPair.mutate(
                          { id: tournamentId, categoryId, pairId: p.id },
                          { onSuccess: () => qc.invalidateQueries() },
                        );
                      }
                    }}
                    className="text-destructive hover:text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSubTab === "jogos" && (
        <div className="space-y-4">
          <AutoGenerateGroups tournamentId={tournamentId} categoryId={categoryId} pairs={pairs} matches={matches} />
          <AdminMatchCreate tournamentId={tournamentId} categoryId={categoryId} pairs={pairs} matches={matches} />
          
          <BracketGenerator
            matches={matches}
            pairs={pairs}
            tournamentId={tournamentId}
            categoryId={categoryId}
            getAuthHeaders={getAuthHeaders}
            qc={qc}
          />
          
          {matches && matches.length > 0 && (() => {
            const phaseLabels: Record<string, string> = {
              "group": "Fase de Grupos",
              "group_stage": "Fase de Grupos",
              "eighthfinals": "Oitavas",
              "quarterfinals": "Quartas",
              "semifinals": "Semi",
              "final": "Final",
              "third_place": "Terceiro Lugar",
            };
            
            const phases = Array.from(new Set(matches.map((m: Match) => m.phase))).sort((a, b) => {
              const order = ["group", "group_stage", "eighthfinals", "quarterfinals", "semifinals", "final", "third_place"];
              return order.indexOf(a) - order.indexOf(b);
            });
            
            if (!selectedPhase && phases.length > 0) {
              setSelectedPhase(phases[0]);
            }
            
            const matchesForPhase = selectedPhase ? matches.filter((m: Match) => m.phase === selectedPhase) : [];

            // Global sequential index by creation order (database id)
            const allMatchesSorted = [...matches].sort((a: Match, b: Match) => a.id - b.id);
            const globalIndexMap = new Map<number, number>(allMatchesSorted.map((m: Match, i: number) => [m.id, i]));
            
            return (
              <div className="space-y-4">
                <div className="flex border-b border-white/10 overflow-x-auto">
                  {phases.map((phase) => {
                    const phaseMatches = matches.filter((m: Match) => m.phase === phase);
                    return (
                      <button
                        key={phase}
                        onClick={() => setSelectedPhase(phase)}
                        className={cn(
                          "px-4 py-2 font-bold whitespace-nowrap",
                          selectedPhase === phase 
                            ? "text-primary border-b-2 border-primary" 
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {phaseLabels[phase]} ({phaseMatches.length})
                      </button>
                    );
                  })}
                </div>
                
                {selectedPhase === "group_stage" && (
                  <div className="flex gap-1 p-1 bg-black/30 rounded-lg w-fit border border-white/10">
                    <button
                      onClick={() => setMatchGroupView("group")}
                      className={cn("px-3 py-1.5 text-xs font-bold rounded-md transition-colors", matchGroupView === "group" ? "bg-primary text-black" : "text-muted-foreground hover:text-foreground")}
                    >
                      Por Grupo
                    </button>
                    <button
                      onClick={() => setMatchGroupView("court")}
                      className={cn("px-3 py-1.5 text-xs font-bold rounded-md transition-colors", matchGroupView === "court" ? "bg-primary text-black" : "text-muted-foreground hover:text-foreground")}
                    >
                      Por Quadra
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  {selectedPhase === "group_stage" ? (
                    matchGroupView === "group" ? (
                      (() => {
                        const groupNames = [...new Set(matchesForPhase.filter(m => m.groupName).map(m => m.groupName))].sort();
                        return (
                          <div className="space-y-6">
                            {groupNames.map(groupName => (
                              <div key={groupName} className="space-y-3 border-l-4 border-primary pl-4">
                                <h4 className="text-sm font-bold text-primary uppercase tracking-wider">{groupName}</h4>
                                {[...matchesForPhase.filter(m => m.groupName === groupName)].sort((a, b) => (a.matchOrder ?? 0) - (b.matchOrder ?? 0)).map((m) => (
                                  <AdminMatchRow key={m.id} match={m} tournamentId={tournamentId} categoryId={categoryId} pairs={pairs} index={globalIndexMap.get(m.id)} />
                                ))}
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    ) : (
                      (() => {
                        const sortedByCourt = [...matchesForPhase].sort((a, b) => (a.matchOrder ?? 0) - (b.matchOrder ?? 0));
                        const courtNames = [...new Set(sortedByCourt.map(m => m.court ?? "Sem quadra"))].sort();
                        return (
                          <div className="space-y-6">
                            {courtNames.map(court => {
                              const courtMatches = sortedByCourt.filter(m => (m.court ?? "Sem quadra") === court);
                              const nextIdx = courtMatches.findIndex(m => (m as any).status !== "completed" && !m.completed);
                              return (
                                <div key={court} className="space-y-2">
                                  <div className="flex items-center gap-3">
                                    <h4 className="text-sm font-bold text-primary uppercase tracking-wider">{court}</h4>
                                    <span className="text-[10px] text-muted-foreground font-semibold">
                                      {courtMatches.filter(m => (m as any).status === "completed" || m.completed).length}/{courtMatches.length} concluídos
                                    </span>
                                  </div>
                                  <div className="space-y-2 border-l-4 border-primary/40 pl-4">
                                    {courtMatches.map((m, idx) => (
                                      <div key={m.id} className={cn(
                                        "rounded-lg transition-all",
                                        idx === nextIdx && "ring-1 ring-primary/50"
                                      )}>
                                        {idx === nextIdx && (
                                          <div className="px-3 pt-2 pb-0">
                                            <span className="text-[10px] font-bold text-primary uppercase tracking-widest">→ Próximo</span>
                                          </div>
                                        )}
                                        <AdminMatchRow match={m} tournamentId={tournamentId} categoryId={categoryId} pairs={pairs} index={idx + 1} />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()
                    )
                  ) : (
                    matchesForPhase?.map((m: Match) => (
                      <AdminMatchRow key={m.id} match={m} tournamentId={tournamentId} categoryId={categoryId} pairs={pairs} index={globalIndexMap.get(m.id)} />
                    ))
                  )}
                </div>
              </div>
            );
          })()}
          
          {!matches?.length && <p className="text-muted-foreground text-sm">Nenhum jogo criado ainda.</p>}
        </div>
      )}

      {activeSubTab === "quadras" && (
        <CourtsBoardView matches={matches} />
      )}

      {/* Fullscreen TV Dashboard overlay */}
      {dashboardFullscreen && (
        <DashboardTvOverlay matches={matches} onClose={() => setDashboardFullscreen(false)} />
      )}
    </div>
  );
}

function DashboardTvOverlay({ matches, onClose }: { matches?: Match[]; onClose: () => void }) {
  const { profile } = useCompanyProfile();
  const arenaName = profile?.company_name || "Arena";

  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const allMatches = (matches ?? [])
    .sort((a: Match, b: Match) => (a.matchOrder ?? 0) - (b.matchOrder ?? 0));

  const courtNames = Array.from(new Set(allMatches.map((m: Match) => m.court ?? "Sem quadra"))).sort();
  const matchesByCourt = new Map<string, Match[]>();
  for (const court of courtNames) {
    matchesByCourt.set(court, allMatches.filter((m: Match) => (m.court ?? "Sem quadra") === court));
  }

  // Only show courts that still have pending or in_progress matches
  const activeCourts = courtNames.filter((court) => {
    const ms = matchesByCourt.get(court) ?? [];
    return ms.some((m: Match) => (m as any).status === "in_progress" || !((m as any).status) || (m as any).status === "pending");
  });

  // Dynamic grid columns based on active court count — on mobile always 1 col
  const n = activeCourts.length;
  const cols = isMobile ? 1 : (n <= 1 ? 1 : n <= 3 ? n : 2);
  const rows = isMobile ? n : (n <= 3 ? 1 : Math.ceil(n / 2));

  // Font sizes scale up as fewer courts remain (for TV readability); scale down on mobile
  const mobileFactor = isMobile ? 0.42 : 1;
  const tvSizing = n === 1
    ? { courtName: `${2.2 * mobileFactor}rem`, playerName: `${3 * mobileFactor}rem`, score: `${11 * mobileFactor}rem`, games: `${1.4 * mobileFactor}rem` }
    : n === 2
    ? { courtName: `${1.8 * mobileFactor}rem`, playerName: `${2.2 * mobileFactor}rem`, score: `${7.5 * mobileFactor}rem`, games: `${1.1 * mobileFactor}rem` }
    : n === 3
    ? { courtName: `${1.5 * mobileFactor}rem`, playerName: `${1.5 * mobileFactor}rem`, score: `${5 * mobileFactor}rem`, games: `${0.9 * mobileFactor}rem` }
    : { courtName: `${1.5 * mobileFactor}rem`, playerName: `${1.25 * mobileFactor}rem`, score: `${3.75 * mobileFactor}rem`, games: `${0.875 * mobileFactor}rem` };

  const liveCount = allMatches.filter((m: Match) => (m as any).status === "in_progress").length;
  const doneCount = allMatches.filter((m: Match) => (m as any).status === "completed" || m.completed).length;
  const pendingCount = allMatches.filter((m: Match) => !((m as any).status) || (m as any).status === "pending").length;

  // Champion detection: final match completed with a winner
  const finalMatch = allMatches.find((m: Match) => m.phase === "final");
  const champion = (finalMatch?.completed && finalMatch?.winnerId)
    ? (() => {
        const winnerIsP1 = finalMatch.winnerId === finalMatch.pair1Id;
        const fm = finalMatch as any;
        return {
          name: winnerIsP1 ? finalMatch.pair1Name : finalMatch.pair2Name,
          pair1Name: finalMatch.pair1Name,
          pair2Name: finalMatch.pair2Name,
          // Individual player photos of the WINNING pair
          player1Photo: (winnerIsP1 ? fm.pair1Player1PhotoUrl : fm.pair2Player1PhotoUrl) as string | null,
          player2Photo: (winnerIsP1 ? fm.pair1Player2PhotoUrl : fm.pair2Player2PhotoUrl) as string | null,
        };
      })()
    : null;

  // Determine the current active phase label
  const phaseOrder = ["group_stage", "eighthfinals", "quarterfinals", "semifinals", "third_place", "final"];
  const phaseNames: Record<string, string> = {
    group_stage: "Fase de Grupos",
    eighthfinals: "Oitavas de Final",
    quarterfinals: "Quartas de Final",
    semifinals: "Semifinal",
    third_place: "Decisão de 3° Lugar",
    final: "Grande Final",
  };
  // Find the most advanced phase that still has live or pending matches
  const activePhases = new Set(
    allMatches
      .filter((m: Match) => (m as any).status !== "completed" && !m.completed)
      .map((m: Match) => m.phase as string)
  );
  // Pick the LEAST advanced active phase so third_place shows before final
  const currentPhase = phaseOrder.find((p) => activePhases.has(p)) ?? null;
  const isFinal = currentPhase === "final";

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col overflow-hidden"
      style={{
        fontFamily: "system-ui, sans-serif",
        background: isFinal
          ? "radial-gradient(ellipse at 50% 0%, #1a1200 0%, #0a0a0a 60%)"
          : "#0a0a0a",
      }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 md:px-8 py-2 md:py-4 border-b shrink-0"
        style={{ borderColor: isFinal ? "rgba(202,160,0,0.25)" : "rgba(255,255,255,0.1)" }}
      >
        <div className="flex items-center gap-3 md:gap-6 min-w-0">
          <span
            className="text-base md:text-3xl font-black tracking-tight uppercase shrink-0"
            style={{ color: isFinal ? "#f5c400" : "white" }}
          >
            {arenaName}
          </span>
          <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm font-semibold flex-wrap">
            <span className="flex items-center gap-1 text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />
              {liveCount} ao vivo
            </span>
            <span className="text-muted-foreground hidden sm:inline">{pendingCount} pendentes</span>
            <span className="text-green-400">✓ {doneCount}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1.5 md:py-2 text-xs md:text-sm font-bold text-muted-foreground hover:text-white border border-white/10 hover:border-white/30 rounded-xl transition-colors shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
          Sair
        </button>
      </div>

      {/* Current phase banner */}
      {currentPhase && (
        isFinal ? (
          /* ── Grande Final — banner chamativo ── */
          <div
            className="shrink-0 flex items-center justify-center gap-5 py-4 border-b"
            style={{
              background: "linear-gradient(90deg, transparent 0%, rgba(202,160,0,0.15) 30%, rgba(202,160,0,0.22) 50%, rgba(202,160,0,0.15) 70%, transparent 100%)",
              borderColor: "rgba(202,160,0,0.35)",
            }}
          >
            <span style={{ fontSize: 28, lineHeight: 1 }}>🏆</span>
            <span
              className="font-black uppercase"
              style={{
                fontSize: "1.6rem",
                letterSpacing: "0.35em",
                color: "#f5c400",
                textShadow: "0 0 32px rgba(245,196,0,0.55), 0 0 8px rgba(245,196,0,0.35)",
              }}
            >
              Grande Final
            </span>
            <span style={{ fontSize: 28, lineHeight: 1 }}>🏆</span>
          </div>
        ) : (
          /* ── Outras fases — banner padrão ── */
          <div className="shrink-0 flex items-center justify-center py-2.5 bg-primary/10 border-b border-primary/20">
            <span className="text-base font-black text-primary uppercase tracking-[0.2em]">
              {phaseNames[currentPhase] ?? currentPhase}
            </span>
          </div>
        )
      )}

      {/* Courts grid */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        {activeCourts.length === 0 ? (
          champion ? (
            /* ── Champion Celebration Screen ── */
            <div className="relative h-full flex flex-col items-center justify-center overflow-hidden">
              <style>{`
                @keyframes fw-burst {
                  0%   { transform: scale(0) translate(0,0); opacity: 1; }
                  80%  { opacity: 0.8; }
                  100% { transform: scale(1) translate(var(--tx), var(--ty)); opacity: 0; }
                }
                @keyframes fw-float {
                  0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
                  100% { transform: translateY(-120vh) rotate(720deg); opacity: 0; }
                }
                @keyframes champion-glow {
                  0%, 100% { text-shadow: 0 0 40px rgba(245,196,0,0.8), 0 0 80px rgba(245,196,0,0.4); }
                  50%       { text-shadow: 0 0 80px rgba(245,196,0,1),   0 0 160px rgba(245,196,0,0.6); }
                }
                @keyframes champion-scale {
                  0%   { transform: scale(0.5); opacity: 0; }
                  60%  { transform: scale(1.08); }
                  100% { transform: scale(1); opacity: 1; }
                }
                .fw-particle {
                  position: absolute;
                  border-radius: 50%;
                  animation: fw-burst 1.2s ease-out infinite;
                }
                .fw-confetti {
                  position: absolute;
                  animation: fw-float linear infinite;
                }
                .champion-text {
                  animation: champion-scale 1s cubic-bezier(0.34,1.56,0.64,1) forwards, champion-glow 2s ease-in-out 1s infinite;
                }
              `}</style>

              {/* Firework bursts – static positions so SSR-safe */}
              {[
                { top: "15%", left: "10%", color: "#f5c400", size: 180, delay: "0s",   dur: "2.2s" },
                { top: "10%", left: "85%", color: "#ff6b35", size: 140, delay: "0.4s", dur: "2.0s" },
                { top: "70%", left: "5%",  color: "#c084fc", size: 120, delay: "0.8s", dur: "2.5s" },
                { top: "75%", left: "90%", color: "#34d399", size: 160, delay: "0.2s", dur: "1.8s" },
                { top: "5%",  left: "50%", color: "#f5c400", size: 200, delay: "1.0s", dur: "2.3s" },
                { top: "85%", left: "50%", color: "#fb923c", size: 130, delay: "0.6s", dur: "2.1s" },
                { top: "40%", left: "2%",  color: "#f5c400", size: 100, delay: "1.4s", dur: "1.9s" },
                { top: "40%", left: "95%", color: "#e879f9", size: 110, delay: "0.9s", dur: "2.4s" },
              ].map((fw, i) => (
                <div key={i} style={{ position: "absolute", top: fw.top, left: fw.left }}>
                  {Array.from({ length: 10 }).map((_, j) => {
                    const angle = (j / 10) * 360;
                    const dist = fw.size;
                    const tx = Math.round(Math.cos((angle * Math.PI) / 180) * dist);
                    const ty = Math.round(Math.sin((angle * Math.PI) / 180) * dist);
                    return (
                      <div
                        key={j}
                        className="fw-particle"
                        style={{
                          width: 10,
                          height: 10,
                          background: fw.color,
                          animationDelay: fw.delay,
                          animationDuration: fw.dur,
                          "--tx": `${tx}px`,
                          "--ty": `${ty}px`,
                        } as React.CSSProperties}
                      />
                    );
                  })}
                </div>
              ))}

              {/* Floating confetti stars */}
              {[
                { left: "8%",  delay: "0s",   dur: "4s",  color: "#f5c400", size: 20 },
                { left: "25%", delay: "1s",   dur: "5s",  color: "#fb923c", size: 14 },
                { left: "45%", delay: "0.5s", dur: "3.5s",color: "#f5c400", size: 18 },
                { left: "65%", delay: "1.5s", dur: "4.5s",color: "#c084fc", size: 16 },
                { left: "80%", delay: "0.3s", dur: "4.2s",color: "#f5c400", size: 22 },
                { left: "90%", delay: "0.8s", dur: "3.8s",color: "#34d399", size: 12 },
                { left: "55%", delay: "2s",   dur: "5.5s",color: "#f5c400", size: 16 },
              ].map((s, i) => (
                <div
                  key={i}
                  className="fw-confetti pointer-events-none select-none"
                  style={{
                    bottom: "-20px",
                    left: s.left,
                    fontSize: s.size,
                    color: s.color,
                    animationDelay: s.delay,
                    animationDuration: s.dur,
                  }}
                >
                  ★
                </div>
              ))}

              {/* Responsive layout: 3-col on desktop, stacked on mobile */}
              {isMobile ? (
                /* ── Mobile: vertical stack ── */
                <div className="relative z-10 w-full flex flex-col items-center justify-center gap-4 px-4 py-4">
                  {/* Trophy + title + name */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.6rem", textAlign: "center" }}>
                    <div style={{ fontSize: "2.8rem", lineHeight: 1, filter: "drop-shadow(0 0 30px rgba(245,196,0,0.9))" }}>🏆</div>
                    <div className="champion-text font-black uppercase" style={{ fontSize: "2rem", letterSpacing: "0.25em", color: "#f5c400" }}>Campeões!</div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#fff", lineHeight: 1.3, textShadow: "0 2px 20px rgba(0,0,0,0.9)", textAlign: "center" }}>{champion.name ?? "Campeões"}</div>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(245,196,0,0.7)", letterSpacing: "0.25em", textTransform: "uppercase" }}>{arenaName}</div>
                  </div>
                  {/* Photos side by side */}
                  <div style={{ display: "flex", gap: "1.2rem", justifyContent: "center", alignItems: "center" }}>
                    {[champion.player1Photo, champion.player2Photo].map((photo, i) => (
                      photo ? (
                        <div key={i} style={{ width: "min(38vw, 160px)", height: "min(38vw, 160px)", borderRadius: "50%", overflow: "hidden", border: "6px solid #f5c400", boxShadow: "0 0 60px rgba(245,196,0,0.8)" }}>
                          <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      ) : (
                        <div key={i} style={{ width: "min(38vw, 160px)", height: "min(38vw, 160px)", borderRadius: "50%", border: "5px solid #f5c400", boxShadow: "0 0 60px rgba(245,196,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(245,196,0,0.06)", fontSize: "3.5rem" }}>🥇</div>
                      )
                    ))}
                  </div>
                </div>
              ) : (
                /* ── Desktop: 3-column grid ── */
                <div
                  className="relative z-10 w-full h-full"
                  style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0 3%" }}
                >
                  {/* LEFT photo */}
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                    {champion.player1Photo ? (
                      <div style={{ width: "min(58vh, 380px)", height: "min(58vh, 380px)", borderRadius: "50%", overflow: "hidden", border: "10px solid #f5c400", boxShadow: "0 0 120px rgba(245,196,0,0.85), 0 0 50px rgba(245,196,0,0.5)" }}>
                        <img src={champion.player1Photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ) : (
                      <div style={{ width: "min(58vh, 380px)", height: "min(58vh, 380px)", borderRadius: "50%", border: "8px solid #f5c400", boxShadow: "0 0 120px rgba(245,196,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(245,196,0,0.06)", fontSize: "8rem" }}>🥇</div>
                    )}
                  </div>
                  {/* CENTER content */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.2rem", textAlign: "center", padding: "0 2rem", minWidth: 0 }}>
                    <div style={{ fontSize: "5.5rem", lineHeight: 1, filter: "drop-shadow(0 0 40px rgba(245,196,0,0.9))" }}>🏆</div>
                    <div className="champion-text font-black uppercase" style={{ fontSize: "4.5rem", letterSpacing: "0.3em", color: "#f5c400", whiteSpace: "nowrap" }}>Campeões!</div>
                    <div style={{ fontSize: "2.2rem", fontWeight: 900, color: "#fff", letterSpacing: "0.03em", lineHeight: 1.2, textShadow: "0 2px 30px rgba(0,0,0,0.9)", whiteSpace: "nowrap" }}>{champion.name ?? "Campeões"}</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "rgba(245,196,0,0.7)", letterSpacing: "0.3em", textTransform: "uppercase" }}>{arenaName}</div>
                  </div>
                  {/* RIGHT photo */}
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
                    {champion.player2Photo ? (
                      <div style={{ width: "min(58vh, 380px)", height: "min(58vh, 380px)", borderRadius: "50%", overflow: "hidden", border: "10px solid #f5c400", boxShadow: "0 0 120px rgba(245,196,0,0.85), 0 0 50px rgba(245,196,0,0.5)" }}>
                        <img src={champion.player2Photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ) : (
                      <div style={{ width: "min(58vh, 380px)", height: "min(58vh, 380px)", borderRadius: "50%", border: "8px solid #f5c400", boxShadow: "0 0 120px rgba(245,196,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(245,196,0,0.06)", fontSize: "8rem" }}>🥇</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <span className="text-2xl font-bold text-green-400">✓ Todos os jogos concluídos!</span>
            </div>
          )
        ) : (
          <div
            className="grid gap-3 md:gap-5"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              minHeight: isMobile ? "auto" : "100%",
              height: isMobile ? "auto" : "100%",
            }}
          >
            {activeCourts.map((court) => {
              const courtMatches = matchesByCourt.get(court) ?? [];
              const liveMatch = courtMatches.find((m: Match) => (m as any).status === "in_progress");
              const pendingMatches = courtMatches.filter((m: Match) => !((m as any).status) || (m as any).status === "pending");
              const nextMatch = pendingMatches[0] ?? null;
              const queueMatches = liveMatch ? pendingMatches : pendingMatches.slice(1);
              const doneCountCourt = courtMatches.filter((m: Match) => (m as any).status === "completed" || m.completed).length;
              const isLive = !!liveMatch;
              const isWaiting = !liveMatch && !!nextMatch;

              return (
                <div
                  key={court}
                  className={cn(
                    "rounded-3xl overflow-hidden border-2 flex flex-col min-h-[280px] md:min-h-0",
                    isFinal
                      ? isLive
                        ? "border-yellow-400/80 bg-gradient-to-b from-yellow-950/60 to-black/90 shadow-[0_0_60px_rgba(245,196,0,0.25)]"
                        : "border-yellow-600/40 bg-gradient-to-b from-yellow-950/20 to-black/80"
                      : isLive
                      ? "border-yellow-500/60 bg-gradient-to-b from-yellow-950/40 to-black/80 shadow-[0_0_40px_rgba(234,179,8,0.15)]"
                      : isWaiting
                      ? "border-blue-500/40 bg-black/60"
                      : "border-white/10 bg-black/60"
                  )}
                >
                  {/* Court header */}
                  <div className={cn(
                    "px-3 md:px-6 py-2 md:py-3 flex items-center justify-between border-b shrink-0",
                    isLive ? "border-yellow-500/30 bg-yellow-500/10" : isWaiting ? "border-blue-500/20 bg-blue-500/5" : "border-white/10 bg-white/5"
                  )}>
                    <span className={cn("font-black uppercase tracking-widest", isLive ? "text-yellow-300" : isWaiting ? "text-blue-300" : "text-white/50")} style={{ fontSize: tvSizing.courtName }}>
                      {court}
                    </span>
                    <div className="flex items-center gap-2 md:gap-3">
                      <span className="text-xs md:text-sm text-muted-foreground font-semibold">{doneCountCourt}/{courtMatches.length}</span>
                      {isLive && (
                        <span className="flex items-center gap-1 text-xs md:text-sm bg-yellow-500 text-black font-black px-2 md:px-3 py-0.5 md:py-1 rounded-full animate-pulse">
                          ● AO VIVO
                        </span>
                      )}
                      {isWaiting && (
                        <span className="flex items-center gap-1 text-xs md:text-sm border border-blue-500/50 text-blue-300 font-bold px-2 md:px-3 py-0.5 md:py-1 rounded-full">
                          ⏳ Aguardando
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Main court area */}
                  <div className="flex-1 min-h-0 px-3 md:px-6 py-3 md:py-4 flex flex-col gap-3">
                    {/* Live match */}
                    {liveMatch && (
                      <>
                        {liveMatch.groupName && (
                          <div className="text-xs font-bold uppercase tracking-widest text-yellow-400/70">{liveMatch.groupName}</div>
                        )}
                        <div className="relative rounded-2xl overflow-hidden border-2 border-yellow-500/30 bg-[#143d1e] flex-1 min-h-0">
                          <div className="absolute inset-y-0 left-1/2 -translate-x-px w-0.5 bg-white/20 z-10" />
                          <div className="absolute inset-2 border border-white/10 rounded-xl pointer-events-none" />
                          <div className="flex h-full">
                            <div className="flex-1 px-4 flex flex-col items-center justify-center text-center">
                              <div className="font-black text-white leading-tight" style={{ fontSize: tvSizing.playerName }}>{liveMatch.pair1Name ?? "TBD"}</div>
                              {liveMatch.pair1Sets != null && (
                                <div className="font-black text-yellow-300 mt-2 leading-none" style={{ fontSize: tvSizing.score }}>{liveMatch.pair1Sets}</div>
                              )}
                              {liveMatch.pair1Games != null && (
                                <div className="font-bold text-yellow-300/60 mt-1" style={{ fontSize: tvSizing.games }}>{liveMatch.pair1Games} games</div>
                              )}
                            </div>
                            <div className="flex-1 px-4 flex flex-col items-center justify-center text-center">
                              <div className="font-black text-white leading-tight" style={{ fontSize: tvSizing.playerName }}>{liveMatch.pair2Name ?? "TBD"}</div>
                              {liveMatch.pair2Sets != null && (
                                <div className="font-black text-yellow-300 mt-2 leading-none" style={{ fontSize: tvSizing.score }}>{liveMatch.pair2Sets}</div>
                              )}
                              {liveMatch.pair2Games != null && (
                                <div className="font-bold text-yellow-300/60 mt-1" style={{ fontSize: tvSizing.games }}>{liveMatch.pair2Games} games</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Waiting: next match shown prominently */}
                    {isWaiting && nextMatch && (
                      <>
                        {nextMatch.groupName && (
                          <div className="text-xs font-bold uppercase tracking-widest text-blue-400/70">{nextMatch.groupName}</div>
                        )}
                        <div className="relative rounded-2xl overflow-hidden border-2 border-blue-500/30 bg-[#0e1a2e] flex-1 min-h-0">
                          <div className="absolute inset-y-0 left-1/2 -translate-x-px w-0.5 bg-white/10 z-10" />
                          <div className="absolute inset-2 border border-white/5 rounded-xl pointer-events-none" />
                          <div className="flex h-full">
                            <div className="flex-1 px-4 flex flex-col items-center justify-center text-center">
                              <div className="font-black text-white/70 leading-tight" style={{ fontSize: tvSizing.playerName }}>{nextMatch.pair1Name ?? "TBD"}</div>
                              <div className="font-black text-blue-300/40 mt-2 leading-none" style={{ fontSize: tvSizing.score }}>—</div>
                            </div>
                            <div className="flex-1 px-4 flex flex-col items-center justify-center text-center">
                              <div className="font-black text-white/70 leading-tight" style={{ fontSize: tvSizing.playerName }}>{nextMatch.pair2Name ?? "TBD"}</div>
                              <div className="font-black text-blue-300/40 mt-2 leading-none" style={{ fontSize: tvSizing.score }}>—</div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Queue: remaining pending matches */}
                  {queueMatches.length > 0 && (
                    <div className="border-t border-white/5 bg-black/30 shrink-0">
                      <div className="px-5 pt-2 pb-1">
                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Próximos</span>
                      </div>
                      {queueMatches.slice(0, 3).map((m: Match, i: number) => (
                        <div key={m.id} className={cn("px-5 py-2 flex items-center gap-3", i > 0 && "border-t border-white/5")}>
                          <span className="text-xs text-muted-foreground font-bold w-5 text-right shrink-0">{i + 1}.</span>
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <span className="text-sm font-bold text-white/75 truncate">{m.pair1Name ?? "TBD"}</span>
                            <span className="text-xs text-muted-foreground shrink-0">×</span>
                            <span className="text-sm font-bold text-white/75 truncate">{m.pair2Name ?? "TBD"}</span>
                          </div>
                          {m.groupName && <span className="text-xs text-muted-foreground/50 shrink-0">{m.groupName}</span>}
                        </div>
                      ))}
                      {queueMatches.length > 3 && (
                        <div className="px-5 py-1.5 text-xs text-muted-foreground text-center">+{queueMatches.length - 3} mais</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface CourtsBoardViewProps {
  matches?: Match[];
}

function CourtsBoardView({ matches }: CourtsBoardViewProps) {
  const allMatches = (matches ?? [])
    .sort((a: Match, b: Match) => (a.matchOrder ?? 0) - (b.matchOrder ?? 0));

  if (allMatches.length === 0) {
    return <p className="text-muted-foreground text-sm">Nenhum jogo criado ainda.</p>;
  }

  const courtNames = Array.from(new Set(allMatches.map((m: Match) => m.court ?? "Sem quadra"))).sort();
  const matchesByCourt = new Map<string, Match[]>();
  for (const court of courtNames) {
    matchesByCourt.set(court, allMatches.filter((m: Match) => (m.court ?? "Sem quadra") === court));
  }

  return (
    <div className="space-y-6">
      {/* Live courts */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Quadras</h3>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {courtNames.map((court) => {
            const courtMatches = matchesByCourt.get(court) ?? [];
            const liveMatch = courtMatches.find((m: Match) => (m as any).status === "in_progress");
            const nextMatches = courtMatches.filter((m: Match) => (m as any).status === "pending" || !(m as any).status);
            const doneCount = courtMatches.filter((m: Match) => (m as any).status === "completed" || m.completed).length;

            return (
              <div key={court} className="rounded-2xl overflow-hidden border border-white/10 bg-black/50">
                {/* Court name bar */}
                <div className={cn(
                  "px-4 py-2 flex items-center justify-between",
                  liveMatch ? "bg-yellow-500/20 border-b border-yellow-500/30" : "bg-white/5 border-b border-white/10"
                )}>
                  <span className={cn("font-black text-base uppercase tracking-widest", liveMatch ? "text-yellow-400" : "text-white/70")}>
                    {court}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-semibold">{doneCount}/{courtMatches.length} concluídos</span>
                </div>

                {/* Live match — court visual */}
                {liveMatch ? (
                  <div className="px-4 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-400">{liveMatch.groupName ?? ""}</span>
                      <span className="text-[10px] bg-yellow-500 text-black font-black px-2 py-0.5 rounded-full animate-pulse">● AO VIVO</span>
                    </div>
                    {/* Court graphic */}
                    <div className="relative rounded-xl overflow-hidden border-2 border-yellow-500/40 bg-[#1a4d2e] mt-2">
                      {/* Net line */}
                      <div className="absolute inset-y-0 left-1/2 -translate-x-px w-0.5 bg-white/30 z-10" />
                      <div className="flex">
                        {/* Left side — Pair 1 */}
                        <div className="flex-1 px-3 py-5 text-center relative">
                          <div className="font-black text-white text-sm leading-tight drop-shadow">{liveMatch.pair1Name ?? "TBD"}</div>
                          {liveMatch.pair1Sets != null && (
                            <div className="text-3xl font-black text-yellow-300 mt-2 drop-shadow-lg">{liveMatch.pair1Sets}</div>
                          )}
                        </div>
                        {/* Right side — Pair 2 */}
                        <div className="flex-1 px-3 py-5 text-center relative">
                          <div className="font-black text-white text-sm leading-tight drop-shadow">{liveMatch.pair2Name ?? "TBD"}</div>
                          {liveMatch.pair2Sets != null && (
                            <div className="text-3xl font-black text-yellow-300 mt-2 drop-shadow-lg">{liveMatch.pair2Sets}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-4 text-center">
                    <span className="text-xs text-muted-foreground italic">
                      {doneCount === courtMatches.length ? "✓ Todos os jogos concluídos" : "Aguardando início..."}
                    </span>
                  </div>
                )}

                {/* Next matches */}
                {nextMatches.length > 0 && (
                  <div className="border-t border-white/5 bg-black/30">
                    <div className="px-3 pt-2 pb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Próximos jogos</span>
                    </div>
                    {nextMatches.slice(0, 3).map((m: Match, i: number) => (
                      <div key={m.id} className={cn("px-3 py-2 flex items-center gap-2", i > 0 && "border-t border-white/5")}>
                        <span className="text-[10px] text-muted-foreground font-bold w-4 text-right shrink-0">{i + 1}.</span>
                        <div className="flex-1 flex items-center gap-1 min-w-0">
                          <span className="text-xs font-semibold text-white/80 truncate">{m.pair1Name ?? "TBD"}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">×</span>
                          <span className="text-xs font-semibold text-white/80 truncate">{m.pair2Name ?? "TBD"}</span>
                        </div>
                        {m.groupName && (
                          <span className="text-[9px] text-muted-foreground/70 shrink-0">{m.groupName}</span>
                        )}
                      </div>
                    ))}
                    {nextMatches.length > 3 && (
                      <div className="px-3 py-1.5 text-[10px] text-muted-foreground text-center">
                        +{nextMatches.length - 3} jogos restantes
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface AdminMatchRowProps {
  match: Match;
  tournamentId: number;
  categoryId: number;
  pairs?: Pair[];
  index?: number;
}


// ─── Admin Tournament Registrations ───────────────────────────────────────────

type RegPlayer = { id: number; fullName: string; nickname?: string | null; cpf: string; phone?: string | null; email: string; age: number; shirtSize?: string | null; school?: string | null; instagram?: string | null; photoUrl?: string | null; isMainContact: number };
type RegItem = { id: number; tournamentId: number; registrationType: string; categoryName?: string | null; price: string; status: string; pixQrCodeBase64?: string | null; pixCopiaECola?: string | null; notes?: string | null; expiresAt?: string | null; createdAt: string; players: RegPlayer[] };

function AdminTournamentRegistrations({ tournamentId }: { tournamentId: number }) {
  const { getAuthHeaders } = useAdminAuth();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showQr, setShowQr] = useState<number | null>(null);
  const [searchName, setSearchName] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState<RegItem | null>(null);
  const [manualType, setManualType] = useState<"individual" | "dupla" | "trio">("dupla");
  const [manualCategory, setManualCategory] = useState("");
  const [manualPlayers, setManualPlayers] = useState([
    { fullName: "", nickname: "", cpf: "", phone: "", email: "", age: "", shirtSize: "", school: "", instagram: "", photoUrl: "" },
    { fullName: "", nickname: "", cpf: "", phone: "", email: "", age: "", shirtSize: "", school: "", instagram: "", photoUrl: "" },
    { fullName: "", nickname: "", cpf: "", phone: "", email: "", age: "", shirtSize: "", school: "", instagram: "", photoUrl: "" },
  ]);
  const emptyManualPlayer = { fullName: "", nickname: "", cpf: "", phone: "", email: "", age: "", shirtSize: "", school: "", instagram: "", photoUrl: "" };

  const { data: registrations, isLoading, refetch } = useQuery<RegItem[]>({
    queryKey: [`/api/tournaments/${tournamentId}/registrations`],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Erro ao buscar inscrições");
      return res.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: tournamentCategories } = useQuery<{ id: number; name: string }[]>({
    queryKey: [`/api/tournaments/${tournamentId}/categories`],
    queryFn: async () => {
      const res = await fetch(`/api/tournaments/${tournamentId}/categories`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Erro ao buscar categorias");
      return res.json();
    },
    staleTime: 30000,
  });

  const manualExpectedPlayers = manualType === "individual" ? 1 : manualType === "dupla" ? 2 : 3;
  const registrationCategories = (tournamentCategories || []).map((c) => c.name);
  const updateManualPlayer = (index: number, field: keyof typeof manualPlayers[number], value: string) => {
    setManualPlayers((prev) => prev.map((player, i) => (i === index ? { ...player, [field]: value } : player)));
  };
  const formatManualCpf = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    return digits
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  };
  const formatManualPhone = (value: string) => maskPhone(value);
  const manualShirtOptions = ["PP", "P", "M", "G", "GG", "XGG"];
  const handleManualPhotoUpload = async (index: number, file: File | null) => {
    if (!file) return;
    const formData = new FormData();
    formData.append("photo", file);
    try {
      const res = await fetch("/api/tournaments/player-upload", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) {
        showToast.error("Erro ao enviar foto");
        return;
      }
      const data = await res.json();
      updateManualPlayer(index, "photoUrl", data.url ?? "");
    } catch {
      showToast.error("Erro ao enviar foto");
    }
  };

  const createManualRegistration = async () => {
    const players = manualPlayers.slice(0, manualExpectedPlayers).map((p) => ({
      fullName: p.fullName.trim(),
      nickname: p.nickname.trim() || undefined,
      cpf: p.cpf.replace(/\D/g, ""),
      phone: p.phone.trim(),
      email: p.email.trim(),
      age: Number(p.age),
      shirtSize: p.shirtSize.trim() || undefined,
      school: p.school.trim() || undefined,
      instagram: p.instagram.trim() ? p.instagram.trim().replace(/^@/, "") : undefined,
      photoUrl: p.photoUrl.trim() || undefined,
    }));
    if (!manualCategory) {
      showToast.error("Selecione uma categoria");
      return;
    }
    if (players.some((p) => !p.fullName || !p.cpf || !p.phone || !p.email || !p.age)) {
      showToast.error("Preencha os campos obrigatórios dos jogadores");
      return;
    }
    setManualLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          registrationType: manualType,
          categoryName: manualCategory,
          players,
          notes: "Inscrição manual pelo admin",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast.error(data.error ?? "Erro ao criar inscrição");
        return;
      }
      setShowManual(false);
      await refetch();
      showToast.success("Inscrição manual criada");
    } catch {
      showToast.error("Erro ao criar inscrição manual");
    } finally {
      setManualLoading(false);
    }
  };

  const resetManualForm = () => {
    setEditingRegistration(null);
    setManualType("dupla");
    setManualCategory("");
    setManualPlayers([{ ...emptyManualPlayer }, { ...emptyManualPlayer }, { ...emptyManualPlayer }]);
  };

  const openEditRegistration = (reg: RegItem) => {
    setEditingRegistration(reg);
    setManualType(reg.registrationType as "individual" | "dupla" | "trio");
    setManualCategory(reg.categoryName ?? "");
    setManualPlayers([
      ...(reg.players.map((p) => ({
        fullName: p.fullName,
        nickname: p.nickname ?? "",
        cpf: p.cpf,
        phone: p.phone ?? "",
        email: p.email,
        age: String(p.age),
        shirtSize: p.shirtSize ?? "",
        school: p.school ?? "",
        instagram: p.instagram ?? "",
        photoUrl: p.photoUrl ?? "",
      })) as typeof manualPlayers),
      ...Array.from({ length: 3 - reg.players.length }, () => ({ ...emptyManualPlayer })),
    ].slice(0, 3));
    setShowManual(true);
  };

  const saveEditedRegistration = async () => {
    if (!editingRegistration) return;
    if (!manualCategory) {
      showToast.error("Selecione uma categoria");
      return;
    }
    const players = manualPlayers.slice(0, manualExpectedPlayers).map((p) => ({
      fullName: p.fullName.trim(),
      nickname: p.nickname.trim() || undefined,
      cpf: p.cpf.replace(/\D/g, ""),
      phone: p.phone.trim(),
      email: p.email.trim(),
      age: Number(p.age),
      shirtSize: p.shirtSize.trim() || undefined,
      school: p.school.trim() || undefined,
      instagram: p.instagram.trim() ? p.instagram.trim().replace(/^@/, "") : undefined,
      photoUrl: p.photoUrl.trim() || undefined,
    }));
    if (players.some((p) => !p.fullName || !p.cpf || !p.phone || !p.email || !p.age)) {
      showToast.error("Preencha os campos obrigatórios dos jogadores");
      return;
    }
    setManualLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${editingRegistration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          registrationType: manualType,
          categoryName: manualCategory,
          players,
          notes: editingRegistration.notes ?? undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast.error(data.error ?? "Erro ao salvar inscrição");
        return;
      }
      setShowManual(false);
      resetManualForm();
      await refetch();
      showToast.success("Inscrição atualizada");
    } catch {
      showToast.error("Erro ao salvar inscrição");
    } finally {
      setManualLoading(false);
    }
  };

  const updateStatus = async (regId: number, status: "pending_payment" | "confirmed" | "cancelled" | "expired") => {
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${regId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast.error((data as { error?: string }).error ?? "Erro ao atualizar status");
        return;
      }
      await refetch();
      showToast.success(status === "confirmed" ? "Inscrição confirmada!" : status === "cancelled" ? "Inscrição cancelada" : "Status atualizado");
    } catch {
      showToast.error("Erro de conexão ao atualizar status");
    }
  };

  const deleteReg = async (regId: number) => {
    const confirmed = await showConfirm("Excluir esta inscrição? Esta ação não pode ser desfeita.");
    if (!confirmed) return;
    await fetch(`/api/tournaments/${tournamentId}/registrations/${regId}`, { method: "DELETE", headers: getAuthHeaders() });
    qc.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/registrations`] });
    showToast.success("Inscrição excluída");
  };

  const statusLabel = (s: string) => s === "confirmed" ? "✅ Confirmada" : s === "cancelled" ? "❌ Cancelada" : s === "expired" ? "⏰ Expirada" : "⏳ Pendente";
  const statusColor = (s: string) => s === "confirmed" ? "text-green-400 bg-green-500/10 border-green-500/30" : s === "cancelled" ? "text-red-400 bg-red-500/10 border-red-500/30" : s === "expired" ? "text-orange-400 bg-orange-500/10 border-orange-500/30" : "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
  const typeLabel = (t: string) => t === "individual" ? "Individual" : t === "dupla" ? "Dupla" : "Trio";
  const shirtSizes: Record<string, string> = { PP: "PP", P: "P", M: "M", G: "G", GG: "GG", XGG: "XGG" };

  const confirmed = registrations?.filter((r) => r.status === "confirmed").length || 0;
  const pending = registrations?.filter((r) => r.status === "pending_payment").length || 0;
  const expired = registrations?.filter((r) => r.status === "expired").length || 0;
  const total = registrations?.length || 0;

  // Unique categories from all registrations
  const categories = Array.from(new Set((registrations || []).map((r) => r.categoryName).filter(Boolean))) as string[];

  // Filtered registrations
  const filteredRegistrations = (registrations || []).filter((reg) => {
    const matchesCategory = !filterCategory || reg.categoryName === filterCategory;
    const searchLower = searchName.toLowerCase();
    const matchesSearch = !searchName || reg.players.some(
      (p) => p.fullName.toLowerCase().includes(searchLower) || (p.nickname && p.nickname.toLowerCase().includes(searchLower))
    );
    return matchesCategory && matchesSearch;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-display font-bold">Inscrições</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => { resetManualForm(); setShowManual(true); }} className="text-xs px-3 py-2 rounded-lg bg-primary text-black font-bold">+ Inscrição manual</button>
          <button onClick={() => refetch()} className="text-xs text-muted-foreground hover:text-white flex items-center gap-1">↻ Atualizar</button>
        </div>
      </div>

      {/* Summary */}
      {total > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-secondary/50 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold">{total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{confirmed}</div>
            <div className="text-xs text-muted-foreground">Confirmadas</div>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-yellow-400">{pending}</div>
            <div className="text-xs text-muted-foreground">Pendentes</div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-orange-400">{expired}</div>
            <div className="text-xs text-muted-foreground">Expiradas</div>
          </div>
        </div>
      )}

      {isLoading && <div className="py-8 text-center text-muted-foreground text-sm">Carregando inscrições...</div>}
      {!isLoading && total === 0 && (
        <div className="py-12 text-center text-muted-foreground text-sm border border-dashed border-white/10 rounded-xl">
          Nenhuma inscrição ainda. Elas aparecerão aqui assim que o torneio estiver com "Inscrições Abertas".
        </div>
      )}

      {showManual && (
        <div className="mb-6 border border-white/10 rounded-xl p-4 bg-black/30 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold">{editingRegistration ? "Editar inscrição" : "Nova inscrição manual"}</h4>
            <button className="text-xs text-muted-foreground hover:text-white" onClick={() => { setShowManual(false); resetManualForm(); }}>Fechar</button>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs mb-1 block">Modalidade</Label>
              <select value={manualType} onChange={(e) => setManualType(e.target.value as "individual" | "dupla" | "trio")} className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-sm">
                <option value="individual">Individual</option>
                <option value="dupla">Dupla</option>
                <option value="trio">Trio</option>
              </select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Categoria <span className="text-red-400">*</span></Label>
              <select value={manualCategory} onChange={(e) => setManualCategory(e.target.value)} className={`w-full bg-secondary border rounded-lg px-3 py-2 text-sm ${!manualCategory ? "border-red-500/60" : "border-white/10"}`}>
                <option value="">Selecione uma categoria...</option>
                {registrationCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              {!manualCategory && <p className="text-xs text-red-400 mt-1">Campo obrigatório</p>}
            </div>
          </div>
          <div className="space-y-4">
            {manualPlayers.slice(0, manualExpectedPlayers).map((player, idx) => (
              <div key={idx} className="border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm">Jogador {idx + 1}</div>
                  <div className="text-xs text-muted-foreground">{idx === 0 ? "Principal" : "Complementar"}</div>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                  <Input placeholder="Nome completo *" value={player.fullName} onChange={(e) => updateManualPlayer(idx, "fullName", e.target.value)} />
                  <Input placeholder="Apelido" value={player.nickname} onChange={(e) => updateManualPlayer(idx, "nickname", e.target.value)} />
                  <Input placeholder="CPF *" value={player.cpf} onChange={(e) => updateManualPlayer(idx, "cpf", formatManualCpf(e.target.value))} />
                  <Input placeholder="Telefone *" value={player.phone} onChange={(e) => updateManualPlayer(idx, "phone", formatManualPhone(e.target.value))} />
                  <Input placeholder="E-mail *" value={player.email} onChange={(e) => updateManualPlayer(idx, "email", e.target.value)} />
                  <Input placeholder="Idade *" type="number" value={player.age} onChange={(e) => updateManualPlayer(idx, "age", e.target.value)} />
                  <div>
                    <Label className="text-xs mb-1 block">Uniforme</Label>
                    <select value={player.shirtSize} onChange={(e) => updateManualPlayer(idx, "shirtSize", e.target.value)} className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-sm">
                      <option value="">Selecione</option>
                      {manualShirtOptions.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </div>
                  <Input placeholder="Escola/Academia" value={player.school} onChange={(e) => updateManualPlayer(idx, "school", e.target.value)} />
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-muted-foreground">@</span>
                    <Input placeholder="instagram" value={player.instagram.replace(/^@/, "")} onChange={(e) => updateManualPlayer(idx, "instagram", e.target.value.replace(/^@/, ""))} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Input placeholder="URL da foto" value={player.photoUrl} onChange={(e) => updateManualPlayer(idx, "photoUrl", e.target.value)} />
                    <Input type="file" accept="image/*" onChange={(e) => { void handleManualPhotoUpload(idx, e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowManual(false); resetManualForm(); }}>Cancelar</Button>
            <Button onClick={editingRegistration ? saveEditedRegistration : createManualRegistration} disabled={manualLoading}>{manualLoading ? "Salvando..." : editingRegistration ? "Salvar alterações" : "Criar inscrição"}</Button>
          </div>
        </div>
      )}

      {/* Search & Filter */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nome do jogador..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="w-full bg-secondary border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          {categories.length > 0 && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-secondary border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary min-w-[160px]"
            >
              <option value="">Todas as categorias</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {!isLoading && total > 0 && filteredRegistrations.length === 0 && (
        <div className="py-8 text-center text-muted-foreground text-sm border border-dashed border-white/10 rounded-xl">
          Nenhuma inscrição encontrada para os filtros aplicados.
        </div>
      )}

      <div className="space-y-3">
        {filteredRegistrations.map((reg) => (
          <div key={reg.id} className="border border-white/10 rounded-xl overflow-hidden">
            {/* Header */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => setExpanded(expanded === reg.id ? null : reg.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">
                  {reg.players.length > 0 ? reg.players.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && " e "}
                      {p.fullName}
                    </span>
                  )) : "—"}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  <span>{typeLabel(reg.registrationType)}</span>
                  {reg.categoryName && <><span>·</span><span>{reg.categoryName}</span></>}
                  <span>·</span>
                  <span>R$ {Number(reg.price).toFixed(2).replace(".", ",")}</span>
                  <span>·</span>
                  <span>{new Date(reg.createdAt).toLocaleDateString("pt-BR")}</span>
                </div>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusColor(reg.status)}`}>{statusLabel(reg.status)}</span>
              <span className="text-muted-foreground ml-1">{expanded === reg.id ? "▲" : "▼"}</span>
            </div>

            {/* Expanded details */}
            {expanded === reg.id && (
              <div className="border-t border-white/10 p-4 bg-black/20 space-y-4">
                {/* Players */}
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-bold">Jogadores</div>
                  <div className="space-y-2">
                    {reg.players.map((p, i) => (
                      <div key={p.id} className="bg-secondary/30 rounded-lg p-3 text-sm">
                        <div className="flex items-start gap-3">
                          {/* Photo */}
                          {p.photoUrl ? (
                            <div className="flex-shrink-0 flex flex-col items-center gap-1">
                              <a href={p.photoUrl} target="_blank" rel="noopener noreferrer" title="Ver foto em tamanho real">
                                <img
                                  src={p.photoUrl}
                                  alt={p.fullName}
                                  className="w-16 h-16 rounded-xl object-cover border border-white/10 hover:border-primary/50 transition-colors cursor-pointer"
                                />
                              </a>
                              <a
                                href={p.photoUrl}
                                download={`${p.fullName.replace(/\s+/g, "_")}_foto.jpg`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5 font-semibold transition-colors"
                                title="Baixar foto"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                Baixar
                              </a>
                            </div>
                          ) : (
                            <div className="flex-shrink-0 w-16 h-16 rounded-xl border border-dashed border-white/10 bg-black/20 flex items-center justify-center">
                              <User size={22} className="text-muted-foreground/40" />
                            </div>
                          )}
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="font-bold">{i + 1}. {p.fullName}{p.nickname && <span className="text-muted-foreground font-normal ml-1">({p.nickname})</span>}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                              <span>CPF: {p.cpf}</span>
                              <span>Email: {p.email}</span>
                              {p.phone && <span>Tel: {p.phone}</span>}
                              <span>Idade: {p.age} anos</span>
                              {p.shirtSize && <span>Uniforme: {shirtSizes[p.shirtSize] || p.shirtSize}</span>}
                              {p.school && <span className="col-span-2">Escola: {p.school}</span>}
                              {p.instagram && (
                                <span className="col-span-2 flex items-center gap-1 text-pink-400 font-medium">
                                  <Instagram size={11} />
                                  <a href={`https://instagram.com/${p.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                    {p.instagram.startsWith("@") ? p.instagram : `@${p.instagram}`}
                                  </a>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {reg.notes && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 font-bold">Observações</div>
                    <p className="text-sm text-muted-foreground">{reg.notes}</p>
                  </div>
                )}

                {/* QR Code */}
                {reg.pixQrCodeBase64 && (
                  <div>
                    <button onClick={() => setShowQr(showQr === reg.id ? null : reg.id)} className="text-xs text-primary hover:underline flex items-center gap-1">
                      {showQr === reg.id ? "Ocultar QR Code" : "Ver QR Code PIX"}
                    </button>
                    {showQr === reg.id && (
                      <div className="mt-2">
                        <img src={`data:image/png;base64,${reg.pixQrCodeBase64}`} alt="QR Code PIX" className="w-40 h-40 rounded-xl border border-white/10" />
                        {reg.pixCopiaECola && (
                          <div className="mt-2 text-xs font-mono text-muted-foreground bg-black/40 p-2 rounded border border-white/10 break-all">{reg.pixCopiaECola}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Expiry info */}
                {reg.expiresAt && reg.status === "pending_payment" && (
                  <div className="text-xs text-muted-foreground border border-yellow-500/20 bg-yellow-500/5 rounded-lg px-3 py-2">
                    ⏳ PIX expira em: <span className="font-mono font-bold text-yellow-400">{new Date(reg.expiresAt).toLocaleString("pt-BR")}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {reg.status !== "confirmed" && (
                    <button onClick={() => updateStatus(reg.id, "confirmed")} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors">
                      ✅ Confirmar
                    </button>
                  )}
                  {reg.status !== "pending_payment" && (
                    <button onClick={() => updateStatus(reg.id, "pending_payment")} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 transition-colors">
                      ⏳ Marcar Pendente
                    </button>
                  )}
                  {reg.status !== "cancelled" && (
                    <button onClick={() => updateStatus(reg.id, "cancelled")} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-500/20 text-slate-400 border border-slate-500/30 hover:bg-slate-500/30 transition-colors">
                      ❌ Cancelar
                    </button>
                  )}
                  {reg.status !== "expired" && (
                    <button onClick={() => updateStatus(reg.id, "expired")} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors">
                      ⏰ Marcar Expirada
                    </button>
                  )}
                  <button onClick={() => openEditRegistration(reg)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors">
                    ✏️ Editar
                  </button>
                  <button onClick={() => deleteReg(reg.id)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors ml-auto">
                    🗑 Excluir
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type SponsorPosition = "left" | "right" | "bottom";
type SponsorFormData = { name: string; logoUrl: string; websiteUrl: string; position: SponsorPosition };

function AdminSponsorSection({ tournamentId }: { tournamentId: number }) {
  const qc = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const { data: sponsors, isLoading } = useGetSponsors(tournamentId, { query: { staleTime: 0, refetchInterval: 30000, refetchOnWindowFocus: true } });
  const createSponsor = useCreateSponsor({ request: { headers: getAuthHeaders() } });
  const updateSponsor = useUpdateSponsor({ request: { headers: getAuthHeaders() } });
  const deleteSponsor = useDeleteSponsor({ request: { headers: getAuthHeaders() } });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [uploading, setUploading] = useState(false);

  const addForm = useForm<SponsorFormData>({ defaultValues: { name: "", logoUrl: "", websiteUrl: "", position: "left" } });
  const editForm = useForm<SponsorFormData>({ defaultValues: { name: "", logoUrl: "", websiteUrl: "", position: "left" } });

  const invalidate = () => qc.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/sponsors`] });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, setUrl: (url: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/sponsors/upload", { method: "POST", headers: getAuthHeaders(), body: formData });
      if (!res.ok) throw new Error("Upload falhou");
      const { url } = await res.json() as { url: string };
      setUrl(url);
    } catch {
      showToast.error("Erro ao fazer upload do logo");
    } finally {
      setUploading(false);
    }
  };

  const onSubmitAdd = (data: SponsorFormData) => {
    createSponsor.mutate(
      { id: tournamentId, data: { name: data.name, logoUrl: data.logoUrl || undefined, websiteUrl: data.websiteUrl || undefined, position: data.position } },
      { onSuccess: () => { invalidate(); setIsAddOpen(false); addForm.reset(); }, onError: () => showToast.error("Erro ao adicionar patrocinador") },
    );
  };

  const onSubmitEdit = (data: SponsorFormData) => {
    if (!editingSponsor) return;
    updateSponsor.mutate(
      { sponsorId: editingSponsor.id, data: { name: data.name, logoUrl: data.logoUrl || null, websiteUrl: data.websiteUrl || null, position: data.position } },
      { onSuccess: () => { invalidate(); setEditingSponsor(null); }, onError: () => showToast.error("Erro ao atualizar patrocinador") },
    );
  };

  const handleDelete = async (id: number, name: string) => {
    const confirmed = await showConfirm(`Remover patrocinador "${name}"?`);
    if (!confirmed) return;
    deleteSponsor.mutate({ sponsorId: id }, { onSuccess: invalidate });
  };

  const handleEditClick = (s: Sponsor) => {
    editForm.reset({ name: s.name, logoUrl: s.logoUrl ?? "", websiteUrl: s.websiteUrl ?? "", position: (s.position as SponsorPosition) ?? "left" });
    setEditingSponsor(s);
  };

  const SponsorForm = ({ form, onSubmit, isPending }: { form: ReturnType<typeof useForm<SponsorFormData>>; onSubmit: (d: SponsorFormData) => void; isPending: boolean }) => (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div><Label>Nome do Patrocinador *</Label><Input {...form.register("name", { required: true })} placeholder="ex: Empresa ABC" /></div>
      <div>
        <Label>Logo</Label>
        <div className="flex gap-2 mt-1">
          <Input {...form.register("logoUrl")} placeholder="URL do logo ou clique para enviar..." className="flex-1" />
          <label className={cn("flex items-center gap-1 px-3 py-2 text-xs border border-white/10 rounded-lg cursor-pointer hover:border-primary/40 transition-colors", uploading && "opacity-50 cursor-not-allowed")}>
            <ImageIcon size={14} />
            <span className="hidden sm:inline">Upload</span>
            <input
              type="file" accept="image/*" className="hidden" disabled={uploading}
              onChange={(e) => handleLogoUpload(e, (url) => form.setValue("logoUrl", url))}
            />
          </label>
        </div>
        {form.watch("logoUrl") && (
          <img src={form.watch("logoUrl")} alt="preview" className="mt-2 h-12 object-contain rounded border border-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
      </div>
      <div><Label>Website (opcional)</Label><Input {...form.register("websiteUrl")} placeholder="https://empresa.com" /></div>
      <div>
        <Label>Posição na Sidebar</Label>
        <select className="w-full mt-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm" {...form.register("position")}>
          <option value="left">Esquerda</option>
          <option value="right">Direita</option>
          <option value="bottom">Inferior</option>
        </select>
      </div>
      <Button type="submit" variant="gold" className="w-full mt-2" isLoading={isPending}>Salvar</Button>
    </form>
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-display font-bold">Patrocinadores do Torneio</h3>
        <Button size="sm" variant="outline" onClick={() => { addForm.reset(); setIsAddOpen(true); }}>
          <Plus size={16} className="mr-2" /> Adicionar
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Carregando...</p>}

      <div className="space-y-3">
        {(sponsors as Sponsor[] | undefined)?.map((s) => (
          <div key={s.id} className="flex items-center gap-4 p-3 bg-background rounded-lg border border-white/5">
            {s.logoUrl ? (
              <img src={s.logoUrl} alt={s.name} className="h-10 w-16 object-contain rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="h-10 w-16 bg-secondary rounded flex items-center justify-center text-muted-foreground text-xs">Sem logo</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{s.name}</div>
              <div className="text-xs text-muted-foreground">{s.position} · {s.websiteUrl ?? "sem website"}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => handleEditClick(s)} className="text-muted-foreground hover:text-white" title="Editar">
                <Edit2 size={14} />
              </button>
              <button onClick={() => handleDelete(s.id, s.name)} className="text-red-500/60 hover:text-red-400" title="Remover">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!isLoading && !sponsors?.length && (
          <p className="text-muted-foreground text-sm text-center py-8">Nenhum patrocinador adicionado.</p>
        )}
      </div>

      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Adicionar Patrocinador">
        <SponsorForm form={addForm} onSubmit={onSubmitAdd} isPending={createSponsor.isPending} />
      </Modal>

      <Modal isOpen={!!editingSponsor} onClose={() => setEditingSponsor(null)} title={`Editar: ${editingSponsor?.name ?? ""}`}>
        <SponsorForm form={editForm} onSubmit={onSubmitEdit} isPending={updateSponsor.isPending} />
      </Modal>
    </div>
  );
}

function AdminMatchRow({ match, tournamentId, categoryId, index, pairs }: AdminMatchRowProps) {
  const qc = useQueryClient();
  const { getAuthHeaders } = useAdminAuth();
  const updateResult = useUpdateMatchResult({ request: { headers: getAuthHeaders() } });
  const [isEditing, setIsEditing] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [courts, setCourts] = useState<Court[]>([]);
  const [quickScore, setQuickScore] = useState({ p1: match.pair1Sets ?? 0, p2: match.pair2Sets ?? 0 });
  const [quickSaving, setQuickSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync quickScore when match data updates from server
  useEffect(() => {
    setQuickScore({ p1: match.pair1Sets ?? 0, p2: match.pair2Sets ?? 0 });
  }, [match.pair1Sets, match.pair2Sets]);

  const saveQuickScore = (p1: number, p2: number) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setQuickSaving(true);
      try {
        await fetch(`/api/tournaments/${tournamentId}/categories/${categoryId}/matches/${match.id}/result`, {
          method: "PUT",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ pair1Sets: p1, pair2Sets: p2 }),
        });
        void qc.invalidateQueries();
      } finally {
        setQuickSaving(false);
      }
    }, 400);
  };

  const adjustScore = (side: "p1" | "p2", delta: number) => {
    setQuickScore(prev => {
      const next = { ...prev, [side]: Math.max(0, prev[side] + delta) };
      saveQuickScore(next.p1, next.p2);
      return next;
    });
  };

  const editForm = useForm({
    defaultValues: {
      pair1Id: String(match.pair1Id ?? ""),
      pair2Id: String(match.pair2Id ?? ""),
      groupName: (match as any).groupName ?? "",
      court: (match as any).court ?? "",
    }
  });

  useEffect(() => {
    if (isEditing && courts.length === 0) {
      fetch(`${import.meta.env.BASE_URL}api/courts`, { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(data => setCourts((Array.isArray(data) ? data : []).filter((c: Court) => c.active)))
        .catch(() => {});
    }
  }, [isEditing]);

  const handleEditScore = async () => {
    const result = await showMatchResult(
      match.pair1Name ?? "TBD",
      match.pair2Name ?? "TBD",
      match.pair1Sets ?? 0,
      match.pair2Sets ?? 0
    );
    if (result === null) return;
    updateResult.mutate({
      id: tournamentId,
      categoryId,
      matchId: match.id,
      data: { pair1Sets: result.pair1Sets, pair2Sets: result.pair2Sets },
    }, { onSuccess: () => qc.invalidateQueries() });
  };

  const handleSaveEdit = async (data: any) => {
    setEditLoading(true);
    try {
      const body: Record<string, unknown> = {
        pair1Id: parseInt(data.pair1Id, 10),
        pair2Id: parseInt(data.pair2Id, 10),
        court: data.court || null,
      };
      if (match.phase === "group_stage") body.groupName = data.groupName;

      const res = await fetch(`/api/tournaments/${tournamentId}/categories/${categoryId}/matches/${match.id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setIsEditing(false);
        void qc.invalidateQueries();
      } else {
        showToast.error("Erro ao editar jogo");
      }
    } catch {
      showToast.error("Erro ao editar jogo");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await showConfirm(`Deletar jogo entre ${match.pair1Name} e ${match.pair2Name}?`);
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/categories/${categoryId}/matches/${match.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        void qc.invalidateQueries();
      } else {
        showToast.error("Erro ao deletar jogo");
      }
    } catch {
      showToast.error("Erro ao deletar jogo");
    }
  };

  const phaseTranslations: Record<string, string> = {
    group: "Fase de Grupos",
    group_stage: "Fase de Grupos",
    eighthfinals: "Oitavas",
    quarterfinals: "Quartas",
    semifinals: "Semifinal",
    final: "Final",
    third_place: "Terceiro Lugar",
  };

  if (isEditing) {
    return (
      <div className="bg-background p-3 rounded-lg border border-primary/30 flex flex-col gap-3">
        <div className="flex justify-between text-xs text-primary uppercase font-bold tracking-wider">
          <span>Editando — Jogo {String((index ?? 0) + 1).padStart(2, "0")}</span>
          <button onClick={() => setIsEditing(false)} className="text-muted-foreground hover:text-white"><X size={14} /></button>
        </div>
        <form onSubmit={editForm.handleSubmit(handleSaveEdit)} className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-bold text-muted-foreground">Dupla 1</label>
            <select {...editForm.register("pair1Id")} className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-sm">
              {pairs?.map(p => <option key={p.id} value={p.id}>{p.player1Name} / {p.player2Name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">Dupla 2</label>
            <select {...editForm.register("pair2Id")} className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-sm">
              {pairs?.map(p => <option key={p.id} value={p.id}>{p.player1Name} / {p.player2Name}</option>)}
            </select>
          </div>
          {match.phase === "group_stage" && (
            <div>
              <label className="text-xs font-bold text-muted-foreground">Grupo</label>
              <input {...editForm.register("groupName")} className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-sm" />
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-muted-foreground">Quadra</label>
            <select {...editForm.register("court")} className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-sm">
              <option value="">Sem quadra</option>
              {courts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-span-2 flex gap-2 mt-1">
            <button type="submit" disabled={editLoading} className="flex-1 px-3 py-1.5 bg-primary text-black font-bold rounded text-sm hover:bg-primary/90 disabled:opacity-50">
              {editLoading ? "Salvando..." : "Salvar"}
            </button>
            <button type="button" onClick={() => setIsEditing(false)} className="flex-1 px-3 py-1.5 bg-gray-700 text-white rounded text-sm hover:bg-gray-600">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-background p-3 rounded-lg border border-white/5 flex flex-col gap-2">
      <div className="flex justify-between text-xs text-muted-foreground uppercase font-bold tracking-wider">
        <span>{phaseTranslations[match.phase] || match.phase.replace("_", " ")}</span>
        <span>Jogo {String((index ?? 0) + 1).padStart(2, "0")}</span>
      </div>
      {(match as any).court && !match.completed && (
        <div className="text-xs text-primary font-bold text-center">{(match as any).court}</div>
      )}
      <div className="flex justify-between items-center">
        <div className={cn("flex-1 flex justify-between items-center px-3 py-1 bg-black/50 rounded mr-2 border border-white/5", match.winnerId === match.pair1Id && "border-primary/30")}>
          <span className={cn("font-bold text-sm", match.winnerId === match.pair1Id && "text-primary")}>
            {match.pair1Name ?? "TBD"}
          </span>
          <span className="font-display text-xl">{match.pair1Sets ?? "-"}</span>
        </div>
        <div className="text-muted-foreground text-xs font-bold px-1">X</div>
        <div className={cn("flex-1 flex justify-between items-center px-3 py-1 bg-black/50 rounded ml-2 border border-white/5", match.winnerId === match.pair2Id && "border-primary/30")}>
          <span className="font-display text-xl">{match.pair2Sets ?? "-"}</span>
          <span className={cn("font-bold text-sm", match.winnerId === match.pair2Id && "text-primary")}>
            {match.pair2Name ?? "TBD"}
          </span>
        </div>
      </div>
      {/* Quick score panel — shown for in_progress matches */}
      {(match as any).status === "in_progress" && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-2 py-2 md:px-3 md:py-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-yellow-400">Placar rápido</span>
            {quickSaving && <span className="text-[10px] text-yellow-400/60 animate-pulse">Salvando...</span>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:flex md:items-center gap-2 md:gap-2">
            {/* Pair 1 */}
            <div className="min-w-0 flex items-center gap-1 md:gap-2 justify-end">
              <span className="text-xs font-bold text-white/70 truncate text-right leading-tight">{match.pair1Name ?? "TBD"}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => adjustScore("p1", -1)}
                  className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 font-black text-base md:text-lg text-white/60 hover:text-white transition-all active:scale-95 flex items-center justify-center leading-none shrink-0"
                >−</button>
                <span className="w-8 md:w-10 text-center text-lg md:text-2xl font-black text-yellow-300 tabular-nums">{quickScore.p1}</span>
                <button
                  onClick={() => adjustScore("p1", 1)}
                  className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 font-black text-base md:text-lg text-yellow-300 hover:text-yellow-100 transition-all active:scale-95 flex items-center justify-center leading-none shrink-0"
                >+</button>
              </div>
            </div>
            <span className="text-muted-foreground font-bold text-xs md:text-sm shrink-0 px-1">×</span>
            {/* Pair 2 */}
            <div className="min-w-0 flex items-center gap-1 md:gap-2 justify-start">
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => adjustScore("p2", -1)}
                  className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 font-black text-base md:text-lg text-white/60 hover:text-white transition-all active:scale-95 flex items-center justify-center leading-none shrink-0"
                >−</button>
                <span className="w-8 md:w-10 text-center text-lg md:text-2xl font-black text-yellow-300 tabular-nums">{quickScore.p2}</span>
                <button
                  onClick={() => adjustScore("p2", 1)}
                  className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 font-black text-base md:text-lg text-yellow-300 hover:text-yellow-100 transition-all active:scale-95 flex items-center justify-center leading-none shrink-0"
                >+</button>
              </div>
              <span className="text-xs font-bold text-white/70 truncate text-left leading-tight">{match.pair2Name ?? "TBD"}</span>
            </div>
          </div>
        </div>
      )}

      {/* Status selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-semibold">Status:</span>
        <select
          value={(match as any).status ?? "pending"}
          onChange={async (e) => {
            const newStatus = e.target.value;
            try {
              const res = await fetch(`/api/tournaments/${tournamentId}/categories/${categoryId}/matches/${match.id}`, {
                method: "PATCH",
                headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
              });
              if (res.ok) void qc.invalidateQueries();
              else showToast.error("Erro ao atualizar status");
            } catch { showToast.error("Erro ao atualizar status"); }
          }}
          className={cn(
            "text-xs font-bold px-2 py-1 rounded border bg-black/50",
            (match as any).status === "in_progress" && "border-yellow-500/60 text-yellow-400",
            (match as any).status === "completed" && "border-green-500/60 text-green-400",
            (!((match as any).status) || (match as any).status === "pending") && "border-white/10 text-muted-foreground"
          )}
        >
          <option value="pending">Pendente</option>
          <option value="in_progress">Em andamento</option>
          <option value="completed">Concluído</option>
        </select>
      </div>
      <div className="flex gap-2 self-end">
        <Button size="sm" variant="ghost" className="h-8 text-xs text-blue-400 hover:bg-blue-500/10" onClick={() => { editForm.reset({ pair1Id: String(match.pair1Id ?? ""), pair2Id: String(match.pair2Id ?? ""), groupName: (match as any).groupName ?? "", court: (match as any).court ?? "" }); setIsEditing(true); }}>
          <Edit2 size={12} className="mr-1" /> Editar
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs text-primary" onClick={handleEditScore}>
          <Play size={12} className="mr-1" /> Resultado
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs text-red-500 hover:bg-red-500/10" onClick={handleDelete}>
          <Trash2 size={12} /> Deletar
        </Button>
      </div>
    </div>
  );
}

function AdminConfiguracoes() {
  const { getAuthHeaders } = useAdminAuth();
  const { profile } = useCompanyProfile();
  const beachTennisHidden = (() => { try { return JSON.parse(profile.nav_hidden ?? "[]").includes("/beach-tennis"); } catch { return false; } })();
  const qc = useQueryClient();
  const [mpToken, setMpToken] = useState("");
  const [mpSecret, setMpSecret] = useState("");
  const [paymentProvider, setPaymentProvider] = useState("mercadopago");
  const [picpayToken, setPicpayToken] = useState("");
  const [picpayKey, setPicpayKey] = useState("");
  const [appUrl, setAppUrl] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [check, setCheck] = useState<Record<string, boolean>>({});

  // SMTP settings state
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpStatus, setSmtpStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [smtpTestStatus, setSmtpTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [smtpTestMsg, setSmtpTestMsg] = useState("");
  const [smtpConfigured, setSmtpConfigured] = useState(false);

  const [courtPrice, setCourtPrice] = useState("");
  const [price1p, setPrice1p] = useState("");
  const [price2p, setPrice2p] = useState("");
  const [price3p, setPrice3p] = useState("");
  const [price4p, setPrice4p] = useState("");
  const [priceStatus, setPriceStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});


  interface MonthlyCourtPricing {
    weekday: { morning: number; afternoon: number; night: number };
    weekend: { morning: number; afternoon: number; night: number };
  }
  const DEFAULT_MONTHLY_PRICING: MonthlyCourtPricing = {
    weekday: { morning: 80, afternoon: 80, night: 100 },
    weekend: { morning: 100, afternoon: 100, night: 120 },
  };
  const [monthlyPricing, setMonthlyPricing] = useState<MonthlyCourtPricing>(DEFAULT_MONTHLY_PRICING);
  const [monthlyPricingStatus, setMonthlyPricingStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [sundayStatus, setSundayStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [mpTokenValidation, setMpTokenValidation] = useState<{ valid: boolean; error?: string } | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      void fetch("/api/settings/check", { headers: getAuthHeaders() })
        .then((r) => r.json())
        .then((data: Record<string, boolean>) => setCheck(data))
        .catch(() => {});
      void fetch(`${import.meta.env.BASE_URL}api/settings/pix-key`, { headers: getAuthHeaders() })
        .then((r) => r.json())
        .then((data: { pix_key?: string }) => { if (data.pix_key) setPixKey(data.pix_key); })
        .catch(() => {});
      void fetch(`${import.meta.env.BASE_URL}api/settings`, { headers: getAuthHeaders() })
        .then((r) => r.json())
        .then((data: Record<string, string>) => {
          if (data.payment_provider) setPaymentProvider(data.payment_provider);
          if (data.app_url) setAppUrl(data.app_url);
        })
        .catch(() => {});
      void fetch(`${import.meta.env.BASE_URL}api/settings/prices`, { headers: getAuthHeaders() })
        .then((r) => r.json())
        .then((data: { courtPricePerHour: number; classPrices: Record<number, number> }) => {
          setCurrentPrices({
            court: data.courtPricePerHour,
            p1: data.classPrices[1] ?? 65,
            p2: data.classPrices[2] ?? 55,
            p3: data.classPrices[3] ?? 50,
            p4: data.classPrices[4] ?? 45,
          });
        })
        .catch(() => {});
      void fetch(`${import.meta.env.BASE_URL}api/settings/monthly-court-pricing`, { headers: getAuthHeaders() })
        .then((r) => r.json())
        .then((data: MonthlyCourtPricing) => {
          if (data && data.weekday && data.weekend) setMonthlyPricing(data);
        })
        .catch(() => {});
      void fetch(`${import.meta.env.BASE_URL}api/settings/smtp`, { headers: getAuthHeaders() })
        .then((r) => r.json())
        .then((data: Record<string, string>) => {
          if (data.smtp_host) { setSmtpHost(data.smtp_host); setSmtpConfigured(true); }
          if (data.smtp_port) setSmtpPort(data.smtp_port);
          if (data.smtp_user) setSmtpUser(data.smtp_user);
          if (data.smtp_from_name) setSmtpFromName(data.smtp_from_name);
          if (data.smtp_from_email) setSmtpFromEmail(data.smtp_from_email);
        })
        .catch(() => {});
    };

    // Load settings on mount
    loadSettings();
  }, []);

  const handleSave = async () => {
    setStatus("saving");
    setMpTokenValidation(null);
    const body: Record<string, string> = {};
    if (paymentProvider.trim()) body["payment_provider"] = paymentProvider.trim();
    if (mpToken.trim()) body["mp_access_token"] = mpToken.trim();
    if (mpSecret.trim()) body["mp_webhook_secret"] = mpSecret.trim();
    if (picpayToken.trim()) body["picpay_token"] = picpayToken.trim();
    if (picpayKey.trim()) body["picpay_key"] = picpayKey.trim();
    if (appUrl.trim()) body["app_url"] = appUrl.trim();
    if (pixKey.trim()) body["pix_key"] = pixKey.trim();

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("saved");
      setMpToken("");
      setMpSecret("");
      // Wait a moment then reload check
      setTimeout(async () => {
        const checkRes = await fetch("/api/settings/check", { headers: getAuthHeaders() });
        const data = await checkRes.json() as Record<string, boolean>;
        setCheck(data);
      }, 500);
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const handleVerifySettings = async () => {
    try {
      const checkRes = await fetch(`${import.meta.env.BASE_URL}api/settings/check`, { headers: getAuthHeaders() });
      const data = await checkRes.json() as Record<string, boolean>;
      setCheck(data);

      const endpoint = paymentProvider === "picpay"
        ? `${import.meta.env.BASE_URL}api/settings/verify-picpay`
        : `${import.meta.env.BASE_URL}api/settings/verify-mp`;

      const verifyRes = await fetch(endpoint, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const validation = await verifyRes.json() as { valid: boolean; error?: string };
      setMpTokenValidation(validation);
    } catch (err) {
      console.error("Erro ao verificar configurações:", err);
    }
  };

  const handleSaveSmtp = async () => {
    setSmtpStatus("saving");
    const body: Record<string, string> = {};
    if (smtpHost.trim()) body["smtp_host"] = smtpHost.trim();
    if (smtpPort.trim()) body["smtp_port"] = smtpPort.trim();
    if (smtpUser.trim()) body["smtp_user"] = smtpUser.trim();
    if (smtpPass.trim()) body["smtp_pass"] = smtpPass.trim();
    if (smtpFromName.trim()) body["smtp_from_name"] = smtpFromName.trim();
    if (smtpFromEmail.trim()) body["smtp_from_email"] = smtpFromEmail.trim();
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/settings`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed");
      setSmtpStatus("saved");
      setSmtpPass("");
      setSmtpConfigured(true);
      setTimeout(() => setSmtpStatus("idle"), 3000);
    } catch {
      setSmtpStatus("error");
      setTimeout(() => setSmtpStatus("idle"), 3000);
    }
  };

  const handleTestSmtp = async () => {
    setSmtpTestStatus("testing");
    setSmtpTestMsg("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/settings/smtp/test`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        setSmtpTestStatus("ok");
        setSmtpTestMsg("Conexão bem-sucedida!");
      } else {
        setSmtpTestStatus("error");
        setSmtpTestMsg(data.error ?? "Erro ao conectar");
      }
    } catch {
      setSmtpTestStatus("error");
      setSmtpTestMsg("Erro de rede ao testar SMTP");
    }
    setTimeout(() => { setSmtpTestStatus("idle"); setSmtpTestMsg(""); }, 6000);
  };

  const handleSavePrices = async () => {
    setPriceStatus("saving");
    const body: Record<string, string> = {};
    if (price1p.trim()) body["class_price_1p"] = String(parseInt(price1p.trim() || "0", 10) / 100);
    if (price2p.trim()) body["class_price_2p"] = String(parseInt(price2p.trim() || "0", 10) / 100);
    if (price3p.trim()) body["class_price_3p"] = String(parseInt(price3p.trim() || "0", 10) / 100);
    if (price4p.trim()) body["class_price_4p"] = String(parseInt(price4p.trim() || "0", 10) / 100);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("failed");
      setPriceStatus("saved");
      setCourtPrice(""); setPrice1p(""); setPrice2p(""); setPrice3p(""); setPrice4p("");
      const pricesRes = await fetch(`${import.meta.env.BASE_URL}api/settings/prices`, { headers: getAuthHeaders() });
      const data = await pricesRes.json() as { courtPricePerHour: number; classPrices: Record<number, number> };
      setCurrentPrices({ court: data.courtPricePerHour, p1: data.classPrices[1] ?? 65, p2: data.classPrices[2] ?? 55, p3: data.classPrices[3] ?? 50, p4: data.classPrices[4] ?? 45 });
      void qc.invalidateQueries({ queryKey: ["prices"] });
      setTimeout(() => setPriceStatus("idle"), 3000);
    } catch {
      setPriceStatus("error");
      setTimeout(() => setPriceStatus("idle"), 3000);
    }
  };


  const handleSaveMonthlyPricing = async () => {
    setMonthlyPricingStatus("saving");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/settings/monthly-court-pricing`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(monthlyPricing),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try {
        const data = await res.json();
        if (!data.success) throw new Error("Response not successful");
      } catch {
        // If response is not JSON, that's OK - treat as success if status was OK
      }
      setMonthlyPricingStatus("saved");
      setTimeout(() => setMonthlyPricingStatus("idle"), 3000);
    } catch (err) {
      console.error("Erro ao salvar preços mensalistas:", err);
      setMonthlyPricingStatus("error");
      setTimeout(() => setMonthlyPricingStatus("idle"), 3000);
    }
  };


  return (
    <div className="w-full space-y-6 md:space-y-8">

      {/* Beach Tennis Pricing — só exibe quando beach tennis está ativo no menu */}
      {!beachTennisHidden && (
        <Card className="p-4 md:p-8 border-white/5">
            <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-8 flex-col sm:flex-row sm:items-start">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Save size={20} className="text-primary" />
            </div>
            <div className="text-center sm:text-left">
              <h2 className="text-lg md:text-2xl font-display font-bold">Preços Aulas Beach</h2>
              <p className="text-muted-foreground text-xs md:text-sm">Valor por pessoa</p>
            </div>
          </div>

          <div className="space-y-4 md:space-y-6">
            <div>
              <Label className="mb-2 md:mb-3 block font-semibold text-xs md:text-sm">Beach Tennis — Por Pessoa</Label>
              <div className="grid grid-cols-2 md:grid-cols-2 gap-2 md:gap-3">
                {([
                  { key: "p1", label: "1P", val: price1p, set: setPrice1p },
                  { key: "p2", label: "2P", val: price2p, set: setPrice2p },
                  { key: "p3", label: "3P", val: price3p, set: setPrice3p },
                  { key: "p4", label: "4P", val: price4p, set: setPrice4p },
                ] as const).map(({ key, label, val, set }) => (
                  <div key={key}>
                    <Label className="text-[10px] md:text-xs text-muted-foreground mb-1 block">{label}</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder={`${currentPrices[key] !== undefined ? (currentPrices[key] as number).toFixed(0) : "-"}`}
                      value={val ? maskCurrency(val) : formatPrice(currentPrices[key] ?? "")}
                      onChange={(e) => set(unmaskCurrency(e.target.value))}
                      className="text-xs md:text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 md:pt-4 border-t border-white/10">
              <Button
                variant="gold"
                className="w-full gap-2 text-xs md:text-sm"
                onClick={() => void handleSavePrices()}
                disabled={priceStatus === "saving" || (!price1p && !price2p && !price3p && !price4p)}
                isLoading={priceStatus === "saving"}
              >
                <Save size={16} />
                {priceStatus === "saved" ? "Salvo!" : priceStatus === "error" ? "Erro" : "Atualizar"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Monthly Pricing Configuration */}
      <Card className="p-4 md:p-8 border-white/5">
        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6 flex-col sm:flex-row sm:items-start">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <DollarSign size={20} className="text-primary" />
          </div>
          <div className="text-center sm:text-left">
            <h2 className="text-lg md:text-2xl font-display font-bold">Preço Mensal por Turno</h2>
            <p className="text-muted-foreground text-xs md:text-sm">Valor por sessão (4 sessões x este preço)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-3 md:mb-6">
          {/* Weekday */}
          <div>
            <p className="text-[10px] md:text-xs font-semibold text-muted-foreground uppercase tracking-wider pb-2 md:pb-3 border-b border-white/10 mb-2 md:mb-3">Dias Úteis</p>
            <div className="space-y-2">
              {(["morning", "afternoon", "night"] as const).map((period) => (
                <div key={`wk-${period}`} className="flex items-center gap-2 md:gap-3 bg-white/2 p-2 md:p-3 rounded-lg flex-col md:flex-row md:items-center">
                  <label className="text-[10px] md:text-xs font-semibold md:w-14">{period === "morning" ? "Manhã" : period === "afternoon" ? "Tarde" : "Noite"}</label>
                  <span className="text-[10px] md:text-sm text-muted-foreground">R$</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={monthlyPricing.weekday[period]}
                    onChange={(e) => setMonthlyPricing((prev) => ({ ...prev, weekday: { ...prev.weekday, [period]: Number(e.target.value) } }))}
                    className="w-20 md:w-32 text-right h-7 md:h-8 text-xs md:text-sm"
                  />
                  <span className="text-[10px] md:text-xs text-muted-foreground">/sess</span>
                </div>
              ))}
            </div>
          </div>
          {/* Weekend */}
          <div>
            <p className="text-[10px] md:text-xs font-semibold text-muted-foreground uppercase tracking-wider pb-2 md:pb-3 border-b border-white/10 mb-2 md:mb-3">Fins de Semana</p>
            <div className="space-y-2">
              {(["morning", "afternoon", "night"] as const).map((period) => (
                <div key={`we-${period}`} className="flex items-center gap-2 md:gap-3 bg-white/2 p-2 md:p-3 rounded-lg flex-col md:flex-row md:items-center">
                  <label className="text-[10px] md:text-xs font-semibold md:w-14">{period === "morning" ? "Manhã" : period === "afternoon" ? "Tarde" : "Noite"}</label>
                  <span className="text-[10px] md:text-sm text-muted-foreground">R$</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={monthlyPricing.weekend[period]}
                    onChange={(e) => setMonthlyPricing((prev) => ({ ...prev, weekend: { ...prev.weekend, [period]: Number(e.target.value) } }))}
                    className="w-20 md:w-32 text-right h-7 md:h-8 text-xs md:text-sm"
                  />
                  <span className="text-[10px] md:text-xs text-muted-foreground">/sess</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-3 md:pt-4 border-t border-white/10">
          <Button
            variant="gold"
            className="w-full gap-2 text-xs md:text-sm"
            onClick={() => void handleSaveMonthlyPricing()}
            disabled={monthlyPricingStatus === "saving"}
            isLoading={monthlyPricingStatus === "saving"}
          >
            <Save size={16} />
            {monthlyPricingStatus === "saved" ? "Salvo!" : monthlyPricingStatus === "error" ? "Erro" : "Salvar"}
          </Button>
        </div>
      </Card>

      {/* Full Width Court Management */}
      <GerenciarQuadras />

      {/* Full Width Payment Integration */}
      <Card className="p-4 md:p-8 border-white/5">
        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-8 flex-col sm:flex-row sm:items-start">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Key size={20} className="text-primary" />
          </div>
          <div className="text-center sm:text-left">
            <h2 className="text-lg md:text-2xl font-display font-bold">Integração de Pagamentos</h2>
            <p className="text-muted-foreground text-xs md:text-sm">Configure o provedor padrão, chaves PIX e webhook</p>
          </div>
        </div>

        <div className="space-y-3 md:space-y-6">
        <div>
          <Label className="mb-2 block text-xs md:text-sm">Provedor padrão</Label>
          <select value={paymentProvider} onChange={(e) => { setPaymentProvider(e.target.value); setMpTokenValidation(null); }} className="w-full rounded-md border bg-background px-3 py-2 text-xs md:text-sm">
            <option value="mercadopago">Mercado Pago</option>
            <option value="picpay">PicPay</option>
          </select>
        </div>
        {paymentProvider === "mercadopago" ? (
          <>
        <div>
          <Label className="flex items-center gap-2 mb-2 flex-col sm:flex-row sm:items-center text-xs md:text-sm">
            <span>Access Token (Produção)</span>
            {mpTokenValidation && (mpTokenValidation.valid ? (
              <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">✓ Válido</span>
            ) : (
              <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">✕ Inválido</span>
            ))}
          </Label>
          <Input
            type="password"
            placeholder={check["mp_access_token"] ? "Deixe em branco..." : "APP_USR-xxxx..."}
            value={mpToken}
            onChange={(e) => setMpToken(e.target.value)}
            className="text-xs md:text-sm"
          />
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
            Encontre em: <span className="text-primary">mercadopago.com.br</span>
          </p>
          {mpTokenValidation && !mpTokenValidation.valid && (
            <p className="text-[10px] md:text-xs text-red-400 mt-2">
              ✕ {mpTokenValidation.error || "Token inválido"}
            </p>
          )}
        </div>

        <div>
          <Label className="flex items-center gap-2 mb-2 flex-col sm:flex-row sm:items-center text-xs md:text-sm">
            <span>Webhook Secret</span>
          </Label>
          <Input
            type="password"
            placeholder={check["mp_webhook_secret"] ? "Deixe em branco..." : "Secret"}
            value={mpSecret}
            onChange={(e) => setMpSecret(e.target.value)}
            className="text-xs md:text-sm"
          />
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
            Para validar pagamentos
          </p>
        </div>
          </>
        ) : (
          <>
        <div>
          <Label className="flex items-center gap-2 mb-2 flex-col sm:flex-row sm:items-center text-xs md:text-sm">
            <span>API Token PicPay</span>
            {mpTokenValidation && (mpTokenValidation.valid ? (
              <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">✓ Válido</span>
            ) : (
              <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">✕ Inválido</span>
            ))}
          </Label>
          <Input
            type="password"
            placeholder={check["picpay_token"] ? "Deixe em branco para manter..." : "Token de produção PicPay"}
            value={picpayToken}
            onChange={(e) => setPicpayToken(e.target.value)}
            className="text-xs md:text-sm"
          />
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
            Token gerado na conta do PicPay (x-picpay-token)
          </p>
          {mpTokenValidation && !mpTokenValidation.valid && (
            <p className="text-[10px] md:text-xs text-red-400 mt-2">
              ✕ {mpTokenValidation.error || "Token inválido"}
            </p>
          )}
        </div>
        <div>
          <Label className="flex items-center gap-2 mb-2 flex-col sm:flex-row sm:items-center text-xs md:text-sm">
            <span>Token Segurança Webhook PicPay</span>
          </Label>
          <Input
            type="password"
            placeholder={check["picpay_key"] ? "Deixe em branco para manter..." : "Token de verificação do webhook"}
            value={picpayKey}
            onChange={(e) => setPicpayKey(e.target.value)}
            className="text-xs md:text-sm"
          />
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
            Adicionado à URL do webhook para validar notificações do PicPay
          </p>
        </div>
          </>
        )}
        <div>
          <Label className="flex items-center gap-2 mb-2 flex-col sm:flex-row sm:items-center text-xs md:text-sm">
            <span>URL do Site</span>
          </Label>
          <Input
            type="url"
            placeholder={check["app_url"] ? "Deixe em branco..." : "https://..."}
            value={appUrl}
            onChange={(e) => setAppUrl(e.target.value)}
            className="text-xs md:text-sm"
          />
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
            URL base para webhooks
          </p>
        </div>

        <div>
          <Label className="flex items-center gap-2 mb-2 text-xs md:text-sm">
            <span>Chave PIX</span>
          </Label>
          <Input
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder="Ex: 11999999999 ou email@pix.com"
            className="text-xs md:text-sm"
          />
          <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
            Incluída automaticamente nas mensagens de cobrança via WhatsApp
          </p>
        </div>

        <div className="pt-3 md:pt-4 border-t border-white/10 flex flex-col md:flex-row gap-2 md:gap-3">
          <Button
            variant="gold"
            className="flex-1 gap-2 text-xs md:text-sm"
            onClick={() => void handleSave()}
            disabled={status === "saving"}
            isLoading={status === "saving"}
          >
            <Save size={16} />
            <span className="hidden md:inline">{status === "saved" ? "Salvas!" : status === "error" ? "Erro" : "Salvar"}</span>
            <span className="md:hidden">{status === "saved" ? "Salvas!" : status === "error" ? "Erro" : "Guardar"}</span>
          </Button>
          <Button
            variant="outline"
            className="gap-2 text-xs md:text-sm"
            onClick={() => void handleVerifySettings()}
          >
            🔍 <span className="hidden md:inline">Verificar</span><span className="md:hidden">Ver</span>
          </Button>
        </div>
      </div>
      </Card>
      {/* SMTP / Email Settings */}
      <Card className="p-4 md:p-8 border-white/5">
        <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-8 flex-col sm:flex-row sm:items-start">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Bell size={20} className="text-primary" />
          </div>
          <div className="text-center sm:text-left">
            <h2 className="text-lg md:text-2xl font-display font-bold">Configurações de E-mail (SMTP)</h2>
            <p className="text-muted-foreground text-xs md:text-sm">Configure o servidor de e-mail para envio de confirmações e lembretes automáticos</p>
          </div>
        </div>

        <div className="space-y-3 md:space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="flex items-center gap-2 mb-2 text-xs md:text-sm">
                <span>Servidor SMTP (Host)</span>
                {smtpConfigured && (
                  <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Configurado</span>
                )}
              </Label>
              <Input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
                className="text-xs md:text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Ex: smtp.gmail.com, smtp.sendgrid.net</p>
            </div>
            <div>
              <Label className="mb-2 block text-xs md:text-sm">Porta SMTP</Label>
              <Input
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                type="number"
                className="text-xs md:text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">587 (TLS) ou 465 (SSL)</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="mb-2 block text-xs md:text-sm">Usuário (Login)</Label>
              <Input
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="seu@email.com"
                className="text-xs md:text-sm"
              />
            </div>
            <div>
              <Label className="mb-2 block text-xs md:text-sm">Senha / App Password</Label>
              <Input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={smtpConfigured ? "Deixe em branco para manter..." : "Senha do servidor SMTP"}
                className="text-xs md:text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Para Gmail, use uma App Password</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="mb-2 block text-xs md:text-sm">Nome do Remetente</Label>
              <Input
                value={smtpFromName}
                onChange={(e) => setSmtpFromName(e.target.value)}
                placeholder="Nome da Empresa"
                className="text-xs md:text-sm"
              />
            </div>
            <div>
              <Label className="mb-2 block text-xs md:text-sm">E-mail do Remetente</Label>
              <Input
                type="email"
                value={smtpFromEmail}
                onChange={(e) => setSmtpFromEmail(e.target.value)}
                placeholder="noreply@empresa.com.br"
                className="text-xs md:text-sm"
              />
            </div>
          </div>

          {smtpTestMsg && (
            <div className={`text-xs px-3 py-2 rounded-md border ${smtpTestStatus === "ok" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
              {smtpTestStatus === "ok" ? "✅ " : "❌ "}{smtpTestMsg}
            </div>
          )}

          <div className="pt-3 md:pt-4 border-t border-white/10 flex flex-col md:flex-row gap-2 md:gap-3">
            <Button
              variant="gold"
              className="flex-1 gap-2 text-xs md:text-sm"
              onClick={() => void handleSaveSmtp()}
              disabled={smtpStatus === "saving"}
              isLoading={smtpStatus === "saving"}
            >
              <Save size={16} />
              {smtpStatus === "saved" ? "Salvo!" : smtpStatus === "error" ? "Erro" : "Salvar SMTP"}
            </Button>
            <Button
              variant="outline"
              className="gap-2 text-xs md:text-sm"
              onClick={() => void handleTestSmtp()}
              disabled={smtpTestStatus === "testing" || !smtpConfigured}
              isLoading={smtpTestStatus === "testing"}
            >
              📧 {smtpTestStatus === "testing" ? "Testando..." : "Testar Conexão"}
            </Button>
          </div>

          <div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-blue-400">📬 E-mails automáticos enviados:</p>
            <p>• <strong>Confirmação</strong> — ao criar reserva de quadra ou aula</p>
            <p>• <strong>Boas-vindas ao plano</strong> — ao ativar plano mensalista</p>
            <p>• <strong>Lembrete</strong> — 1 dia antes de cada reserva (8h Brasília)</p>
          </div>
        </div>
      </Card>

      <AdminCupons />
    </div>
  );
}

interface CouponRecord {
  id: number;
  code: string;
  type: "percentage" | "fixed";
  value: string;
  scope: "booking" | "tournament";
  tournamentId: number | null;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  expiresAt: string | null;
}

function AdminCupons() {
  const { getAuthHeaders } = useAdminAuth();
  const { data: tournaments } = useGetTournaments();
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newType, setNewType] = useState<"percentage" | "fixed">("percentage");
  const [newValue, setNewValue] = useState("");
  const [newMaxUses, setNewMaxUses] = useState("");
  const [newScope, setNewScope] = useState<"booking" | "tournament">("booking");
  const [newTournamentId, setNewTournamentId] = useState("");
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCoupons = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/coupons`, { headers: getAuthHeaders() });
      const data = await res.json() as CouponRecord[];
      setCoupons(Array.isArray(data) ? data : []);
    } catch { setCoupons([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { void fetchCoupons(); }, []);

  const handleCreate = async () => {
    if (!newCode.trim() || !newValue) return showToast.error("Preencha código e valor");
    if (newScope === "tournament" && !newTournamentId) return showToast.error("Selecione o torneio");
    setSaving(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/coupons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          code: newCode.trim().toUpperCase(),
          type: newType,
          value: Number(newValue),
          maxUses: newMaxUses ? Number(newMaxUses) : null,
          active: true,
          scope: newScope,
          tournamentId: newScope === "tournament" ? Number(newTournamentId) : undefined,
          expiresAt: newExpiresAt || undefined,
        }),
      });
      if (!res.ok) {
        let errorMsg = "Erro ao criar cupom";
        try {
          const err = await res.json() as { error?: string };
          errorMsg = err.error ?? `Erro: ${res.status}`;
        } catch {
          errorMsg = `Erro HTTP ${res.status}`;
        }
        showToast.error(errorMsg);
        return;
      }
      showToast.success("Cupom criado!");
      setNewCode(""); setNewValue(""); setNewMaxUses(""); setNewExpiresAt(""); setNewTournamentId(""); setCreating(false);
      void fetchCoupons();
    } finally { setSaving(false); }
  };

  const handleToggle = async (coupon: CouponRecord) => {
    await fetch(`${import.meta.env.BASE_URL}api/coupons/${coupon.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ active: !coupon.active }),
    });
    void fetchCoupons();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Deletar cupom?")) return;
    await fetch(`${import.meta.env.BASE_URL}api/coupons/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    void fetchCoupons();
  };

  const formatDiscount = (c: CouponRecord) =>
    c.type === "percentage" ? `${Number(c.value)}%` : formatCurrency(Number(c.value));

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base md:text-lg font-bold flex items-center gap-2">
          <DollarSign size={18} className="text-primary" /> Cupons de Desconto
        </h3>
        <button
          onClick={() => setCreating(!creating)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors text-xs font-medium"
        >
          <Plus size={14} /> Novo Cupom
        </button>
      </div>

      {creating && (
        <div className="p-4 rounded-xl bg-secondary border border-white/10 space-y-3">
          <p className="text-sm font-medium">Criar novo cupom</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Código</Label>
              <Input
                placeholder="EX: PROMO10"
                value={newCode}
                onChange={e => setNewCode(e.target.value.toUpperCase())}
                className="text-xs uppercase font-mono tracking-widest"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Desconto</Label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as "percentage" | "fixed")}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="percentage">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{newType === "percentage" ? "Desconto (%)" : "Valor (R$)"}</Label>
              <Input
                type="number"
                placeholder={newType === "percentage" ? "Ex: 10" : "Ex: 50"}
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                className="text-xs"
                min={1}
                max={newType === "percentage" ? 100 : undefined}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Usos máximos <span className="text-muted-foreground">(vazio = ilimitado)</span></Label>
              <Input
                type="number"
                placeholder="Ilimitado"
                value={newMaxUses}
                onChange={e => setNewMaxUses(e.target.value)}
                className="text-xs"
                min={1}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Destino do Cupom</Label>
              <select
                value={newScope}
                onChange={e => { setNewScope(e.target.value as "booking" | "tournament"); setNewTournamentId(""); }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="booking">Agendamentos (reservas de quadra / aulas)</option>
                <option value="tournament">Torneio específico</option>
              </select>
            </div>
            {newScope === "tournament" && (
              <div className="space-y-1">
                <Label className="text-xs">Torneio *</Label>
                <select
                  value={newTournamentId}
                  onChange={e => setNewTournamentId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  <option value="">Selecione o torneio...</option>
                  {(tournaments || []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className={cn("space-y-1", newScope !== "tournament" && "col-span-1")}>
              <Label className="text-xs">Válido até <span className="text-muted-foreground">(opcional)</span></Label>
              <Input
                type="datetime-local"
                value={newExpiresAt}
                onChange={e => setNewExpiresAt(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="gold" size="sm" onClick={() => void handleCreate()} isLoading={saving} disabled={saving}>
              <Save size={14} /> Salvar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : coupons.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum cupom cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map(c => {
            const tournamentName = c.scope === "tournament" && c.tournamentId
              ? (tournaments || []).find(t => t.id === c.tournamentId)?.name ?? `Torneio #${c.tournamentId}`
              : null;
            return (
            <div key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary border border-white/10">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={cn("text-xs font-mono font-bold px-2 py-0.5 rounded", c.active ? "bg-green-500/20 text-green-400" : "bg-muted/20 text-muted-foreground line-through")}>
                    {c.code}
                  </span>
                  <span className="text-sm font-bold text-primary">{formatDiscount(c)}</span>
                  <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", c.scope === "tournament" ? "bg-yellow-500/20 text-yellow-400" : "bg-blue-500/20 text-blue-400")}>
                    {c.scope === "tournament" ? (tournamentName ? `🏆 ${tournamentName}` : "🏆 Torneio") : "📅 Agendamentos"}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                  <span>{c.type === "percentage" ? "desconto" : "fixo"} · {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""} usos</span>
                  {c.expiresAt && <span>válido até {new Date(c.expiresAt).toLocaleDateString("pt-BR")}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => void handleToggle(c)}
                  className={cn("px-2 py-1 text-xs rounded transition-colors", c.active ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30" : "bg-green-500/20 text-green-400 hover:bg-green-500/30")}
                >
                  {c.active ? "Desativar" : "Ativar"}
                </button>
                <button
                  onClick={() => void handleDelete(c.id)}
                  className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </Card>
  );
}

interface CourtRecord {
  id: number;
  name: string;
  number: number;
  description: string | null;
  photoUrl: string | null;
  active: boolean;
}

function GerenciarQuadras() {
  const { getAuthHeaders } = useAdminAuth();
  const [courts, setCourts] = useState<CourtRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<CourtRecord | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [photoUploadId, setPhotoUploadId] = useState<number | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [expandedCourtId, setExpandedCourtId] = useState<number | null>(null);

  const [formName, setFormName] = useState("");
  const [formNumber, setFormNumber] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Schedule editor state
  interface DaySchedule {
    dayOfWeek: number;
    openHour: number; openMinute: number;             // manhã start (= abertura geral)
    afternoonStartHour: number; afternoonStartMinute: number; // tarde start (= manhã end)
    eveningStartHour: number; eveningStartMinute: number;   // noite start (= tarde end)
    closeHour: number; closeMinute: number;           // noite end (= fechamento geral)
    isOpen: boolean;
    morningPrice: number; afternoonPrice: number; eveningPrice: number;
  }
  const DAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const defaultSchedule = (): DaySchedule[] => [0,1,2,3,4,5,6].map(d => ({
    dayOfWeek: d,
    openHour: 8, openMinute: 0,
    afternoonStartHour: 12, afternoonStartMinute: 0,
    eveningStartHour: 17, eveningStartMinute: 0,
    closeHour: 22, closeMinute: 0,
    isOpen: d !== 0,
    morningPrice: 60, afternoonPrice: 70, eveningPrice: 80,
  }));
  const timeOptions: string[] = [];
  for (let h = 5; h <= 23; h++) { timeOptions.push(`${String(h).padStart(2,"0")}:00`); timeOptions.push(`${String(h).padStart(2,"0")}:30`); }
  timeOptions.push("00:00");

  const [scheduleCourtId, setScheduleCourtId] = useState<number | null>(null);
  const [scheduleData, setScheduleData] = useState<DaySchedule[]>(defaultSchedule());
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const openScheduleEditor = async (court: CourtRecord) => {
    if (scheduleCourtId === court.id) { setScheduleCourtId(null); return; }
    setScheduleCourtId(court.id);
    setScheduleLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/courts/${court.id}/schedule`, { headers: getAuthHeaders() });
      const rows = await res.json() as Array<Record<string, unknown>>;
      const toDay = (r: Record<string, unknown>): DaySchedule => ({
        dayOfWeek: Number(r.dayOfWeek),
        openHour: Number(r.openHour ?? 8), openMinute: Number(r.openMinute ?? 0),
        afternoonStartHour: Number(r.afternoonStartHour ?? 12), afternoonStartMinute: Number(r.afternoonStartMinute ?? 0),
        eveningStartHour: Number(r.eveningStartHour ?? 17), eveningStartMinute: Number(r.eveningStartMinute ?? 0),
        closeHour: Number(r.closeHour ?? 22), closeMinute: Number(r.closeMinute ?? 0),
        isOpen: r.isOpen !== false && r.isOpen !== "false",
        morningPrice: Number(r.morningPrice ?? 60), afternoonPrice: Number(r.afternoonPrice ?? 70), eveningPrice: Number(r.eveningPrice ?? 80),
      });
      if (Array.isArray(rows) && rows.length === 7) {
        setScheduleData(rows.map(toDay));
      } else if (Array.isArray(rows) && rows.length > 0) {
        const base = defaultSchedule();
        for (const r of rows) { const idx = base.findIndex(b => b.dayOfWeek === Number(r.dayOfWeek)); if (idx !== -1) base[idx] = toDay(r); }
        setScheduleData(base);
      } else {
        setScheduleData(defaultSchedule());
      }
    } catch { setScheduleData(defaultSchedule()); }
    finally { setScheduleLoading(false); }
  };

  const updateDay = (dayOfWeek: number, field: keyof DaySchedule, value: unknown) => {
    setScheduleData(prev => prev.map(d => d.dayOfWeek === dayOfWeek ? { ...d, [field]: value } : d));
  };

  const setTimeFromStr = (dayOfWeek: number, field: "open" | "afternoonStart" | "eveningStart" | "close", val: string) => {
    const [h, m] = val.split(":").map(Number);
    if (field === "open") { updateDay(dayOfWeek, "openHour", h); updateDay(dayOfWeek, "openMinute", m); }
    else if (field === "afternoonStart") { updateDay(dayOfWeek, "afternoonStartHour", h); updateDay(dayOfWeek, "afternoonStartMinute", m); }
    else if (field === "eveningStart") { updateDay(dayOfWeek, "eveningStartHour", h); updateDay(dayOfWeek, "eveningStartMinute", m); }
    else { updateDay(dayOfWeek, "closeHour", h); updateDay(dayOfWeek, "closeMinute", m); }
  };

  const saveSchedule = async (courtId: number) => {
    setScheduleSaving(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/courts/${courtId}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ schedule: scheduleData }),
      });
      if (res.ok) { showToast.success("Horários salvos!"); setScheduleCourtId(null); }
      else { showToast.error("Erro ao salvar horários"); }
    } catch { showToast.error("Erro ao salvar horários"); }
    finally { setScheduleSaving(false); }
  };

  const saveScheduleAllCourts = async () => {
    if (!window.confirm("Isso vai aplicar este horário a TODAS as quadras. Confirmar?")) return;
    setScheduleSaving(true);
    try {
      const results = await Promise.all(
        courts.map(c =>
          fetch(`${import.meta.env.BASE_URL}api/courts/${c.id}/schedule`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ schedule: scheduleData }),
          })
        )
      );
      const allOk = results.every(r => r.ok);
      if (allOk) { showToast.success(`Horários aplicados a todas as ${courts.length} quadras!`); setScheduleCourtId(null); }
      else { showToast.error("Erro ao salvar em algumas quadras"); }
    } catch { showToast.error("Erro ao salvar horários"); }
    finally { setScheduleSaving(false); }
  };

  const fetchCourts = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/courts`, { headers: getAuthHeaders() });
      const data = await res.json() as CourtRecord[];
      setCourts(Array.isArray(data) ? data : []);
    } catch {
      setCourts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchCourts(); }, []);

  const openCreate = () => {
    setFormName(""); setFormNumber(""); setFormDesc(""); setFormActive(true);
    setEditTarget(null); setIsCreating(true);
  };

  const openEdit = (c: CourtRecord) => {
    setFormName(c.name);
    setFormNumber(String(c.number));
    setFormDesc(c.description ?? "");
    setFormActive(c.active);
    setEditTarget(c);
    setIsCreating(false);
  };

  const closeModal = () => { setEditTarget(null); setIsCreating(false); };

  const handleSave = async () => {
    if (!formName.trim() || !formNumber) {
      showToast.error("Nome e número são obrigatórios");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: formName.trim(),
        number: Number(formNumber),
        description: formDesc.trim() || null,
        active: formActive,
      };

      if (editTarget) {
        const res = await fetch(`${import.meta.env.BASE_URL}api/courts/${editTarget.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        showToast.success("Quadra atualizada!");
      } else {
        const res = await fetch(`${import.meta.env.BASE_URL}api/courts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        showToast.success("Quadra criada!");
      }

      await fetchCourts();
      closeModal();
    } catch {
      showToast.error("Erro ao salvar quadra");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    const confirmed = await showConfirm(`Excluir a quadra "${name}"? Esta ação não pode ser desfeita.`);
    if (!confirmed) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/courts/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error();
      showToast.success("Quadra excluída!");
      await fetchCourts();
    } catch {
      showToast.error("Erro ao excluir quadra");
    }
  };

  const handleToggleActive = async (court: CourtRecord) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/courts/${court.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ active: !court.active }),
      });
      if (!res.ok) throw new Error();
      await fetchCourts();
    } catch {
      showToast.error("Erro ao atualizar status");
    }
  };

  const handlePhotoUpload = async (courtId: number, file: File) => {
    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${import.meta.env.BASE_URL}api/courts/${courtId}/photo`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error();
      showToast.success("Foto salva!");
      await fetchCourts();
      setPhotoUploadId(null);
    } catch {
      showToast.error("Erro ao enviar foto");
    } finally {
      setPhotoUploading(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isCreating || editTarget !== null}
        onClose={closeModal}
        title={editTarget ? `Editar: ${editTarget.name}` : "Nova Quadra"}
      >
        <div className="space-y-4">
          <div>
            <Label>Nome da Quadra *</Label>
            <Input
              placeholder='Ex: "Quadra 1" ou "Quadra Premium"'
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div>
            <Label>Número (identificador) *</Label>
            <Input
              type="number"
              min={1}
              placeholder="Ex: 1"
              value={formNumber}
              onChange={(e) => setFormNumber(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">Usado para verificar conflito de agendamento.</p>
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Input
              placeholder="Ex: Areia fina, cobertura lateral..."
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Label>Ativa (disponível para reservas)</Label>
            <button
              type="button"
              onClick={() => setFormActive(!formActive)}
              className={cn("transition-colors", formActive ? "text-green-400" : "text-muted-foreground")}
            >
              {formActive ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
            <span className={cn("text-sm font-bold", formActive ? "text-green-400" : "text-muted-foreground")}>
              {formActive ? "Ativa" : "Inativa"}
            </span>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={closeModal} disabled={saving}>Cancelar</Button>
            <Button variant="gold" className="flex-1" onClick={() => void handleSave()} isLoading={saving}>
              {editTarget ? "Salvar Alterações" : "Criar Quadra"}
            </Button>
          </div>
        </div>
      </Modal>

      <Card className="p-3 md:p-6 mt-6">
        <div className="flex items-start justify-between mb-4 md:mb-6 flex-col md:flex-row gap-3 md:gap-0">
          <div>
            <h3 className="text-lg md:text-xl font-display font-bold gold-gradient-text">Gestão de Quadras</h3>
            <p className="text-xs md:text-sm text-muted-foreground">Crie, edite ou exclua as quadras.</p>
          </div>
          <Button variant="gold" size="sm" className="gap-2 w-full md:w-auto text-xs md:text-sm" onClick={openCreate}>
            <Plus size={14} /> <span className="hidden md:inline">Nova Quadra</span><span className="md:hidden">Nova</span>
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : courts.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <p className="mb-4">Nenhuma quadra cadastrada.</p>
            <Button variant="outline" size="sm" onClick={openCreate} className="gap-2">
              <Plus size={14} /> Adicionar primeira quadra
            </Button>
          </div>
        ) : (
          <div className="space-y-2 md:space-y-3">
            {courts.map((court) => (
              <div
                key={court.id}
                className="relative overflow-visible"
              >
                <div
                  className={cn(
                    "flex items-center gap-3 p-3 md:p-4 rounded-xl border transition-all",
                    court.active
                      ? "border-white/10 bg-black/20 hover:border-primary/20"
                      : "border-white/5 bg-black/10 opacity-60"
                  )}
                >
                <div className={cn(
                  "w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center font-display font-bold text-lg md:text-xl shrink-0",
                  court.active ? "bg-primary/20 text-primary" : "bg-muted/30 text-muted-foreground"
                )}>
                  {court.number}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm md:text-base truncate">{court.name}</p>
                    <Badge variant={court.active ? "gold" : "outline"} className="text-xs shrink-0">
                      {court.active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  {court.description && (
                    <p className="text-xs text-muted-foreground truncate">{court.description}</p>
                  )}
                </div>
                {photoUploadId === court.id && (
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        void handlePhotoUpload(court.id, e.target.files[0]);
                      }
                    }}
                    disabled={photoUploading}
                    autoFocus
                    className="hidden"
                    id={`upload-${court.id}`}
                  />
                )}
                <div className="hidden md:flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (photoUploadId === court.id) {
                        document.getElementById(`upload-${court.id}`)?.click();
                      } else {
                        setPhotoUploadId(court.id);
                      }
                    }}
                    disabled={photoUploading}
                    className={cn(
                      "transition-colors p-1",
                      court.photoUrl
                        ? "text-amber-400 hover:text-amber-300"
                        : "text-muted-foreground hover:text-amber-400"
                    )}
                    title={court.photoUrl ? "Foto atual" : "Adicionar foto"}
                  >
                    <ImageIcon size={16} />
                  </button>
                  <button
                    onClick={() => void handleToggleActive(court)}
                    title={court.active ? "Desativar" : "Ativar"}
                    className={cn("transition-colors", court.active ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-green-400")}
                  >
                    {court.active ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  </button>
                  <button
                    onClick={() => void openScheduleEditor(court)}
                    className={cn("transition-colors p-1 text-xs font-semibold flex items-center gap-1", scheduleCourtId === court.id ? "text-primary" : "text-muted-foreground hover:text-primary")}
                    title="Horários por dia"
                  >
                    <Clock size={15} /> Horários
                  </button>
                  <button
                    onClick={() => openEdit(court)}
                    className="text-blue-400 hover:text-blue-300 transition-colors p-1"
                    title="Editar"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => void handleDelete(court.id, court.name)}
                    className="text-red-500 hover:text-red-400 transition-colors p-1"
                    title="Excluir"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <button
                  onClick={() => setExpandedCourtId(expandedCourtId === court.id ? null : court.id)}
                  className="md:hidden text-muted-foreground hover:text-white transition-colors shrink-0"
                  title="Opções"
                >
                  <ChevronDown size={20} className={cn("transition-transform", expandedCourtId === court.id && "rotate-180")} />
                </button>
                </div>

                {/* ── Mobile action buttons (fluxo normal, sem absolute) ── */}
                {expandedCourtId === court.id && (
                  <div className="md:hidden mt-1 bg-black/60 border border-white/10 rounded-xl p-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        if (photoUploadId === court.id) {
                          document.getElementById(`upload-${court.id}`)?.click();
                        } else {
                          setPhotoUploadId(court.id);
                        }
                      }}
                      disabled={photoUploading}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors min-w-[70px]",
                        court.photoUrl
                          ? "bg-amber-400/20 text-amber-400 hover:bg-amber-400/30"
                          : "bg-muted/20 text-muted-foreground hover:bg-amber-400/20 hover:text-amber-400"
                      )}
                    >
                      <ImageIcon size={14} className="inline mr-1" /> Foto
                    </button>
                    <button
                      onClick={() => { void handleToggleActive(court); setExpandedCourtId(null); }}
                      className={cn("flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors min-w-[70px]", court.active ? "bg-green-400/20 text-green-400 hover:bg-green-400/30" : "bg-muted/20 text-muted-foreground hover:bg-green-400/20 hover:text-green-400")}
                    >
                      {court.active ? "Desativar" : "Ativar"}
                    </button>
                    <button
                      onClick={() => { openEdit(court); setExpandedCourtId(null); }}
                      className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-blue-400/20 text-blue-400 hover:bg-blue-400/30 transition-colors min-w-[70px]"
                    >
                      <Edit2 size={14} className="inline mr-1" /> Editar
                    </button>
                    <button
                      onClick={() => { void handleDelete(court.id, court.name); setExpandedCourtId(null); }}
                      className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors min-w-[70px]"
                    >
                      <Trash2 size={14} className="inline mr-1" /> Excluir
                    </button>
                    <button
                      onClick={() => { void openScheduleEditor(court); setExpandedCourtId(null); }}
                      className={cn("flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors min-w-[70px]", scheduleCourtId === court.id ? "bg-primary/20 text-primary" : "bg-muted/20 text-muted-foreground hover:bg-primary/20 hover:text-primary")}
                    >
                      <Clock size={14} className="inline mr-1" /> Horários
                    </button>
                  </div>
                )}

                {/* ── Schedule editor panel ── */}
                {scheduleCourtId === court.id && (
                  <div className="mt-2 mb-4 md:mb-6 border border-primary/20 bg-black/30 rounded-xl p-4 z-20 relative">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-primary" />
                        <span className="font-bold text-sm">Horários por Turno — {court.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground hidden md:block">Turnos: Manhã · Tarde · Noite</span>
                    </div>
                    {scheduleLoading ? (
                      <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div>
                    ) : (
                      <div className="space-y-3">
                        {scheduleData.map((day) => (
                          <div key={day.dayOfWeek} className={cn("rounded-xl border p-3 transition-opacity", day.isOpen ? "border-white/10 bg-white/[0.025]" : "border-white/[0.04] bg-transparent opacity-50")}>
                            {/* Day header: toggle + name */}
                            <div className="flex items-center gap-2 mb-2">
                              <button
                                type="button"
                                onClick={() => updateDay(day.dayOfWeek, "isOpen", !day.isOpen)}
                                className={cn("transition-colors shrink-0", day.isOpen ? "text-green-400" : "text-muted-foreground")}
                              >
                                {day.isOpen ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                              </button>
                              <span className={cn("text-sm font-bold", day.isOpen ? "text-white" : "text-muted-foreground")}>
                                {DAY_NAMES[day.dayOfWeek]}
                              </span>
                              {!day.isOpen && <span className="text-xs text-muted-foreground italic ml-1">— Fechado</span>}
                            </div>
                            {day.isOpen && (
                              <div className="space-y-1.5 pl-8">
                                {/* Column header */}
                                <div className="hidden md:grid grid-cols-[70px_1fr_1fr_80px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pb-1">
                                  <span>Turno</span><span>Início</span><span>Fim</span><span className="text-right">R$/h</span>
                                </div>
                                {/* Shifts */}
                                {(
                                  [
                                    { label: "Manhã", color: "text-yellow-400", startField: "open" as const, endField: "afternoonStart" as const, startH: day.openHour, startM: day.openMinute, endH: day.afternoonStartHour, endM: day.afternoonStartMinute, priceField: "morningPrice" as const },
                                    { label: "Tarde", color: "text-orange-400", startField: "afternoonStart" as const, endField: "eveningStart" as const, startH: day.afternoonStartHour, startM: day.afternoonStartMinute, endH: day.eveningStartHour, endM: day.eveningStartMinute, priceField: "afternoonPrice" as const },
                                    { label: "Noite", color: "text-blue-400", startField: "eveningStart" as const, endField: "close" as const, startH: day.eveningStartHour, startM: day.eveningStartMinute, endH: day.closeHour, endM: day.closeMinute, priceField: "eveningPrice" as const },
                                  ] as const
                                ).map((shift) => (
                                  <div key={shift.label} className="md:grid md:grid-cols-[70px_1fr_1fr_80px] gap-2 md:items-center flex flex-col gap-2">
                                    <span className={cn("text-xs font-semibold md:text-xs text-sm", shift.color)}>{shift.label}</span>
                                    <div className="flex items-center gap-1 text-xs md:text-sm">
                                      <span className="text-[10px] text-muted-foreground md:hidden min-w-fit">de</span>
                                      <select
                                        value={`${String(shift.startH).padStart(2,"0")}:${String(shift.startM).padStart(2,"0")}`}
                                        onChange={(e) => setTimeFromStr(day.dayOfWeek, shift.startField, e.target.value)}
                                        className="flex-1 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-primary/50"
                                      >
                                        {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs md:text-sm">
                                      <span className="text-[10px] text-muted-foreground min-w-fit">até</span>
                                      <select
                                        value={`${String(shift.endH).padStart(2,"0")}:${String(shift.endM).padStart(2,"0")}`}
                                        onChange={(e) => setTimeFromStr(day.dayOfWeek, shift.endField, e.target.value)}
                                        className="flex-1 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-primary/50"
                                      >
                                        {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                    </div>
                                    <div className="flex items-center gap-1 md:justify-end text-xs md:text-sm">
                                      <span className="text-[10px] text-muted-foreground min-w-fit">R$</span>
                                      <input
                                        type="number" min={0} step={1}
                                        value={day[shift.priceField]}
                                        onChange={(e) => updateDay(day.dayOfWeek, shift.priceField, Number(e.target.value))}
                                        className="flex-1 md:w-14 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-primary/50 md:text-right"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="flex flex-wrap justify-between gap-2 pt-3 border-t border-white/5">
                          <button
                            onClick={() => void saveScheduleAllCourts()}
                            disabled={scheduleSaving}
                            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-yellow-400 border border-white/10 hover:border-yellow-400/40 transition-colors disabled:opacity-50"
                            title="Aplica este horário a todas as quadras"
                          >
                            Aplicar a todas as quadras
                          </button>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setScheduleCourtId(null)}
                              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-white border border-white/10 hover:border-white/20 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => void saveSchedule(court.id)}
                              disabled={scheduleSaving}
                              className="px-6 py-2 rounded-lg text-sm font-bold bg-primary text-black hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                              {scheduleSaving ? "Salvando..." : "Salvar Horários"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ──────────────────────────────────────────────────
// MEU PERFIL
// ──────────────────────────────────────────────────
function getTokenRole(token: string | null): string | null {
  if (!token) return null;
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const payload = JSON.parse(atob(token.substring(0, dot).replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role ?? null;
  } catch { return null; }
}

function AdminChangePassword() {
  const { getAuthHeaders, token } = useAdminAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  if (getTokenRole(token) !== "tenant_admin") return null;

  const handleSubmit = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast.error("Preencha todos os campos");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast.error("As senhas não coincidem");
      return;
    }
    if (newPassword.length < 6) {
      showToast.error("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/auth/change-password`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { showToast.error(data.error ?? "Erro ao alterar senha"); return; }
      showToast.success("Senha alterada com sucesso!");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch { showToast.error("Erro de conexão"); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2 mb-1">
        <Key size={18} className="text-primary" />
        <h3 className="font-display text-xl text-foreground uppercase tracking-wider">Alterar Senha</h3>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <Label>Senha Atual</Label>
          <div className="relative">
            <Input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowCurrent(v => !v)}
            >
              {showCurrent ? <Eye size={15} /> : <Eye size={15} className="opacity-40" />}
            </button>
          </div>
        </div>
        <div>
          <Label>Nova Senha</Label>
          <div className="relative">
            <Input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowNew(v => !v)}
            >
              {showNew ? <Eye size={15} /> : <Eye size={15} className="opacity-40" />}
            </button>
          </div>
        </div>
        <div>
          <Label>Confirmar Nova Senha</Label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button
          variant="gold"
          onClick={handleSubmit}
          isLoading={saving}
          className="mt-2"
        >
          <Key size={14} className="mr-2" />
          Alterar Senha
        </Button>
      </div>
    </Card>
  );
}

function AdminMeuPerfil({ onCompanyNameChange }: { onCompanyNameChange?: (name: string) => void }) {
  const { getAuthHeaders } = useAdminAuth();
  const { profile, loading } = useCompanyProfile();

  const [companyName, setCompanyName] = useState("");
  const [companyCnpj, setCompanyCnpj] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMapEmbed, setContactMapEmbed] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [instagramDescription, setInstagramDescription] = useState("");
  const [copaPageName, setCopaPageName] = useState("");
  const [copaPageTitle, setCopaPageTitle] = useState("");
  const [copaPageDescription, setCopaPageDescription] = useState("");
  const [themePrimary, setThemePrimary] = useState("#c9a227");
  const [themeBackground, setThemeBackground] = useState("#0a0a0a");
  const [themePrimaryForeground, setThemePrimaryForeground] = useState("#000000");

  const [navHidden, setNavHidden] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string>("");
  const [uploadingFavicon, setUploadingFavicon] = useState(false);

  useEffect(() => {
    if (!loading) {
      setCompanyName(profile.company_name ?? "");
      setCompanyCnpj(maskCNPJ(profile.company_cnpj ?? ""));
      setCompanyPhone(maskPhone(profile.company_phone ?? ""));
      setCompanyAddress(profile.company_address ?? "");
      setCompanyDescription(profile.company_description ?? "");
      setContactEmail(profile.contact_email ?? "");
      setContactMapEmbed(profile.contact_map_embed ?? "");
      setInstagramHandle(profile.instagram_handle ?? "");
      setInstagramDescription(profile.instagram_description ?? "");
      setCopaPageName(profile.copa_page_name ?? "Copa");
      setCopaPageTitle(profile.copa_page_title ?? "");
      setCopaPageDescription(profile.copa_page_description ?? "");
      setThemePrimary(profile.theme_primary ?? "#c9a227");
      setThemeBackground(profile.theme_background ?? "#0a0a0a");
      setThemePrimaryForeground(profile.theme_primary_foreground ?? "#000000");
      try { setNavHidden(JSON.parse(profile.nav_hidden ?? "[]")); } catch { setNavHidden([]); }
    }
  }, [loading, profile]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleUploadLogo = async () => {
    if (!logoFile) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", logoFile);
      const res = await fetch(`${import.meta.env.BASE_URL}api/profile/logo`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error("Falha no upload");
      invalidateProfileCache();
      showToast.success("Logo atualizado com sucesso!");
      setLogoFile(null);
    } catch {
      showToast.error("Erro ao fazer upload do logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleFaviconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFaviconFile(file);
    setFaviconPreview(URL.createObjectURL(file));
  };

  const handleUploadFavicon = async () => {
    if (!faviconFile) return;
    setUploadingFavicon(true);
    try {
      const formData = new FormData();
      formData.append("favicon", faviconFile);
      const res = await fetch(`${import.meta.env.BASE_URL}api/profile/favicon`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error("Falha no upload");
      invalidateProfileCache();
      showToast.success("Favicon atualizado com sucesso!");
      setFaviconFile(null);
    } catch {
      showToast.error("Erro ao fazer upload do favicon");
    } finally {
      setUploadingFavicon(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/profile`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          company_cnpj: companyCnpj.replace(/\D/g, ""),
          company_phone: companyPhone.replace(/\D/g, ""),
          company_address: companyAddress,
          company_description: companyDescription,
          contact_email: contactEmail,
          contact_map_embed: contactMapEmbed,
          instagram_handle: instagramHandle,
          instagram_description: instagramDescription,
          copa_page_name: copaPageName,
          copa_page_title: copaPageTitle,
          copa_page_description: copaPageDescription,
          theme_primary: themePrimary,
          theme_background: themeBackground,
          theme_primary_foreground: themePrimaryForeground,
          nav_hidden: JSON.stringify(navHidden),
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      invalidateProfileCache();
      setSaved(true);
      showToast.success("Perfil salvo com sucesso!");
      onCompanyNameChange?.(companyName);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      showToast.error("Erro ao salvar perfil");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        Carregando perfil...
      </Card>
    );
  }

  const currentLogo = logoPreview || profile.logo_url || "";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Logo & Preview */}
      <Card className="p-6 flex flex-col gap-5">
        <div className="flex items-center gap-2 mb-1">
          <ImageIcon size={18} className="text-primary" />
          <h3 className="font-display text-xl text-foreground uppercase tracking-wider">Logo</h3>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="w-full h-36 rounded-xl border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden">
            <img
              src={currentLogo}
              alt="Logo preview"
              className="max-h-32 max-w-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <label className="w-full cursor-pointer">
            <div className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg border border-dashed border-white/20 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
              <Upload size={16} />
              {logoFile ? logoFile.name : "Selecionar imagem"}
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
          </label>
          {logoFile && (
            <Button
              className="w-full"
              variant="gold"
              onClick={handleUploadLogo}
              isLoading={uploadingLogo}
            >
              <Upload size={14} className="mr-2" />
              Enviar Logo
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground text-center">
          Formatos: JPG, PNG, SVG, WebP. Máx. 5 MB.
        </p>

        <div className="border-t border-white/10 pt-4 mt-2">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-primary" />
            <span className="text-sm font-semibold">Favicon do Site</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Ícone exibido na aba do navegador. Padrão: sem imagem.</p>
          <div className="flex items-center gap-3 mb-3">
            {(faviconPreview || profile.favicon_url) ? (
              <img
                src={faviconPreview || profile.favicon_url}
                alt="Favicon preview"
                className="w-10 h-10 object-contain rounded border border-white/10 bg-black/40"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-10 h-10 rounded border border-dashed border-white/20 bg-black/40 flex items-center justify-center text-muted-foreground">
                <Globe size={16} />
              </div>
            )}
            <label className="flex-1 cursor-pointer">
              <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-white/20 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
                <Upload size={13} />
                {faviconFile ? faviconFile.name : "Selecionar favicon"}
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handleFaviconChange} />
            </label>
          </div>
          {faviconFile && (
            <Button
              className="w-full"
              variant="gold"
              size="sm"
              onClick={handleUploadFavicon}
              isLoading={uploadingFavicon}
            >
              <Upload size={13} className="mr-2" />
              Enviar Favicon
            </Button>
          )}
        </div>
      </Card>

      {/* Alterar Senha */}
      <AdminChangePassword />

      {/* Company Info */}
      <Card className="p-6 flex flex-col gap-5">
        <div className="flex items-center gap-2 mb-1">
          <Building2 size={18} className="text-primary" />
          <h3 className="font-display text-xl text-foreground uppercase tracking-wider">Empresa</h3>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Nome da Empresa</Label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Nome da Empresa"
            />
          </div>
          <div>
            <Label>CNPJ</Label>
            <Input
              value={companyCnpj}
              onChange={(e) => setCompanyCnpj(maskCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
            />
          </div>
          <div>
            <Label>Telefone / WhatsApp</Label>
            <Input
              value={companyPhone}
              onChange={(e) => setCompanyPhone(maskPhone(e.target.value))}
              placeholder="(51) 99999-9999"
            />
          </div>
          <div>
            <Label>Endereço</Label>
            <Input
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="Rua Exemplo, 123 - Cidade - RS"
            />
          </div>
          <div>
            <Label>Descrição (rodapé do site)</Label>
            <textarea
              value={companyDescription}
              onChange={(e) => setCompanyDescription(e.target.value)}
              placeholder="Breve descrição da empresa..."
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <Label>Email de Contato</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="contato@suaempresa.com.br"
            />
            <p className="text-xs text-muted-foreground mt-1">Para onde as mensagens do formulário de contato serão enviadas</p>
          </div>
          <div>
            <Label>URL do Mapa (Google Maps Embed)</Label>
            <Input
              value={contactMapEmbed}
              onChange={(e) => setContactMapEmbed(e.target.value)}
              placeholder="https://www.google.com/maps/embed?pb=..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              No Google Maps: Compartilhar → Incorporar um mapa → copie a URL do src="" do iframe
            </p>
          </div>
        </div>
      </Card>

      {/* Instagram */}
      <Card className="p-6 flex flex-col gap-5">
        <div className="flex items-center gap-2 mb-1">
          <Instagram size={18} className="text-primary" />
          <h3 className="font-display text-xl text-foreground uppercase tracking-wider">Instagram</h3>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Usuário do Instagram</Label>
            <Input
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="username ou @username"
            />
            <p className="text-xs text-muted-foreground mt-1">Deixe em branco para desabilitar a seção do Instagram na homepage</p>
          </div>
          <div>
            <Label>Descrição (sobre o feed)</Label>
            <textarea
              value={instagramDescription}
              onChange={(e) => setInstagramDescription(e.target.value)}
              placeholder="Acompanhe nossos melhores momentos, promoções e novidades em tempo real."
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </Card>

      {/* Copa */}
      <Card className="p-6 flex flex-col gap-5">
        <div className="flex items-center gap-2 mb-1">
          <Trophy size={18} className="text-primary" />
          <h3 className="font-display text-xl text-foreground uppercase tracking-wider">Página da Copa</h3>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Nome no Menu</Label>
            <Input
              value={copaPageName}
              onChange={(e) => setCopaPageName(e.target.value)}
              placeholder="Copa"
            />
            <p className="text-xs text-muted-foreground mt-1">Nome exibido no menu de navegação e no rodapé</p>
          </div>
          <div>
            <Label>Título da Página</Label>
            <Input
              value={copaPageTitle}
              onChange={(e) => setCopaPageTitle(e.target.value)}
              placeholder="COPA"
            />
            <p className="text-xs text-muted-foreground mt-1">Título exibido em destaque no topo da página. Se vazio, usa o Nome no Menu.</p>
          </div>
          <div>
            <Label>Descrição</Label>
            <textarea
              value={copaPageDescription}
              onChange={(e) => setCopaPageDescription(e.target.value)}
              placeholder="O circuito definitivo de futvolei. Forme sua dupla, entre na arena e faça história."
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </Card>

      {/* Nav Visibility */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Eye size={18} className="text-primary" />
          <h3 className="font-display text-xl text-foreground uppercase tracking-wider">Visibilidade do Menu</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Ative ou desative páginas no menu e rodapé do site</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { href: "/", label: "Home" },
            { href: "/agendamento", label: "Agendamento" },
            { href: "/beach-tennis", label: "Beach Tennis" },
            { href: "/copa", label: copaPageName || "Copa" },
            { href: "/galeria", label: "Galeria" },
            { href: "/contato", label: "Contato" },
          ].map((item) => {
            const isHidden = navHidden.includes(item.href);
            const isHome = item.href === "/";
            return (
              <button
                key={item.href}
                disabled={isHome}
                onClick={() => {
                  if (isHome) return;
                  setNavHidden((prev) =>
                    prev.includes(item.href) ? prev.filter((h) => h !== item.href) : [...prev, item.href]
                  );
                }}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 text-left",
                  isHome
                    ? "opacity-50 cursor-not-allowed border-white/10 bg-black/20"
                    : isHidden
                      ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                      : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                )}
              >
                <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0", isHidden ? "bg-red-500/20" : "bg-primary/10")}>
                  {isHidden ? "✕" : "✓"}
                </span>
                <span className="text-xs font-semibold leading-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-4">Salve o perfil para aplicar.</p>
      </Card>

      <BannersManagement />
      <CardsManagement />

      {/* Theme Colors — ÚLTIMO CARD */}
      <Card className="p-6 flex flex-col gap-5">
        <div className="flex items-center gap-2 mb-1">
          <Palette size={18} className="text-primary" />
          <h3 className="font-display text-xl text-foreground uppercase tracking-wider">Cores</h3>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <Label>Cor de Destaque (primária)</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="color"
                value={themePrimary}
                onChange={(e) => setThemePrimary(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border-0 bg-transparent"
              />
              <Input
                value={themePrimary}
                onChange={(e) => setThemePrimary(e.target.value)}
                placeholder="#c9a227"
                className="font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Usada em botões, links ativos e destaques</p>
          </div>
          <div>
            <Label>Cor de Fundo</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="color"
                value={themeBackground}
                onChange={(e) => setThemeBackground(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border-0 bg-transparent"
              />
              <Input
                value={themeBackground}
                onChange={(e) => setThemeBackground(e.target.value)}
                placeholder="#0a0a0a"
                className="font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Cor de fundo principal do site</p>
          </div>
          <div>
            <Label>Texto sobre Cor de Destaque</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="color"
                value={themePrimaryForeground}
                onChange={(e) => setThemePrimaryForeground(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border-0 bg-transparent"
              />
              <Input
                value={themePrimaryForeground}
                onChange={(e) => setThemePrimaryForeground(e.target.value)}
                placeholder="#000000"
                className="font-mono"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Cor do texto dentro de botões coloridos</p>
          </div>
          <div className="p-3 rounded-lg border border-white/10 bg-black/30">
            <p className="text-xs text-muted-foreground mb-2">Pré-visualização:</p>
            <button
              style={{ backgroundColor: themePrimary, color: themePrimaryForeground }}
              className="px-4 py-2 rounded-lg text-sm font-bold"
            >
              Botão de Exemplo
            </button>
          </div>
        </div>

        <Button
          variant="gold"
          onClick={handleSave}
          isLoading={saving}
          className="mt-auto w-full"
        >
          {saved ? (
            <><CheckCircle2 size={16} className="mr-2" /> Salvo!</>
          ) : (
            <><Save size={16} className="mr-2" /> Salvar Perfil</>
          )}
        </Button>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────
// PÁGINA INICIAL — BANNERS (SLIDES)
// ──────────────────────────────────────────────────

type HomeSlide = {
  id: number;
  title: string;
  subtitle: string | null;
  cta1Label: string | null;
  cta1Href: string | null;
  cta1Icon: string | null;
  cta2Label: string | null;
  cta2Href: string | null;
  cta2Icon: string | null;
  bgImageUrl: string | null;
  gradient: string | null;
  displayOrder: number | null;
  active: boolean | null;
};

type HomeCard = {
  id: number;
  title: string;
  description: string | null;
  icon: string | null;
  linkHref: string | null;
  linkLabel: string | null;
  highlight: boolean | null;
  displayOrder: number | null;
  active: boolean | null;
};

const ICON_OPTIONS = [
  { value: "calendar", label: "Calendário" },
  { value: "trophy", label: "Troféu" },
  { value: "image", label: "Imagem" },
  { value: "star", label: "Estrela" },
];

const GRADIENT_OPTIONS = [
  { value: "from-background via-background/70 to-transparent", label: "Escuro forte" },
  { value: "from-background via-background/60 to-transparent", label: "Escuro médio" },
  { value: "from-background via-background/65 to-transparent", label: "Escuro leve" },
  { value: "from-background/90 via-background/40 to-transparent", label: "Difuso" },
];

function BannersManagement() {
  const { getAuthHeaders } = useAdminAuth();
  const [slides, setSlides] = useState<HomeSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<HomeSlide>>({});
  const [uploadingImage, setUploadingImage] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/home/slides/all`, { headers: getAuthHeaders() });
      setSlides(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const startEdit = (slide: HomeSlide) => {
    setEditingId(slide.id);
    setEditForm({ ...slide });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await fetch(`${import.meta.env.BASE_URL}api/home/slides/${editingId}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      showToast.success("Banner salvo!");
      setEditingId(null);
      load();
    } catch { showToast.error("Erro ao salvar banner"); }
  };

  const addSlide = async () => {
    try {
      await fetch(`${import.meta.env.BASE_URL}api/home/slides`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Novo Banner" }),
      });
      showToast.success("Banner adicionado!");
      load();
    } catch { showToast.error("Erro ao adicionar banner"); }
  };

  const deleteSlide = async (id: number) => {
    const ok = await showConfirm("Excluir este banner?");
    if (!ok) return;
    await fetch(`${import.meta.env.BASE_URL}api/home/slides/${id}`, { method: "DELETE", headers: getAuthHeaders() });
    showToast.success("Banner excluído!");
    load();
  };

  const uploadImage = async (id: number, file: File) => {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${import.meta.env.BASE_URL}api/home/slides/${id}/image`, {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      const data = await res.json();
      if (data.url) {
        setEditForm((prev) => ({ ...prev, bgImageUrl: data.url }));
        showToast.success("Imagem enviada!");
      }
    } catch { showToast.error("Erro ao enviar imagem"); }
    finally { setUploadingImage(false); }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <ImageIcon size={20} className="text-primary" /> Banners da Página Inicial
        </h3>
        <Button variant="gold" size="sm" onClick={addSlide} className="gap-1">
          <Plus size={14} /> Adicionar Banner
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm text-center py-4">Carregando...</div>
      ) : slides.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-4">Nenhum banner cadastrado. Clique em "Adicionar Banner" para começar.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {slides.map((slide) => (
            <div key={slide.id} className="border border-white/10 rounded-xl overflow-hidden">
              {editingId === slide.id ? (
                <div className="p-4 flex flex-col gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">Título</Label>
                      <Input value={editForm.title ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} placeholder="TÍTULO EM MAIÚSCULAS" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Gradiente</Label>
                      <select
                        value={editForm.gradient ?? ""}
                        onChange={(e) => setEditForm((p) => ({ ...p, gradient: e.target.value }))}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {GRADIENT_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs mb-1 block">Subtítulo / Descrição</Label>
                      <Input value={editForm.subtitle ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, subtitle: e.target.value }))} placeholder="Descrição do banner..." />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border border-white/10 bg-black/20">
                      <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Botão Principal</p>
                      <div className="flex gap-2 mb-2">
                        <Input value={editForm.cta1Label ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, cta1Label: e.target.value }))} placeholder="Texto do botão" className="flex-1" />
                        <select value={editForm.cta1Icon ?? "calendar"} onChange={(e) => setEditForm((p) => ({ ...p, cta1Icon: e.target.value }))} className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm text-foreground focus:outline-none">
                          {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <Input value={editForm.cta1Href ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, cta1Href: e.target.value }))} placeholder="URL destino (ex: /agendamento)" />
                    </div>
                    <div className="p-3 rounded-lg border border-white/10 bg-black/20">
                      <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Botão Secundário</p>
                      <div className="flex gap-2 mb-2">
                        <Input value={editForm.cta2Label ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, cta2Label: e.target.value }))} placeholder="Texto do botão" className="flex-1" />
                        <select value={editForm.cta2Icon ?? "trophy"} onChange={(e) => setEditForm((p) => ({ ...p, cta2Icon: e.target.value }))} className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm text-foreground focus:outline-none">
                          {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <Input value={editForm.cta2Href ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, cta2Href: e.target.value }))} placeholder="URL destino (ex: /copa)" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs mb-1 block">Imagem de Fundo</Label>
                    {editForm.bgImageUrl && (
                      <div className="mb-2 rounded-lg overflow-hidden h-24 bg-cover bg-center" style={{ backgroundImage: `url(${editForm.bgImageUrl})` }} />
                    )}
                    <div className="flex gap-2 items-center">
                      <label className="cursor-pointer">
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(slide.id, f); }} />
                        <Button variant="outline" size="sm" isLoading={uploadingImage} className="gap-1" onClick={(e) => { e.preventDefault(); (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement)?.click(); }}>
                          <Upload size={14} /> {uploadingImage ? "Enviando..." : "Upload de Imagem"}
                        </Button>
                      </label>
                      <Input value={editForm.bgImageUrl ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, bgImageUrl: e.target.value }))} placeholder="Ou cole a URL da imagem" className="flex-1 text-xs" />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={editForm.active ?? true} onChange={(e) => setEditForm((p) => ({ ...p, active: e.target.checked }))} className="rounded" />
                      Banner ativo (visível no site)
                    </label>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-white/10">
                    <Button variant="gold" size="sm" onClick={saveEdit} className="gap-1"><Save size={14} /> Salvar</Button>
                    <Button variant="outline" size="sm" onClick={cancelEdit}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3">
                  {slide.bgImageUrl ? (
                    <div className="w-16 h-12 rounded-lg bg-cover bg-center flex-shrink-0 bg-card" style={{ backgroundImage: `url(${slide.bgImageUrl})` }} />
                  ) : (
                    <div className="w-16 h-12 rounded-lg bg-card flex-shrink-0 flex items-center justify-center">
                      <ImageIcon size={20} className="text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{slide.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{slide.subtitle || "Sem subtítulo"}</p>
                    <div className="flex gap-2 mt-1">
                      {slide.cta1Label && <Badge className="text-[10px] px-1 py-0">{slide.cta1Label}</Badge>}
                      {slide.cta2Label && <Badge className="text-[10px] px-1 py-0 bg-white/10">{slide.cta2Label}</Badge>}
                      {!slide.active && <Badge className="text-[10px] px-1 py-0 bg-red-500/20 text-red-400">Inativo</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(slide)} className="gap-1 text-xs"><Edit2 size={12} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteSlide(slide.id)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2"><Trash2 size={12} /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CardsManagement() {
  const { getAuthHeaders } = useAdminAuth();
  const [cards, setCards] = useState<HomeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<HomeCard>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/home/cards/all`, { headers: getAuthHeaders() });
      setCards(await res.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const startEdit = (card: HomeCard) => { setEditingId(card.id); setEditForm({ ...card }); };
  const cancelEdit = () => { setEditingId(null); setEditForm({}); };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await fetch(`${import.meta.env.BASE_URL}api/home/cards/${editingId}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      showToast.success("Card salvo!");
      setEditingId(null);
      load();
    } catch { showToast.error("Erro ao salvar card"); }
  };

  const addCard = async () => {
    await fetch(`${import.meta.env.BASE_URL}api/home/cards`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Novo Card" }),
    });
    showToast.success("Card adicionado!");
    load();
  };

  const deleteCard = async (id: number) => {
    const ok = await showConfirm("Excluir este card?");
    if (!ok) return;
    await fetch(`${import.meta.env.BASE_URL}api/home/cards/${id}`, { method: "DELETE", headers: getAuthHeaders() });
    showToast.success("Card excluído!");
    load();
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <Settings size={20} className="text-primary" /> Cards da Página Inicial
        </h3>
        <Button variant="gold" size="sm" onClick={addCard} className="gap-1">
          <Plus size={14} /> Adicionar Card
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm text-center py-4">Carregando...</div>
      ) : cards.length === 0 ? (
        <div className="text-muted-foreground text-sm text-center py-4">Nenhum card cadastrado.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <div key={card.id} className="border border-white/10 rounded-xl overflow-hidden">
              {editingId === card.id ? (
                <div className="p-4 flex flex-col gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">Título</Label>
                      <Input value={editForm.title ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} placeholder="Título do card" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Ícone</Label>
                      <select value={editForm.icon ?? "star"} onChange={(e) => setEditForm((p) => ({ ...p, icon: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                        {ICON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs mb-1 block">Descrição</Label>
                      <Input value={editForm.description ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} placeholder="Texto de descrição do card..." />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Texto do Botão</Label>
                      <Input value={editForm.linkLabel ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, linkLabel: e.target.value }))} placeholder="Ex: Saiba mais" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">URL de Destino</Label>
                      <Input value={editForm.linkHref ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, linkHref: e.target.value }))} placeholder="Ex: /agendamento" />
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={editForm.highlight ?? false} onChange={(e) => setEditForm((p) => ({ ...p, highlight: e.target.checked }))} className="rounded" />
                      Card em destaque (estilo dourado)
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={editForm.active ?? true} onChange={(e) => setEditForm((p) => ({ ...p, active: e.target.checked }))} className="rounded" />
                      Card ativo
                    </label>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-white/10">
                    <Button variant="gold" size="sm" onClick={saveEdit} className="gap-1"><Save size={14} /> Salvar</Button>
                    <Button variant="outline" size="sm" onClick={cancelEdit}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Trophy size={18} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{card.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{card.description || "Sem descrição"}</p>
                    <div className="flex gap-2 mt-1">
                      {card.linkLabel && <span className="text-[10px] text-primary">→ {card.linkLabel}</span>}
                      {card.highlight && <Badge className="text-[10px] px-1 py-0 bg-primary/20 text-primary">Destaque</Badge>}
                      {!card.active && <Badge className="text-[10px] px-1 py-0 bg-red-500/20 text-red-400">Inativo</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(card)}><Edit2 size={12} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteCard(card.id)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2"><Trash2 size={12} /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ──────────────────────────────────────────────────
// EMAIL MKT
// ──────────────────────────────────────────────────
type Campaign = {
  id: number;
  name: string;
  subject: string;
  content: string;
  bgColor: string | null;
  filter: string;
  status: string;
  sentAt: string | null;
  sentCount: number;
  failedCount: number;
  createdAt: string;
};

const FILTER_OPTIONS = [
  { value: "newsletter", label: "Assinantes da Newsletter", icon: "📧" },
  { value: "monthly_any", label: "Clientes com planos ativos", icon: "⭐" },
  { value: "no_plan", label: "Clientes sem planos ativos", icon: "👤" },
  { value: "bookings", label: "Clientes com reservas (confirmadas/concluídas)", icon: "📅" },
];

function AdminEmailMKT() {
  const { getAuthHeaders } = useAdminAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "editor">("list");
  const [editing, setEditing] = useState<Campaign | null>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [filter, setFilter] = useState("all");
  const [previewEmail, setPreviewEmail] = useState("");
  const [previewSending, setPreviewSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [bgColor, setBgColor] = useState("#ffffff");

  // Email groups state
  type EmailGroup = { id: number; name: string; memberCount: number; createdAt: string };
  type GroupMember = { id: number; groupId: number; name: string | null; email: string; createdAt: string };
  const [emailGroups, setEmailGroups] = useState<EmailGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [managingGroup, setManagingGroup] = useState<EmailGroup | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [memberInput, setMemberInput] = useState("");
  const [addingMembers, setAddingMembers] = useState(false);

  // Templates state
  type EmailTemplate = { id: number; name: string; subject: string | null; content: string; bgColor: string | null; createdAt: string };
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // Recipient picker state
  type Recipient = { id: number; name: string; email: string };
  const [groupData, setGroupData] = useState<Record<string, Recipient[]>>({});
  const [groupLoading, setGroupLoading] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-campaigns`, { headers: getAuthHeaders() });
      const data = await res.json();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch { setCampaigns([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCampaigns(); fetchTemplates(); fetchEmailGroups(); }, []);

  const loadGroup = async (filterValue: string) => {
    if (groupData[filterValue]) return;
    setGroupLoading((prev) => ({ ...prev, [filterValue]: true }));
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-campaigns/recipients/list?filter=${filterValue}`, { headers: getAuthHeaders() });
      const data: Recipient[] = await res.json();
      setGroupData((prev) => ({ ...prev, [filterValue]: data }));
      setNameMap((prev) => {
        const next = { ...prev };
        data.forEach((r) => { next[r.email] = r.name; });
        return next;
      });
    } catch {
      setGroupData((prev) => ({ ...prev, [filterValue]: [] }));
    } finally {
      setGroupLoading((prev) => ({ ...prev, [filterValue]: false }));
    }
  };

  const toggleGroup = async (filterValue: string) => {
    if (!expandedGroups.has(filterValue)) {
      await loadGroup(filterValue);
      setExpandedGroups((prev) => new Set([...prev, filterValue]));
    } else {
      setExpandedGroups((prev) => { const next = new Set(prev); next.delete(filterValue); return next; });
    }
  };

  const selectAllInGroup = async (filterValue: string) => {
    if (!groupData[filterValue]) await loadGroup(filterValue);
    const group = groupData[filterValue] ?? [];
    setSelectedEmails((prev) => { const next = new Set(prev); group.forEach((r) => next.add(r.email)); return next; });
  };

  const deselectAllInGroup = (filterValue: string) => {
    const group = groupData[filterValue] ?? [];
    const emails = new Set(group.map((r) => r.email));
    setSelectedEmails((prev) => { const next = new Set(prev); emails.forEach((e) => next.delete(e)); return next; });
  };

  const isGroupFullySelected = (filterValue: string) => {
    const group = groupData[filterValue] ?? [];
    return group.length > 0 && group.every((r) => selectedEmails.has(r.email));
  };

  const isGroupPartiallySelected = (filterValue: string) => {
    const group = groupData[filterValue] ?? [];
    return group.some((r) => selectedEmails.has(r.email)) && !isGroupFullySelected(filterValue);
  };

  const selectAllLoaded = () => {
    const all = Object.values(groupData).flat();
    setSelectedEmails((prev) => { const next = new Set(prev); all.forEach((r) => next.add(r.email)); return next; });
  };

  const clearAllSelections = () => setSelectedEmails(new Set());

  // ── Email groups helpers ──────────────────────────────────────────────
  const fetchEmailGroups = async () => {
    setGroupsLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-groups`, { headers: getAuthHeaders() });
      const data = await res.json();
      setEmailGroups(Array.isArray(data) ? data : []);
    } catch { setEmailGroups([]); }
    finally { setGroupsLoading(false); }
  };

  const createEmailGroup = async () => {
    if (!newGroupName.trim()) { showToast.error("Informe o nome do grupo"); return; }
    setCreatingGroup(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-groups`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewGroupName("");
      showToast.success("Grupo criado!");
      await fetchEmailGroups();
    } catch { showToast.error("Erro ao criar grupo"); }
    finally { setCreatingGroup(false); }
  };

  const deleteEmailGroup = async (id: number) => {
    if (!confirm("Excluir este grupo e todos seus membros?")) return;
    await fetch(`${import.meta.env.BASE_URL}api/email-groups/${id}`, { method: "DELETE", headers: getAuthHeaders() });
    showToast.success("Grupo excluído");
    if (managingGroup?.id === id) setManagingGroup(null);
    fetchEmailGroups();
  };

  const renameEmailGroup = async (id: number, name: string) => {
    await fetch(`${import.meta.env.BASE_URL}api/email-groups/${id}`, {
      method: "PATCH",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setEmailGroups((prev) => prev.map((g) => g.id === id ? { ...g, name } : g));
    if (managingGroup?.id === id) setManagingGroup((g) => g ? { ...g, name } : g);
    showToast.success("Grupo renomeado");
  };

  const openManageGroup = async (g: EmailGroup) => {
    setManagingGroup(g);
    setGroupMembersLoading(true);
    setGroupMembers([]);
    setMemberInput("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-groups/${g.id}/members`, { headers: getAuthHeaders() });
      setGroupMembers(await res.json());
    } catch { setGroupMembers([]); }
    finally { setGroupMembersLoading(false); }
  };

  const removeGroupMember = async (memberId: number) => {
    await fetch(`${import.meta.env.BASE_URL}api/email-groups/${managingGroup!.id}/members/${memberId}`, { method: "DELETE", headers: getAuthHeaders() });
    setGroupMembers((prev) => prev.filter((m) => m.id !== memberId));
    setEmailGroups((prev) => prev.map((g) => g.id === managingGroup!.id ? { ...g, memberCount: g.memberCount - 1 } : g));
  };

  const addGroupMembers = async () => {
    if (!memberInput.trim()) return;
    setAddingMembers(true);
    try {
      const lines = memberInput.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
      const members = lines.map((line) => {
        const angleMatch = line.match(/^(.+?)\s*<(.+@.+)>\s*$/);
        if (angleMatch) return { name: angleMatch[1].trim() || undefined, email: angleMatch[2].trim() };
        const colonMatch = line.match(/^([^:@]+):\s*(.+@.+)$/);
        if (colonMatch) return { name: colonMatch[1].trim() || undefined, email: colonMatch[2].trim() };
        const emailMatch = line.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
          const name = line.replace(emailMatch[0], "").replace(/[,()\[\]<>]/g, "").trim();
          return { email: emailMatch[0], name: name || undefined };
        }
        return null;
      }).filter(Boolean) as { name?: string; email: string }[];

      if (members.length === 0) { showToast.error("Nenhum e-mail válido encontrado"); return; }

      const res = await fetch(`${import.meta.env.BASE_URL}api/email-groups/${managingGroup!.id}/members`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ members }),
      });
      const data = await res.json();
      showToast.success(`${data.inserted} adicionado${data.inserted !== 1 ? "s" : ""}${data.skipped > 0 ? ` (${data.skipped} duplicado${data.skipped !== 1 ? "s" : ""} ignorado${data.skipped !== 1 ? "s" : ""})` : ""}`);
      setMemberInput("");
      const mRes = await fetch(`${import.meta.env.BASE_URL}api/email-groups/${managingGroup!.id}/members`, { headers: getAuthHeaders() });
      const mData = await mRes.json();
      setGroupMembers(mData);
      setEmailGroups((prev) => prev.map((g) => g.id === managingGroup!.id ? { ...g, memberCount: mData.length } : g));
    } catch { showToast.error("Erro ao adicionar membros"); }
    finally { setAddingMembers(false); }
  };
  // ─────────────────────────────────────────────────────────────────────

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-templates`, { headers: getAuthHeaders() });
      const data = await res.json();
      setTemplates(Array.isArray(data) ? data : []);
    } catch { setTemplates([]); }
    finally { setTemplatesLoading(false); }
  };

  const saveAsTemplate = async () => {
    if (!templateName.trim()) { showToast.error("Dê um nome ao template"); return; }
    if (!content) { showToast.error("Conteúdo vazio"); return; }
    setSavingTemplate(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-templates`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName, subject, content, bgColor }),
      });
      if (!res.ok) throw new Error("Erro");
      showToast.success("Template salvo!");
      setTemplateName("");
      fetchTemplates();
    } catch { showToast.error("Erro ao salvar template"); }
    finally { setSavingTemplate(false); }
  };

  const loadTemplate = (t: EmailTemplate) => {
    setContent(t.content);
    setBgColor(t.bgColor ?? "#ffffff");
    if (t.subject) setSubject(t.subject);
    setShowTemplates(false);
    showToast.success(`Template "${t.name}" carregado!`);
  };

  const deleteTemplate = async (id: number) => {
    if (!confirm("Excluir este template?")) return;
    await fetch(`${import.meta.env.BASE_URL}api/email-templates/${id}`, { method: "DELETE", headers: getAuthHeaders() });
    showToast.success("Template excluído");
    fetchTemplates();
  };

  const resetEditorState = () => {
    setGroupData({}); setGroupLoading({}); setExpandedGroups(new Set());
    setSelectedEmails(new Set()); setNameMap({});
    setPreviewEmail(""); setShowPreview(false); setConfirmSend(false);
    setBgColor("#ffffff"); setShowTemplates(false); setTemplateName("");
  };

  const openCreate = () => {
    setEditing(null);
    setName(""); setSubject(""); setContent(""); setFilter("all");
    resetEditorState();
    setView("editor");
  };

  const openEdit = (c: Campaign) => {
    setEditing(c);
    setName(c.name); setSubject(c.subject); setContent(c.content); setFilter(c.filter);
    resetEditorState();
    setBgColor(c.bgColor || "#ffffff");
    setView("editor");
  };

  const handleSaveDraft = async () => {
    if (!name || !subject || !content) { showToast.error("Preencha nome, assunto e conteúdo"); return; }
    setSaving(true);
    try {
      const url = editing
        ? `${import.meta.env.BASE_URL}api/email-campaigns/${editing.id}`
        : `${import.meta.env.BASE_URL}api/email-campaigns`;
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, content, bgColor, filter }),
      });
      if (!res.ok) throw new Error("Erro ao salvar");
      showToast.success(editing ? "Campanha atualizada!" : "Rascunho salvo!");
      await fetchCampaigns();
      setView("list");
    } catch { showToast.error("Erro ao salvar campanha"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Excluir esta campanha?")) return;
    try {
      await fetch(`${import.meta.env.BASE_URL}api/email-campaigns/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      showToast.success("Campanha excluída");
      fetchCampaigns();
    } catch { showToast.error("Erro ao excluir"); }
  };

  const handleSendPreview = async () => {
    if (!previewEmail) { showToast.error("Informe um e-mail para o preview"); return; }
    if (!editing && (!name || !subject || !content)) { showToast.error("Salve o rascunho primeiro"); return; }
    setPreviewSending(true);
    try {
      let id = editing?.id;
      if (!id) {
        const res = await fetch(`${import.meta.env.BASE_URL}api/email-campaigns`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: name || "Preview", subject, content, bgColor, filter }),
        });
        const data = await res.json();
        id = data.id;
        setEditing(data);
        fetchCampaigns();
      }
      const res = await fetch(`${import.meta.env.BASE_URL}api/email-campaigns/${id}/preview`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ email: previewEmail }),
      });
      const data = await res.json();
      if (data.success) showToast.success(`Preview enviado para ${previewEmail}`);
      else showToast.error("Falha ao enviar preview — verifique SMTP em Configurações");
    } catch { showToast.error("Erro ao enviar preview"); }
    finally { setPreviewSending(false); }
  };

  const handleSendCampaign = async () => {
    if (!editing) { showToast.error("Salve o rascunho primeiro"); return; }
    if (selectedEmails.size === 0) { showToast.error("Selecione pelo menos um destinatário"); return; }
    const recipientsList = [...selectedEmails].map((email) => ({ email, name: nameMap[email] || email }));
    setSendingId(editing.id);
    setConfirmSend(false);
    try {
      await fetch(`${import.meta.env.BASE_URL}api/email-campaigns/${editing.id}/send`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: recipientsList }),
      });
      showToast.success("Envio iniciado! O status será atualizado em breve.");
      setView("list");
      setTimeout(fetchCampaigns, 3000);
    } catch { showToast.error("Erro ao iniciar envio"); }
    finally { setSendingId(null); }
  };

  const statusBadge = (status: string) => {
    if (status === "sent") return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/30">Enviado</span>;
    if (status === "sending") return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 animate-pulse">Enviando...</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/5 text-muted-foreground border border-white/10">Rascunho</span>;
  };

  const allFilterOptions = [
    { value: "all", label: "Todos os clientes", icon: "👥" },
    ...FILTER_OPTIONS.filter((opt) => opt.value !== "all"),
    ...emailGroups.map((g) => ({ value: `group_${g.id}`, label: g.name, icon: "👥" })),
  ];

  const filterLabel = (f: string) => {
    const opt = allFilterOptions.find((o) => o.value === f);
    if (opt) return opt.label;
    if (f.startsWith("group_")) {
      const id = Number(f.replace("group_", ""));
      return emailGroups.find((g) => g.id === id)?.name ?? `Grupo #${id}`;
    }
    return f;
  };

  if (view === "editor") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setView("list")} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
            ← Voltar
          </button>
          <h2 className="text-2xl font-display font-bold">
            {editing ? "Editar Campanha" : "Nova Campanha"}
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Form */}
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-6 space-y-4">
              <h3 className="font-display text-lg uppercase tracking-wider text-foreground flex items-center gap-2"><Mail size={16} className="text-primary" /> Configurações</h3>
              <div>
                <Label>Nome interno (apenas para você)</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Promoção de Agosto" />
              </div>
              <div>
                <Label>Assunto do e-mail</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex: Novidades exclusivas para você!" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Destinatários</Label>
                  <div className="flex items-center gap-3 text-xs">
                    {selectedEmails.size > 0 && (
                      <>
                        <span className="font-bold text-primary">{selectedEmails.size} selecionado{selectedEmails.size !== 1 ? "s" : ""}</span>
                        <button onClick={selectAllLoaded} className="text-muted-foreground hover:text-foreground transition-colors">Sel. todos carregados</button>
                        <button onClick={clearAllSelections} className="text-red-400 hover:text-red-300 transition-colors flex items-center gap-0.5"><X size={10} /> Limpar</button>
                      </>
                    )}
                    {selectedEmails.size === 0 && (
                      <span className="text-muted-foreground">Expanda um grupo para selecionar</span>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {allFilterOptions.map((opt) => {
                    const isExpanded = expandedGroups.has(opt.value);
                    const isLoading = groupLoading[opt.value];
                    const group = groupData[opt.value];
                    const loaded = !!group;
                    const fullySelected = isGroupFullySelected(opt.value);
                    const partiallySelected = isGroupPartiallySelected(opt.value);
                    const selectedInGroup = (group ?? []).filter((r) => selectedEmails.has(r.email)).length;

                    return (
                      <div key={opt.value} className="rounded-lg border border-white/10 overflow-hidden">
                        {/* Group header */}
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-card hover:bg-white/5 transition-colors">
                          {/* Group-level checkbox */}
                          <button
                            type="button"
                            onClick={() => { if (fullySelected) deselectAllInGroup(opt.value); else selectAllInGroup(opt.value); }}
                            className="shrink-0 flex items-center justify-center w-5 h-5 rounded border transition-colors"
                            style={{
                              backgroundColor: fullySelected ? "hsl(var(--primary))" : partiallySelected ? "hsl(var(--primary)/0.3)" : "transparent",
                              borderColor: (fullySelected || partiallySelected) ? "hsl(var(--primary))" : "rgba(255,255,255,0.2)",
                            }}
                          >
                            {fullySelected && <Check size={11} className="text-background" />}
                            {partiallySelected && <div className="w-2.5 h-0.5 bg-foreground rounded-full" />}
                          </button>
                          {/* Expand / collapse button */}
                          <button
                            type="button"
                            onClick={() => toggleGroup(opt.value)}
                            className="flex-1 flex items-center gap-2 text-left min-w-0"
                          >
                            <span className="text-base shrink-0">{opt.icon}</span>
                            <span className="flex-1 text-sm font-medium truncate">{opt.label}</span>
                            {loaded && selectedInGroup > 0 && (
                              <span className="text-xs font-bold text-primary shrink-0">{selectedInGroup}/{group!.length}</span>
                            )}
                            {!loaded && !isLoading && (
                              <span className="text-xs text-muted-foreground shrink-0">Clique para carregar</span>
                            )}
                            {isLoading
                              ? <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0" />
                              : <ChevronDown size={14} className={cn("text-muted-foreground shrink-0 transition-transform", isExpanded && "rotate-180")} />
                            }
                          </button>
                        </div>

                        {/* Expanded list */}
                        {isExpanded && (
                          <div className="border-t border-white/10">
                            {/* Sub-header with actions */}
                            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
                              <span className="text-xs text-muted-foreground">{(group ?? []).length} pessoa{(group ?? []).length !== 1 ? "s" : ""}</span>
                              <div className="flex gap-4">
                                <button type="button" onClick={() => selectAllInGroup(opt.value)} className="text-xs text-primary hover:text-primary/80 font-medium transition-colors">
                                  Selecionar todos
                                </button>
                                <button type="button" onClick={() => deselectAllInGroup(opt.value)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                                  Desmarcar todos
                                </button>
                              </div>
                            </div>
                            {/* Recipients list */}
                            {(group ?? []).length === 0 ? (
                              <p className="px-4 py-4 text-xs text-muted-foreground text-center">Nenhum destinatário neste grupo.</p>
                            ) : (
                              <div className="max-h-52 overflow-y-auto">
                                {(group ?? []).map((r) => {
                                  const checked = selectedEmails.has(r.email);
                                  return (
                                    <label
                                      key={r.email}
                                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 cursor-pointer transition-colors border-b border-white/5 last:border-0"
                                    >
                                      <div
                                        className="shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors"
                                        style={{
                                          backgroundColor: checked ? "hsl(var(--primary))" : "transparent",
                                          borderColor: checked ? "hsl(var(--primary))" : "rgba(255,255,255,0.2)",
                                        }}
                                      >
                                        {checked && <Check size={9} className="text-background" />}
                                      </div>
                                      <input
                                        type="checkbox"
                                        className="sr-only"
                                        checked={checked}
                                        onChange={(e) => {
                                          setSelectedEmails((prev) => {
                                            const next = new Set(prev);
                                            if (e.target.checked) next.add(r.email);
                                            else next.delete(r.email);
                                            return next;
                                          });
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">{r.name}</div>
                                        <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg uppercase tracking-wider text-foreground flex items-center gap-2">
                  <Edit2 size={16} className="text-primary" /> Conteúdo do E-mail
                </h3>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-muted-foreground hidden md:block">
                    Use <code className="bg-white/10 px-1 rounded">{"{{nome}}"}</code> para personalizar
                  </p>
                  <button onClick={() => setShowPreview(!showPreview)} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Eye size={12} /> {showPreview ? "Editar" : "Preview HTML"}
                  </button>
                </div>
              </div>
              {showPreview ? (
                <div className="rounded-lg overflow-hidden border border-white/10">
                  <div className="bg-yellow-900/20 border-b border-yellow-500/20 px-3 py-1.5 text-xs text-yellow-400">
                    Preview — como aparece no email do destinatário
                  </div>
                  <div
                    className="bg-white text-black overflow-auto"
                    style={{ background: bgColor, padding: "32px" }}
                    dangerouslySetInnerHTML={{ __html: content }}
                  />
                </div>
              ) : (
                <EmailEditor
                  value={content}
                  onChange={setContent}
                  bgColor={bgColor}
                  onBgColorChange={setBgColor}
                />
              )}
            </Card>
          </div>

          {/* Right: Actions */}
          <div className="space-y-4">
            <Card className="p-6 space-y-4">
              <h3 className="font-display text-lg uppercase tracking-wider text-foreground flex items-center gap-2"><Send size={16} className="text-primary" /> Ações</h3>

              <Button variant="gold" className="w-full gap-2" onClick={handleSaveDraft} isLoading={saving}>
                <Save size={16} /> Salvar Rascunho
              </Button>

              {editing?.status === "sent" && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400 text-center">
                  ✅ Enviada para {editing.sentCount} pessoa{editing.sentCount !== 1 ? "s" : ""}
                  {editing.failedCount > 0 && <div className="text-red-400 mt-1">{editing.failedCount} falhas</div>}
                </div>
              )}

              {editing && (
                <>
                  {!confirmSend ? (
                    <Button
                      variant="outline"
                      className="w-full gap-2 border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
                      onClick={() => setConfirmSend(true)}
                    >
                      <Send size={16} /> {editing.status === "sent" ? "Reenviar Campanha" : "Enviar Campanha"}
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-3">
                      <div className="flex items-start gap-2 text-yellow-400 text-sm">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span>Enviar para <strong>{selectedEmails.size} pessoa{selectedEmails.size !== 1 ? "s" : ""}</strong>? Esta ação não pode ser desfeita.</span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1 text-xs border-white/20" onClick={() => setConfirmSend(false)}>Cancelar</Button>
                        <Button variant="gold" className="flex-1 text-xs gap-1" onClick={handleSendCampaign} isLoading={sendingId === editing.id}>
                          <Send size={12} /> Confirmar
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* Templates card */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base uppercase tracking-wider text-foreground flex items-center gap-2">
                  <Save size={14} className="text-primary" /> Templates
                </h3>
                <button
                  onClick={() => { setShowTemplates((v) => !v); if (!showTemplates && templates.length === 0) fetchTemplates(); }}
                  className="text-xs text-primary hover:underline"
                >
                  {showTemplates ? "Fechar" : `Ver (${templates.length})`}
                </button>
              </div>

              {/* Save current as template */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveAsTemplate(); }}
                  placeholder="Nome do template..."
                  className="flex-1 text-xs rounded-lg border border-white/10 bg-white/5 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Button variant="outline" size="sm" className="border-white/20 text-xs shrink-0" onClick={saveAsTemplate} isLoading={savingTemplate}>
                  Salvar
                </Button>
              </div>

              {/* Template list */}
              {showTemplates && (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {templatesLoading ? (
                    <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
                  ) : templates.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">Nenhum template salvo ainda.</p>
                  ) : (
                    templates.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{t.name}</p>
                          {t.subject && <p className="text-xs text-muted-foreground truncate">{t.subject}</p>}
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => loadTemplate(t)}
                            className="text-xs text-primary hover:underline"
                          >Usar</button>
                          <button
                            type="button"
                            onClick={() => deleteTemplate(t.id)}
                            className="text-xs text-red-400 hover:text-red-300"
                          ><Trash2 size={12} /></button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>

            <Card className="p-6 space-y-4">
              <h3 className="font-display text-lg uppercase tracking-wider text-foreground flex items-center gap-2"><Eye size={16} className="text-primary" /> Preview</h3>
              <p className="text-xs text-muted-foreground">Envie uma cópia de teste para verificar como o e-mail aparecerá antes do envio.</p>
              <Input
                value={previewEmail}
                onChange={(e) => setPreviewEmail(e.target.value)}
                placeholder="seu@email.com"
                type="email"
              />
              <Button variant="outline" className="w-full gap-2 border-white/20" onClick={handleSendPreview} isLoading={previewSending}>
                <Send size={16} /> Enviar Preview
              </Button>
            </Card>

            {editing && (
              <Card className="p-4 border-red-500/20">
                <button
                  onClick={() => { handleDelete(editing.id); setView("list"); }}
                  className="w-full text-xs text-red-400 hover:text-red-300 flex items-center justify-center gap-2 py-1"
                >
                  <Trash2 size={14} /> Excluir campanha
                </button>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-display font-bold">Email MKT</h2>
          <p className="text-muted-foreground text-sm mt-1">Crie e envie campanhas de e-mail para seus clientes</p>
        </div>
        <Button variant="gold" className="gap-2" onClick={openCreate}>
          <Plus size={16} /> Nova Campanha
        </Button>
      </div>

      {/* ── Grupos de E-mail ───────────────────────────────────────────── */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg uppercase tracking-wider text-foreground flex items-center gap-2">
            <Users size={16} className="text-primary" /> Grupos de Destinatários
          </h3>
          {groupsLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
        </div>

        {/* Create group */}
        <div className="flex gap-2">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Nome do novo grupo (ex: Jogadores de Beach Tennis)"
            onKeyDown={(e) => { if (e.key === "Enter") createEmailGroup(); }}
            className="flex-1"
          />
          <Button variant="gold" className="gap-2 shrink-0" onClick={createEmailGroup} isLoading={creatingGroup}>
            <Plus size={16} /> Criar
          </Button>
        </div>

        {/* Groups list */}
        {emailGroups.length === 0 && !groupsLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum grupo criado ainda. Crie um grupo para organizar destinatários personalizados.</p>
        ) : (
          <div className="space-y-2">
            {emailGroups.map((g) => (
              <div key={g.id} className="rounded-lg border border-white/10 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-card">
                  <span className="text-base">👥</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{g.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{g.memberCount} membro{g.memberCount !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => managingGroup?.id === g.id ? setManagingGroup(null) : openManageGroup(g)}
                      className="text-xs text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded border border-primary/30 hover:bg-primary/10"
                    >
                      {managingGroup?.id === g.id ? "Fechar" : "Gerenciar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteEmailGroup(g.id)}
                      className="text-red-400 hover:text-red-300 transition-colors p-1"
                      title="Excluir grupo"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Inline management panel */}
                {managingGroup?.id === g.id && (
                  <div className="border-t border-white/10 bg-background/50 p-4 space-y-4">
                    {/* Add members */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                        Adicionar e-mails
                      </label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Um por linha. Formatos aceitos: <code className="bg-white/5 px-1 rounded">email@ex.com</code>, <code className="bg-white/5 px-1 rounded">Nome &lt;email&gt;</code> ou <code className="bg-white/5 px-1 rounded">Nome: email</code>
                      </p>
                      <textarea
                        value={memberInput}
                        onChange={(e) => setMemberInput(e.target.value)}
                        rows={4}
                        placeholder={"joao@exemplo.com\nMaria Silva <maria@exemplo.com>\nCarlos: carlos@exemplo.com"}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none font-mono"
                      />
                      <Button variant="gold" size="sm" className="mt-2 gap-2" onClick={addGroupMembers} isLoading={addingMembers}>
                        <Plus size={14} /> Adicionar
                      </Button>
                    </div>

                    {/* Members list */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                        Membros ({groupMembers.length})
                      </label>
                      {groupMembersLoading ? (
                        <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                          <Loader2 size={14} className="animate-spin" /> Carregando...
                        </div>
                      ) : groupMembers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum membro ainda.</p>
                      ) : (
                        <div className="max-h-60 overflow-y-auto space-y-1">
                          {groupMembers.map((m) => (
                            <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 group/member">
                              <div className="flex-1 min-w-0">
                                {m.name && <div className="text-sm font-medium truncate">{m.name}</div>}
                                <div className={`text-xs truncate ${m.name ? "text-muted-foreground" : "text-sm text-foreground"}`}>{m.email}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeGroupMember(m.id)}
                                className="opacity-0 group-hover/member:opacity-100 text-red-400 hover:text-red-300 transition-all p-1 shrink-0"
                                title="Remover"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {/* ───────────────────────────────────────────────────────────────── */}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => <div key={i} className="h-32 bg-card rounded-xl animate-pulse" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="p-16 text-center border-dashed border-white/10">
          <Mail size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">Nenhuma campanha criada ainda</p>
          <p className="text-muted-foreground/60 text-sm mt-1">Crie sua primeira campanha de e-mail marketing</p>
          <Button variant="gold" className="mt-6 gap-2" onClick={openCreate}><Plus size={16} /> Nova Campanha</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map((c) => (
            <Card key={c.id} className="p-5 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {statusBadge(c.status)}
                  </div>
                  <h3 className="font-bold text-foreground truncate">{c.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.subject}</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1 mb-4">
                <div className="flex items-center gap-1.5">
                  <Users size={11} />
                  <span>{filterLabel(c.filter)}</span>
                </div>
                {c.status === "sent" && (
                  <div className="flex items-center gap-3">
                    <span className="text-green-400">✓ {c.sentCount} enviados</span>
                    {c.failedCount > 0 && <span className="text-red-400">✗ {c.failedCount} falhas</span>}
                  </div>
                )}
                {c.sentAt && <div>Enviado em {new Date(c.sentAt).toLocaleDateString("pt-BR")}</div>}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1 border-white/10 text-xs"
                  onClick={() => openEdit(c)}
                >
                  <Edit2 size={12} /> {c.status === "sent" ? "Ver" : "Editar"}
                </Button>
                {c.status === "draft" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3"
                    onClick={() => handleDelete(c.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
