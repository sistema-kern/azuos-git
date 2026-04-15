import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Input, Label, Badge } from "@/components/ui";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { showToast, showConfirm } from "@/lib/toast";
import { Users, Plus, Trash2, X, CalendarDays, Phone, MessageCircle, Edit2, QrCode, Copy, Eye } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";

type Client = {
  id: number;
  name: string;
  email: string;
  phone: string;
  cpf?: string | null;
  notes?: string;
  address?: { cep: string; street: string; number: string; complement?: string; neighborhood: string; state: string } | null;
  active: boolean;
  createdAt: string;
};

type MonthlyPlan = {
  id: number;
  clientId: number;
  type: "court" | "class";
  courtNumber?: number;
  durationHours?: number;
  numberOfPeople?: number;
  dayOfWeek: number;
  time: string;
  monthlyPrice: string;
  status: "active" | "inactive" | "pending_payment";
  paymentExpiresAt?: string | null;
  paymentDueSoon?: boolean;
  lastBookingOfMonth?: string | null;
  sessionsThisMonth?: number;
};

type PlanLog = {
  id: number;
  monthlyPlanId: number;
  month: string;
  status: "paid" | "pending" | "cancelled";
  paymentMethod?: string | null;
  paidAt?: string | null;
};

type PlanPreview = {
  dates: string[];
  count: number;
  pricePerSession: number;
  suggestedPrice: number;
  conflicts: string[];
  dayName: string;
  targetMonth: string | null; // "YYYY-MM"
};

const dayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const formatDateBR = (dateStr: string) => {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
};

const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

const getPhoneWithoutMask = (phone: string): string => {
  return phone.replace(/\D/g, "");
};

const maskCPF = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
};

const getCPFWithoutMask = (cpf: string): string => {
  return cpf.replace(/\D/g, "");
};

export function AdminClientes() {
  const { getAuthHeaders } = useAdminAuth();
  const { profile } = useCompanyProfile();
  const beachTennisHidden = (() => { try { return JSON.parse(profile.nav_hidden ?? "[]").includes("/beach-tennis"); } catch { return false; } })();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pixKey, setPixKey] = useState("");
  const [isAddingClient, setIsAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientCpf, setNewClientCpf] = useState("");
  const [newClientNotes, setNewClientNotes] = useState("");
  const [newClientCep, setNewClientCep] = useState("");
  const [newClientStreet, setNewClientStreet] = useState("");
  const [newClientNumber, setNewClientNumber] = useState("");
  const [newClientComplement, setNewClientComplement] = useState("");
  const [newClientNeighborhood, setNewClientNeighborhood] = useState("");
  const [newClientState, setNewClientState] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  // Filters
  const [filterName, setFilterName] = useState("");
  const [filterCpf, setFilterCpf] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "plan_pending" | "plan_active" | "plan_active_awaiting" | "plan_inactive">("all");
  const [filterPlanDayOfWeek, setFilterPlanDayOfWeek] = useState<string>("all");
  const [filterPlanTime, setFilterPlanTime] = useState("");

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientPlans, setClientPlans] = useState<MonthlyPlan[]>([]);
  const [planLogs, setPlanLogs] = useState<Record<number, PlanLog[]>>({});
  const [isAddingPlan, setIsAddingPlan] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Edit client
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editClientName, setEditClientName] = useState("");
  const [editClientEmail, setEditClientEmail] = useState("");
  const [editClientPhone, setEditClientPhone] = useState("");
  const [editClientCpf, setEditClientCpf] = useState("");
  const [editClientNotes, setEditClientNotes] = useState("");
  const [editClientLoading, setEditClientLoading] = useState(false);

  // Edit plan
  const [editingPlan, setEditingPlan] = useState<MonthlyPlan | null>(null);
  const [editPlanPrice, setEditPlanPrice] = useState("");
  const [editPlanLoading, setEditPlanLoading] = useState(false);
  const [togglingPlanStatus, setTogglingPlanStatus] = useState<number | null>(null);

  // View plan details
  const [viewingPlan, setViewingPlan] = useState<MonthlyPlan | null>(null);
  const [planBookings, setPlanBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [activatingPlanFromModal, setActivatingPlanFromModal] = useState(false);

  // Payment
  const [paymentPlan, setPaymentPlan] = useState<{ planId: number; qrCodeUrl?: string; pixQrCode?: string; preferenceId?: string } | null>(null);
  const [generatingPayment, setGeneratingPayment] = useState(false);

  // Plan form fields
  const [planType, setPlanType] = useState<"court" | "class">("court");
  const [planDayOfWeek, setPlanDayOfWeek] = useState(1);
  const [planTime, setPlanTime] = useState("08:30");
  const [planPrice, setPlanPrice] = useState("");
  const [planPriceEdited, setPlanPriceEdited] = useState(false); // tracks if admin manually edited price
  const [planCourtNumber, setPlanCourtNumber] = useState(1);
  const [planDuration, setPlanDuration] = useState(1);
  const [planExtraMinutes, setPlanExtraMinutes] = useState(0);
  const [planNumberOfPeople, setPlanNumberOfPeople] = useState(1);
  const [availableHours, setAvailableHours] = useState<string[]>([]);

  // Preview data (price calculation only)
  const [planPreview, setPlanPreview] = useState<PlanPreview | null>(null);

  // Conflict confirmation modal before plan creation
  const [conflictModal, setConflictModal] = useState<{
    conflictCount: number;
    availableCount: number;
    conflictingDates: string[]; // YYYY-MM-DD format
  } | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadClients = useCallback(async (opts: { q?: string; page?: number; append?: boolean; limit?: number; planStatus?: string; planDayOfWeek?: string; planTime?: string; nearEnd?: boolean } = {}): Promise<Client[]> => {
    const { q = "", page = 1, append = false, limit = 50, planStatus, planDayOfWeek, planTime, nearEnd } = opts;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (q) params.set("q", q);
      if (planStatus) params.set("planStatus", planStatus);
      if (planDayOfWeek && planDayOfWeek !== "all") params.set("planDayOfWeek", planDayOfWeek);
      if (planTime) params.set("planTime", planTime);
      if (nearEnd) params.set("nearEnd", "true");
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients?${params}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const list: Client[] = data.clients ?? data;
        setTotalClients(data.total ?? list.length);
        setTotalPages(data.totalPages ?? 1);
        setCurrentPage(data.page ?? 1);
        if (append) {
          setClients(prev => [...prev, ...list]);
        } else {
          setClients(list);
        }
        return list;
      }
    } catch {
      showToast.error("Erro ao carregar clientes");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
    return [];
  }, [getAuthHeaders]);

  useEffect(() => {
    loadClients();
    fetch(`${import.meta.env.BASE_URL}api/settings/pix-key`)
      .then(r => r.json())
      .then((d: { pix_key?: string }) => { if (d.pix_key) setPixKey(d.pix_key); })
      .catch(() => {});
  }, []);

  // ── Load configured hours based on court + day of week (admin schedule) ──
  useEffect(() => {
    if (!isAddingPlan) return;
    const fetchAvailableHours = async () => {
      try {
        const authHeaders = getAuthHeaders();
        let url: string;
        if (planType === "court") {
          url = `${import.meta.env.BASE_URL}api/clients/court-hours?courtNumber=${planCourtNumber}&dayOfWeek=${planDayOfWeek}`;
        } else {
          // Beach tennis: use general court-hours without court number
          url = `${import.meta.env.BASE_URL}api/clients/court-hours?dayOfWeek=${planDayOfWeek}`;
        }
        const res = await fetch(url, { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          const hours: string[] = data.slots || [];
          setAvailableHours(hours);
          if (hours.length > 0 && !hours.includes(planTime)) {
            setPlanTime(hours[0]);
          }
        }
      } catch {
        // Fallback: standard hours
        const hours: string[] = [];
        for (let h = 8; h < 22; h++) {
          hours.push(`${String(h).padStart(2, "0")}:00`);
        }
        setAvailableHours(hours);
      }
    };
    fetchAvailableHours();
  }, [isAddingPlan, planType, planCourtNumber, planDayOfWeek]);

  const loadClientPlans = async (clientId: number) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients/${clientId}/plans`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data: MonthlyPlan[] = await res.json();
        setClientPlans(data);
        // Fetch payment logs for all plans in parallel
        const logsArr = await Promise.all(
          data.map(plan =>
            fetch(`${import.meta.env.BASE_URL}api/clients/${clientId}/plans/${plan.id}/logs`, {
              headers: getAuthHeaders(),
            }).then(r => r.ok ? r.json() : []).catch(() => [])
          )
        );
        const logsMap: Record<number, PlanLog[]> = {};
        data.forEach((plan, i) => { logsMap[plan.id] = logsArr[i] ?? []; });
        setPlanLogs(logsMap);
      }
    } catch {
      /* silent */
    }
  };


  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
    loadClientPlans(client.id);
  };

  // Check if near month end (for filtering and display)
  const isNearMonthEnd = (): boolean => {
    if (typeof window !== "undefined" && localStorage.getItem("DEBUG_NEAR_MONTH_END") === "true") {
      return true;
    }
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() >= lastDay - 7;
  };

  const getNextMonthKey = (): string => {
    const now = new Date();
    const nextM = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    const nextY = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    return `${nextY}-${String(nextM + 1).padStart(2, "0")}`;
  };

  const isNextMonthPaid = (planId: number): boolean => {
    const logs = planLogs[planId] ?? [];
    const key = getNextMonthKey();
    return logs.some(l => l.month === key && l.status === "paid");
  };

  const formatMonthLabel = (monthKey: string): string => {
    const [y, m] = monthKey.split("-");
    return `${monthNames[Number(m) - 1]}/${y}`;
  };

  // ── Fetch plan preview for price suggestion only ──
  const fetchPreview = useCallback(async (
    type: "court" | "class",
    dayOfWeek: number,
    time: string,
    courtNumber: number,
    durationHours: number,
    extraMinutes: number,
    numberOfPeople: number,
    clientId: number,
    authHeaders: ReturnType<typeof getAuthHeaders>,
  ) => {
    if (!time) return;
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams({
        type,
        dayOfWeek: String(dayOfWeek),
        time,
        courtNumber: String(courtNumber),
        durationHours: String(durationHours),
        extraMinutes: String(extraMinutes),
        numberOfPeople: String(numberOfPeople),
      });
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/clients/${clientId}/plans/preview?${params.toString()}`,
        { headers: authHeaders }
      );
      if (res.ok) {
        const preview: PlanPreview = await res.json();
        setPlanPreview(preview);

        // Auto-fill: pricePerSession × total duration = valor por sessão completa
        if (!planPriceEdited && preview.pricePerSession > 0) {
          const totalDuration = type === "court" ? durationHours + extraMinutes / 60 : 1;
          const priceForSession = preview.pricePerSession * totalDuration;
          setPlanPrice(String(Math.round(priceForSession * 100) / 100));
        }
      }
    } catch {
      /* silent */
    } finally {
      setPreviewLoading(false);
    }
  }, [planPriceEdited]);

  // Trigger preview whenever relevant fields change and modal is open
  useEffect(() => {
    if (!isAddingPlan || !selectedClient) return;
    
    const authHeaders = getAuthHeaders();
    const timer = setTimeout(() => {
      fetchPreview(planType, planDayOfWeek, planTime, planCourtNumber, planDuration, planExtraMinutes, planNumberOfPeople, selectedClient.id, authHeaders);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [isAddingPlan, planType, planDayOfWeek, planTime, planCourtNumber, planDuration, planExtraMinutes, planNumberOfPeople, selectedClient, fetchPreview]);

  const handleFetchCep = async (cep: string) => {
    const clean = cep.replace(/\D/g, "");
    if (clean.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (data.erro) { showToast.error("CEP não encontrado"); setCepLoading(false); return; }
      setNewClientStreet(data.logradouro || "");
      setNewClientNeighborhood(data.bairro || "");
      setNewClientState(data.uf || "");
    } catch {
      showToast.error("Erro ao buscar CEP");
    } finally {
      setCepLoading(false);
    }
  };

  const handleAddClient = async () => {
    if (!newClientName.trim()) {
      showToast.error("Nome é obrigatório");
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          name: newClientName.trim(),
          email: newClientEmail.trim(),
          phone: getPhoneWithoutMask(newClientPhone),
          cpf: getCPFWithoutMask(newClientCpf),
          notes: newClientNotes.trim() || null,
          address: {
            cep: newClientCep.replace(/\D/g, ""),
            street: newClientStreet.trim(),
            number: newClientNumber.trim(),
            complement: newClientComplement.trim() || undefined,
            neighborhood: newClientNeighborhood.trim(),
            state: newClientState.trim(),
          },
        }),
      });

      if (res.ok) {
        showToast.success("Cliente criado com sucesso!");
        setNewClientName("");
        setNewClientEmail("");
        setNewClientPhone("");
        setNewClientCpf("");
        setNewClientNotes("");
        setNewClientCep("");
        setNewClientStreet("");
        setNewClientNumber("");
        setNewClientComplement("");
        setNewClientNeighborhood("");
        setNewClientState("");
        setIsAddingClient(false);
        await loadClients({ q: filterName });
      } else {
        showToast.error("Erro ao criar cliente");
      }
    } catch {
      showToast.error("Erro ao criar cliente");
    }
  };

  const handleDeleteClient = async (clientId: number) => {
    const confirmed = await showConfirm("Tem certeza que deseja deletar este cliente?");
    if (!confirmed) return;

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients/${clientId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        showToast.success("Cliente deletado com sucesso!");
        await loadClients({ q: filterName });
        if (selectedClient?.id === clientId) {
          setSelectedClient(null);
          setClientPlans([]);
        }
      } else {
        showToast.error("Erro ao deletar cliente");
      }
    } catch {
      showToast.error("Erro ao deletar cliente");
    }
  };

  const handleEditClient = (client: Client) => {
    setEditingClient(client);
    setEditClientName(client.name);
    setEditClientEmail(client.email);
    setEditClientPhone(client.phone);
    setEditClientCpf(client.cpf || "");
    setEditClientNotes(client.notes || "");
  };

  const handleSaveClient = async () => {
    if (!editingClient || !editClientName.trim()) {
      showToast.error("Nome é obrigatório");
      return;
    }

    setEditClientLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients/${editingClient.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          name: editClientName.trim(),
          email: editClientEmail.trim(),
          phone: getPhoneWithoutMask(editClientPhone),
          cpf: editClientCpf.trim() ? getCPFWithoutMask(editClientCpf) : null,
          notes: editClientNotes.trim() || null,
        }),
      });

      if (res.ok) {
        showToast.success("Cliente atualizado!");
        setEditingClient(null);
        await loadClients({ q: filterName });
        if (selectedClient?.id === editingClient.id) {
          const updated = await res.json();
          setSelectedClient(updated);
        }
      } else {
        showToast.error("Erro ao atualizar cliente");
      }
    } catch {
      showToast.error("Erro ao atualizar cliente");
    } finally {
      setEditClientLoading(false);
    }
  };

  const handleEditPlan = (plan: MonthlyPlan) => {
    // If plan is active, open renewal form; otherwise edit price
    if (plan.status === "active") {
      handlePreFillRenewalPlan(plan);
    } else {
      setEditingPlan(plan);
      setEditPlanPrice(plan.monthlyPrice);
    }
  };

  const handleSavePlan = async () => {
    if (!editingPlan || !editPlanPrice.trim() || isNaN(Number(editPlanPrice)) || Number(editPlanPrice) <= 0) {
      showToast.error("Informe um valor válido");
      return;
    }

    setEditPlanLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients/${selectedClient?.id}/plans/${editingPlan.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ monthlyPrice: editPlanPrice }),
      });

      if (res.ok) {
        showToast.success("Plano atualizado!");
        setEditingPlan(null);
        if (selectedClient) {
          await loadClientPlans(selectedClient.id);
        }
      } else {
        showToast.error("Erro ao atualizar plano");
      }
    } catch {
      showToast.error("Erro ao atualizar plano");
    } finally {
      setEditPlanLoading(false);
    }
  };

  const handleDeletePlan = async (planId: number) => {
    const confirmed = await showConfirm("Tem certeza que deseja deletar este plano?");
    if (!confirmed) return;

    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients/${selectedClient?.id}/plans/${planId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        showToast.success("Plano deletado!");
        if (selectedClient) {
          await loadClientPlans(selectedClient.id);
        }
      } else {
        showToast.error("Erro ao deletar plano");
      }
    } catch {
      showToast.error("Erro ao deletar plano");
    }
  };

  const handlePreFillRenewalPlan = (plan: MonthlyPlan) => {
    // Fill the form with the existing plan's data
    setPlanType(plan.type);
    setPlanDayOfWeek(plan.dayOfWeek);
    setPlanTime(plan.time as string);
    if (plan.type === "court") {
      setPlanCourtNumber(plan.courtNumber || 1);
      setPlanDuration(plan.durationHours || 1);
    } else {
      setPlanNumberOfPeople(plan.numberOfPeople || 1);
    }
    setPlanPrice(plan.monthlyPrice);
    setPlanPriceEdited(true); // Mark as edited so it doesn't get auto-calculated
    setIsAddingPlan(true); // Open the form
  };

  const loadPlanBookings = async (clientId: number, planId: number) => {
    setLoadingBookings(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/clients/${clientId}/plans/${planId}/bookings`,
        { headers: getAuthHeaders() }
      );
      if (res.ok) {
        const bookings = await res.json();
        setPlanBookings(bookings);
      }
    } catch (err) {
      console.error("Erro ao carregar reservas:", err);
    } finally {
      setLoadingBookings(false);
    }
  };

  const handleTogglePlanStatus = async (plan: MonthlyPlan) => {
    const newStatus = plan.status === "active" ? "inactive" : "active";
    setTogglingPlanStatus(plan.id);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients/${selectedClient?.id}/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        showToast.success(`Plano ${newStatus === "active" ? "ativado" : "desativado"}!`);
        if (selectedClient) {
          await loadClientPlans(selectedClient.id);
        }
      } else {
        showToast.error("Erro ao atualizar status");
      }
    } catch {
      showToast.error("Erro ao atualizar status");
    } finally {
      setTogglingPlanStatus(null);
    }
  };

  const handleActivatePlanFromModal = async () => {
    if (!viewingPlan || !selectedClient) return;
    setActivatingPlanFromModal(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/clients/${selectedClient.id}/plans/${viewingPlan.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ status: "active" }),
        }
      );

      if (res.ok) {
        const updated = await res.json();
        setViewingPlan(updated);
        showToast.success("Plano ativado! Gerando reservas...");
        await loadClientPlans(selectedClient.id);
        await loadPlanBookings(selectedClient.id, viewingPlan.id);
      } else {
        const data = await res.json().catch(() => ({}));
        showToast.error(data.error || "Erro ao ativar plano");
      }
    } catch {
      showToast.error("Erro ao ativar plano");
    } finally {
      setActivatingPlanFromModal(false);
    }
  };

  const resolvePlanStatus = (fs: string): string => {
    if (fs === "plan_pending") return "pending_payment";
    if (fs === "plan_active_awaiting") return "active_awaiting";
    return fs.replace("plan_", "");
  };

  // When filter status changes: use server-side plan filtering or text search
  useEffect(() => {
    if (filterStatus.startsWith("plan_")) {
      const planStatus = resolvePlanStatus(filterStatus);
      const q = filterCpf ? getCPFWithoutMask(filterCpf) : filterName;
      const nearEnd = planStatus === "active_awaiting" ? isNearMonthEnd() : undefined;
      loadClients({ q: q || undefined, planStatus, planDayOfWeek: filterPlanDayOfWeek, planTime: filterPlanTime, nearEnd });
    } else {
      const q = filterCpf ? getCPFWithoutMask(filterCpf) : filterName;
      loadClients({ q });
    }
  }, [filterStatus, filterPlanDayOfWeek, filterPlanTime]);

  // Debounce search when filterName or filterCpf changes
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      const q = filterCpf ? getCPFWithoutMask(filterCpf) : filterName;
      if (filterStatus.startsWith("plan_")) {
        const planStatus = resolvePlanStatus(filterStatus);
        const nearEnd = planStatus === "active_awaiting" ? isNearMonthEnd() : undefined;
        loadClients({ q: q || undefined, planStatus, planDayOfWeek: filterPlanDayOfWeek, planTime: filterPlanTime, nearEnd });
      } else {
        loadClients({ q });
      }
    }, 400);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [filterName, filterCpf]);

  const timeMatchesFilter = (time: string, filterTime: string) => {
    if (!filterTime) return true;
    return time.startsWith(filterTime);
  };

  // Filter clients — server handles all filtering (plan status, name/cpf search, day/time)
  // Client-side filtering only needed for debounced name/cpf when plan filter is active
  const filteredClients = clients;

  const handleGeneratePayment = async (plan: MonthlyPlan) => {
    if (!selectedClient) return;
    setGeneratingPayment(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/clients/${selectedClient.id}/plans/${plan.id}/generate-payment`,
        {
          method: "POST",
          headers: getAuthHeaders(),
        }
      );

      if (res.ok) {
        const data = await res.json();
        setPaymentPlan({
          planId: plan.id,
          qrCodeUrl: data.qrCodeUrl,
          pixQrCode: data.pixQrCode,
          preferenceId: data.preferenceId,
        });
        // Update local plan state with new expiry time for countdown
        if (data.paymentExpiresAt) {
          setClientPlans(prev => prev.map(p =>
            p.id === plan.id ? { ...p, paymentExpiresAt: data.paymentExpiresAt } : p
          ));
        }
      } else {
        showToast.error("Erro ao gerar pagamento");
      }
    } catch {
      showToast.error("Erro ao gerar pagamento");
    } finally {
      setGeneratingPayment(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!selectedClient || !paymentPlan) return;
    setGeneratingPayment(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/clients/${selectedClient.id}/plans/${paymentPlan.planId}/mark-paid`,
        {
          method: "POST",
          headers: getAuthHeaders(),
        }
      );

      if (res.ok) {
        showToast.success("Plano marcado como pago!");
        setPaymentPlan(null);
        // Refresh the plans list
        if (selectedClient) {
          await loadClientPlans(selectedClient.id);
        }
      } else {
        showToast.error("Erro ao marcar como pago");
      }
    } catch {
      showToast.error("Erro ao marcar como pago");
    } finally {
      setGeneratingPayment(false);
    }
  };

  const buildPlanPayload = (extra?: Record<string, unknown>) => ({
    type: planType,
    courtNumber: planType === "court" ? planCourtNumber : undefined,
    durationHours: planType === "court" ? planDuration : undefined,
    extraMinutes: planType === "court" ? planExtraMinutes : 0,
    numberOfPeople: planType === "class" ? planNumberOfPeople : undefined,
    dayOfWeek: planDayOfWeek,
    time: planTime,
    monthlyPrice: planPrice, // already includes duration multiplier from auto-fill
    ...extra,
  });

  const doCreatePlan = async () => {
    if (!selectedClient) return;
    setConflictModal(null);
    setPlanLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/clients/${selectedClient.id}/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(buildPlanPayload()),
      });
      if (res.ok) {
        const data = await res.json();
        showToast.success(data.message || `Plano criado com ${data.bookingIds.length} reserva(s)!`);
        setIsAddingPlan(false);
        resetPlanForm();
        await loadClientPlans(selectedClient.id);
      } else {
        const errorData = await res.json();
        showToast.error(errorData.error || "Erro ao criar plano");
      }
    } catch {
      showToast.error("Erro ao criar plano");
    } finally {
      setPlanLoading(false);
    }
  };

  const handleCreatePlan = async () => {
    if (!selectedClient) return;
    if (!planPrice.trim() || isNaN(Number(planPrice)) || Number(planPrice) <= 0) {
      showToast.error("Informe um valor por sessão válido");
      return;
    }

    setPlanLoading(true);
    try {
      // Step 1: dry-run to check for conflicts across the full year
      const checkRes = await fetch(`${import.meta.env.BASE_URL}api/clients/${selectedClient.id}/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(buildPlanPayload({ checkOnly: true })),
      });

      if (!checkRes.ok) {
        const err = await checkRes.json();
        showToast.error(err.error || "Erro ao verificar disponibilidade");
        setPlanLoading(false);
        return;
      }

      const checkData = await checkRes.json();

      if (checkData.conflictCount > 0) {
        // Show confirmation modal with conflicting dates
        setPlanLoading(false);
        setConflictModal({ 
          conflictCount: checkData.conflictCount, 
          availableCount: checkData.availableCount,
          conflictingDates: checkData.conflictingDates || [],
        });
        return;
      }

      // No conflicts — proceed directly
      await doCreatePlan();
    } catch (err) {
      showToast.error("Erro ao criar plano");
      setPlanLoading(false);
    }
  };

  const resetPlanForm = () => {
    setPlanType("court");
    setPlanDayOfWeek(1);
    setPlanTime("08:30");
    setPlanPrice("");
    setPlanPriceEdited(false);
    setPlanCourtNumber(1);
    setPlanDuration(1);
    setPlanExtraMinutes(0);
    setPlanNumberOfPeople(1);
    setPlanPreview(null);
    setConflictModal(null);
  };

  const openAddPlan = () => {
    resetPlanForm();
    setIsAddingPlan(true);
  };

  // Count how many times a weekday occurs in a given calendar month
  const countWeekdayInMonth = (dayOfWeek: number, year: number, month: number): number => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, month, d).getDay() === dayOfWeek) count++;
    }
    return count;
  };

  // Shorthand for current month
  const countWeekdayInCurrentMonth = (dayOfWeek: number): number => {
    const now = new Date();
    return countWeekdayInMonth(dayOfWeek, now.getFullYear(), now.getMonth());
  };

  // Get next month info helpers
  const getNextMonthInfo = () => {
    const now = new Date();
    const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
    const nextYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    return { nextMonth, nextYear, nextMonthName: monthNames[nextMonth] };
  };

  // Format duration: 1 → "1h", 1.5 → "1h30", 2.5 → "2h30"
  const formatDuration = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (m === 0) return `${h}h`;
    return `${h}h${m}`;
  };

  // Calculate end time string: "21:00" + 2.5h → "23:30"
  const calcEndTime = (time: string, durationHours: number): string => {
    const [h, m] = time.split(":").map(Number);
    const totalMins = h * 60 + m + Math.round(durationHours * 60);
    const endH = Math.floor(totalMins / 60);
    const endM = totalMins % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  };

  const conflictModalJSX = conflictModal ? createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[80vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-3">Horários já reservados</h3>
        
        {conflictModal.conflictingDates && conflictModal.conflictingDates.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-xs text-yellow-400 font-bold mb-2">Conflitos encontrados:</p>
            <div className="space-y-1">
              {conflictModal.conflictingDates.map((dateStr) => {
                const [year, month, day] = dateStr.split("-").map(Number);
                const date = new Date(year, month - 1, day);
                const dayName = dayNames[date.getDay()];
                const monthName = monthNames[date.getMonth()];
                return (
                  <p key={dateStr} className="text-xs text-yellow-300">
                    • {dayName} {day} de {monthName} às {planTime} — não será cobrado
                  </p>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground mb-4">
          <span className="text-yellow-400 font-bold">{conflictModal.conflictCount}</span>{" "}
          {conflictModal.conflictCount === 1 ? "data neste ano já tem" : "datas neste ano já têm"} esse horário reservado e{" "}
          {conflictModal.conflictCount === 1 ? "será ignorada" : "serão ignoradas"}.
          {" "}O plano será criado com as{" "}
          <span className="text-green-400 font-bold">{conflictModal.availableCount}</span>{" "}
          datas restantes.
        </p>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setConflictModal(null)}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1"
            isLoading={planLoading}
            onClick={doCreatePlan}
          >
            Criar mesmo assim
          </Button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      {conflictModalJSX}
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Clients List */}
        <Card className="lg:col-span-1 p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg md:text-xl font-bold flex items-center gap-2">
              <Users size={20} />
              Clientes
            </h2>
            <Button
              onClick={() => setIsAddingClient(true)}
              className="gap-1 text-xs md:text-sm px-2 md:px-4"
            >
              <Plus size={16} /> Novo
            </Button>
          </div>

          {/* Add Client Modal */}
          {isAddingClient && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-card border border-white/10 rounded-lg p-6 w-96 max-w-[90vw]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-lg">Novo Cliente</h3>
                  <button onClick={() => setIsAddingClient(false)}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-3">
                  <Input
                    placeholder="Nome completo"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    className="bg-secondary border-white/10"
                  />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                    className="bg-secondary border-white/10"
                  />
                  <Input
                    placeholder="Telefone"
                    value={maskPhone(newClientPhone)}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                    className="bg-secondary border-white/10"
                  />
                  <Input
                    placeholder="CPF"
                    value={maskCPF(newClientCpf)}
                    onChange={(e) => setNewClientCpf(e.target.value)}
                    className="bg-secondary border-white/10"
                  />
                  <div className="border-t border-white/10 pt-3 mt-3">
                    <p className="text-xs text-muted-foreground mb-2">Endereço:</p>
                    <Input
                      placeholder="CEP"
                      maxLength="9"
                      value={newClientCep}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 8);
                        const formatted = val.length > 5 ? val.slice(0, 5) + "-" + val.slice(5) : val;
                        setNewClientCep(formatted);
                      }}
                      onBlur={() => newClientCep.replace(/\D/g, "").length === 8 && handleFetchCep(newClientCep)}
                      disabled={cepLoading}
                      className="bg-secondary border-white/10"
                    />
                    {newClientCep && (
                      <>
                        <Input
                          placeholder="Rua"
                          value={newClientStreet}
                          onChange={(e) => setNewClientStreet(e.target.value)}
                          disabled={cepLoading}
                          className="bg-secondary border-white/10 mt-2"
                        />
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <Input
                            placeholder="Número"
                            value={newClientNumber}
                            onChange={(e) => setNewClientNumber(e.target.value)}
                            disabled={cepLoading}
                            className="bg-secondary border-white/10"
                          />
                          <Input
                            placeholder="Complemento"
                            value={newClientComplement}
                            onChange={(e) => setNewClientComplement(e.target.value)}
                            disabled={cepLoading}
                            className="bg-secondary border-white/10"
                          />
                        </div>
                        <Input
                          placeholder="Bairro"
                          value={newClientNeighborhood}
                          onChange={(e) => setNewClientNeighborhood(e.target.value)}
                          disabled={cepLoading}
                          className="bg-secondary border-white/10 mt-2"
                        />
                        <Input
                          placeholder="Estado (UF)"
                          maxLength="2"
                          value={newClientState}
                          onChange={(e) => setNewClientState(e.target.value.toUpperCase())}
                          disabled={cepLoading}
                          className="bg-secondary border-white/10 mt-2"
                        />
                      </>
                    )}
                  </div>
                  <textarea
                    placeholder="Notas (opcional)"
                    value={newClientNotes}
                    onChange={(e) => setNewClientNotes(e.target.value)}
                    className="bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground text-sm w-full"
                    rows={3}
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <Button onClick={() => setIsAddingClient(false)} variant="outline" className="flex-1">
                    Cancelar
                  </Button>
                  <Button onClick={handleAddClient} className="flex-1">
                    Criar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="space-y-3 mb-4 pb-3 border-b border-white/10">
            <Input
              placeholder="Filtrar por nome..."
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="bg-secondary border-white/10 text-sm h-9"
            />
            <div className="flex gap-2">
              <Input
                placeholder="Filtrar por CPF..."
                value={maskCPF(filterCpf)}
                onChange={(e) => setFilterCpf(e.target.value)}
                className="bg-secondary border-white/10 text-sm h-9 flex-1"
              />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="bg-secondary border border-white/10 text-foreground text-sm px-3 py-2 rounded-lg"
              >
                <option value="all">Todos</option>
                <option value="plan_pending">Plano Pendente</option>
                <option value="plan_active">Plano Ativo</option>
                <option value="plan_active_awaiting">Ativo - Aguardando próx. pgto</option>
                <option value="plan_inactive">Plano Inativo</option>
              </select>
            </div>
            {filterStatus.startsWith("plan_") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={filterPlanDayOfWeek}
                  onChange={(e) => setFilterPlanDayOfWeek(e.target.value)}
                  className="bg-secondary border border-white/10 text-foreground text-sm px-3 py-2 rounded-lg"
                >
                  <option value="all">Todos os dias</option>
                  <option value="0">Domingo</option>
                  <option value="1">Segunda-feira</option>
                  <option value="2">Terça-feira</option>
                  <option value="3">Quarta-feira</option>
                  <option value="4">Quinta-feira</option>
                  <option value="5">Sexta-feira</option>
                  <option value="6">Sábado</option>
                </select>
                <Input
                  type="time"
                  value={filterPlanTime}
                  onChange={(e) => setFilterPlanTime(e.target.value)}
                  className="bg-secondary border-white/10 text-sm h-9"
                />
              </div>
            )}
          </div>

          {/* Clients List */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {loading ? (
              <p className="text-muted-foreground text-sm text-center py-4">Carregando...</p>
            ) : filteredClients.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">Nenhum cliente encontrado</p>
            ) : (
              filteredClients.map((client) => (
                <div
                  key={client.id}
                  onClick={() => handleSelectClient(client)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedClient?.id === client.id
                      ? "bg-primary/20 border-primary text-white"
                      : "bg-secondary border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{client.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{maskPhone(client.phone)}</p>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditClient(client); }}
                        className="p-1 hover:bg-blue-500/20 text-blue-400 rounded transition-colors"
                        title="Editar"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteClient(client.id); }}
                        className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                        title="Deletar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Pagination info + load more */}
          {!filterStatus.startsWith("plan_") && (
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{clients.length} de {totalClients} clientes</span>
              {currentPage < totalPages && (
                <button
                  onClick={() => loadClients({ q: filterName, page: currentPage + 1, append: true })}
                  disabled={loadingMore}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </button>
              )}
            </div>
          )}
        </Card>

        {/* Client Details and Plans */}
        <Card className="lg:col-span-2 p-4 md:p-6">
          {selectedClient ? (
            <div className="space-y-6">
              {/* Client Info */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-lg">{selectedClient.name}</h3>
                  <button
                    onClick={() => handleEditClient(selectedClient)}
                    className="p-1.5 hover:bg-blue-500/20 text-blue-400 rounded transition-colors"
                    title="Editar cliente"
                  >
                    <Edit2 size={18} />
                  </button>
                </div>
                <div className="space-y-3 text-sm">
                  <p><span className="text-muted-foreground">Email:</span> {selectedClient.email}</p>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Telefone:</span>
                    <span className="font-medium">{maskPhone(selectedClient.phone)}</span>
                    <div className="flex gap-1 ml-auto">
                      <a
                        href={`https://wa.me/${getPhoneWithoutMask(selectedClient.phone)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 hover:bg-green-500/20 text-green-400 rounded transition-colors"
                        title="Abrir WhatsApp"
                      >
                        <MessageCircle size={16} />
                      </a>
                      <a
                        href={`tel:${getPhoneWithoutMask(selectedClient.phone)}`}
                        className="p-1.5 hover:bg-blue-500/20 text-blue-400 rounded transition-colors"
                        title="Ligar"
                      >
                        <Phone size={16} />
                      </a>
                    </div>
                  </div>
                  
                  {selectedClient.notes && (
                    <p><span className="text-muted-foreground">Notas:</span> {selectedClient.notes}</p>
                  )}
                  <p><span className="text-muted-foreground">Desde:</span> {formatDate(selectedClient.createdAt)}</p>
                </div>
              </div>

              {/* Monthly Plans */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold">Planos Mensalistas</h4>
                  <Button onClick={openAddPlan} className="gap-1 text-xs px-2">
                    <Plus size={14} /> Novo Plano
                  </Button>
                </div>

                {clientPlans.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nenhum plano cadastrado</p>
                ) : (
                  <div className="space-y-3">
                    {clientPlans.map((plan) => {
                      // Calculate end time
                      const endTime = calcEndTime(plan.time, Number(plan.durationHours) || 1);

                      // Compute near-month-end display
                      const nearEnd = isNearMonthEnd();
                      const { nextMonth, nextYear, nextMonthName } = getNextMonthInfo();
                      // Use real booking count from backend (respects plan creation date and time-of-day)
                      const sessionsThisMonth = plan.sessionsThisMonth ?? countWeekdayInCurrentMonth(plan.dayOfWeek);
                      const sessionsNextMonth = countWeekdayInMonth(plan.dayOfWeek, nextYear, nextMonth);
                      const pricePerSession = Number(plan.monthlyPrice);
                      // If near month end and plan is active, show next month's value
                      const displaySessions = (plan.status === "active" && nearEnd) ? sessionsNextMonth : sessionsThisMonth;
                      const displayMonthLabel = (plan.status === "active" && nearEnd) ? nextMonthName : null;
                      const displayValue = pricePerSession * displaySessions;

                      // WhatsApp message depends on plan status
                      // pending_payment → current month; active + nearEnd → next month
                      const waBillingMonth = plan.status === "pending_payment" ? monthNames[new Date().getMonth()] : nextMonthName;
                      const waBillingValue = plan.status === "pending_payment"
                        ? formatCurrency(displayValue) // use current month value
                        : formatCurrency(pricePerSession * sessionsNextMonth); // use next month value
                      const waMessage = encodeURIComponent(
                        `Olá, o pagamento de reserva para o mês *${waBillingMonth}* já está disponível, realize o pix no valor de *${waBillingValue}*${pixKey ? ` para a chave pix *${pixKey}*` : ""}.`
                      );
                      const waPhone = selectedClient.phone.replace(/\D/g, "");
                      const waUrl = `https://wa.me/55${waPhone}?text=${waMessage}`;

                      return (
                        <div key={plan.id} className="bg-secondary border border-white/10 rounded-lg p-3">
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            <p className="font-bold text-sm">
                              {plan.type === "court" ? `Quadra ${plan.courtNumber}` : "Beach Tennis"} — {dayNames[plan.dayOfWeek]} {plan.time}–{endTime}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {plan.type === "court"
                                ? formatDuration(Number(plan.durationHours) || 1)
                                : `${plan.numberOfPeople} pessoa(s)`}{" "}
                              · {displaySessions} sessões{displayMonthLabel ? ` (${displayMonthLabel})` : "/mês"} ·{" "}
                              <span className="text-primary font-bold">{formatCurrency(displayValue)}</span>
                              <span className="text-muted-foreground/60"> ({formatCurrency(pricePerSession)}/sessão)</span>
                            </p>
                          </div>
                          <div className="flex items-start gap-1 flex-wrap">
                            <Badge variant={plan.status === "active" ? "gold" : "outline"} className="text-xs">
                              {plan.status === "active"
                                ? (nearEnd && !isNextMonthPaid(plan.id) ? "Ativo – Aguardando próx. pgto" : "Ativo")
                                : plan.status === "pending_payment" ? "Pendente" : "Inativo"}
                            </Badge>
                            {(plan.status === "pending_payment" || (plan.status === "active" && nearEnd && !isNextMonthPaid(plan.id))) && (
                              <button
                                onClick={() => handleGeneratePayment(plan)}
                                disabled={generatingPayment}
                                className="px-2 py-1 text-xs rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
                                title="Gerar QR Code PIX"
                              >
                                {generatingPayment ? "..." : "QR Code"}
                              </button>
                            )}
                            {((plan.status === "active" && nearEnd && !isNextMonthPaid(plan.id)) || plan.status === "pending_payment") && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 hover:bg-green-500/20 text-green-400 rounded transition-colors"
                                title={`Enviar cobrança de ${waBillingMonth} via WhatsApp`}
                              >
                                <MessageCircle size={14} />
                              </a>
                            )}
                            <button
                              onClick={async () => {
                                setPlanBookings([]);
                                setViewingPlan(plan);
                                loadPlanBookings(selectedClient.id, plan.id);
                              }}
                              className="p-1 hover:bg-green-500/20 text-green-400 rounded transition-colors"
                              title="Ver detalhes"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => handleEditPlan(plan)}
                              className="p-1 hover:bg-blue-500/20 text-blue-400 rounded transition-colors"
                              title={plan.status === "active" ? "Renovar para próximo mês" : "Editar preço"}
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeletePlan(plan.id)}
                              className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                              title="Deletar plano"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        {/* Payment history */}
                        {(() => {
                          const logs = (planLogs[plan.id] ?? []).filter(l => l.status === "paid");
                          if (logs.length === 0) return null;
                          return (
                            <div className="mt-2 pt-2 border-t border-white/5">
                              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1.5">Histórico de Pagamentos</p>
                              <div className="flex flex-wrap gap-1">
                                {logs.map(log => (
                                  <span key={log.id} className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 rounded px-1.5 py-0.5 font-medium">
                                    ✓ {formatMonthLabel(log.month)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground py-16">
              <p>Selecione um cliente para ver detalhes</p>
            </div>
          )}
        </Card>
      </div>

      {/* Add Monthly Plan Modal */}
      {isAddingPlan && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto">
          <div className="bg-card border border-white/10 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto my-4 mx-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Novo Plano Mensalista</h3>
              <button onClick={() => { setIsAddingPlan(false); resetPlanForm(); }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Type Selection */}
              <div>
                <Label className="text-sm mb-2 block">Tipo de Plano</Label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPlanType("court")}
                    className={`flex-1 py-2 px-3 rounded-lg border font-bold text-sm transition-all ${
                      planType === "court"
                        ? "bg-primary text-black border-primary"
                        : "bg-secondary border-white/10 hover:border-white/20"
                    }`}
                  >
                    Quadra
                  </button>
                  {!beachTennisHidden && (
                    <button
                      onClick={() => setPlanType("class")}
                      className={`flex-1 py-2 px-3 rounded-lg border font-bold text-sm transition-all ${
                        planType === "class"
                          ? "bg-primary text-black border-primary"
                          : "bg-secondary border-white/10 hover:border-white/20"
                      }`}
                    >
                      Aula Beach Tennis
                    </button>
                  )}
                </div>
              </div>

              {/* Court-specific: Quadra + Duração aparecem primeiro */}
              {planType === "court" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm mb-2 block">Quadra</Label>
                      <select
                        value={planCourtNumber}
                        onChange={(e) => setPlanCourtNumber(Number(e.target.value))}
                        className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground text-sm"
                      >
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>Quadra {n}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-sm mb-2 block">Duração</Label>
                      <select
                        value={planDuration}
                        onChange={(e) => { setPlanDuration(Number(e.target.value)); setPlanPriceEdited(false); }}
                        className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground text-sm"
                      >
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <option key={n} value={n}>{n}h</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm mb-2 block">Minutos Adicionais (0–60)</Label>
                    <select
                      value={planExtraMinutes}
                      onChange={(e) => { setPlanExtraMinutes(Number(e.target.value)); setPlanPriceEdited(false); }}
                      className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground text-sm"
                    >
                      {[0, 15, 30, 45, 60].map((m) => (
                        <option key={m} value={m}>{m === 0 ? "Sem minutos adicionais" : `+ ${m} min`}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Day + Time — carregado dinamicamente pela quadra + dia */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm mb-2 block">Dia da Semana</Label>
                  <select
                    value={planDayOfWeek}
                    onChange={(e) => setPlanDayOfWeek(Number(e.target.value))}
                    className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground"
                  >
                    {dayNames.map((name, index) => (
                      <option key={index} value={index}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-sm mb-2 block">
                    Horário disponível
                    {availableHours.length === 0 && <span className="text-xs text-muted-foreground ml-1">(carregando...)</span>}
                  </Label>
                  {availableHours.length > 0 ? (
                    <select
                      value={planTime}
                      onChange={(e) => setPlanTime(e.target.value)}
                      className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground"
                    >
                      {availableHours.map((hour) => (
                        <option key={hour} value={hour}>{hour}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-muted-foreground text-sm">
                      Aguardando...
                    </div>
                  )}
                </div>
              </div>

              {/* Class-specific */}
              {planType === "class" && (
                <div>
                  <Label className="text-sm mb-2 block">Número de Pessoas</Label>
                  <select
                    value={planNumberOfPeople}
                    onChange={(e) => setPlanNumberOfPeople(Number(e.target.value))}
                    className="w-full bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? "pessoa" : "pessoas"}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Price Field */}
              <div>
                <Label className="text-sm mb-2 block">
                  Valor por Sessão (R$)
                  {!planPriceEdited && planPreview?.pricePerSession ? (
                    <span className="ml-1 text-xs text-muted-foreground">(calculado automaticamente — editável)</span>
                  ) : planPriceEdited ? (
                    <span className="ml-1 text-xs text-yellow-400">(editado manualmente)</span>
                  ) : previewLoading ? (
                    <span className="ml-1 text-xs text-muted-foreground animate-pulse">(calculando...)</span>
                  ) : null}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={planPrice}
                  onChange={(e) => {
                    setPlanPrice(e.target.value);
                    setPlanPriceEdited(true);
                  }}
                  className="bg-secondary border-white/10"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  A cobrança mensal será calculada automaticamente: valor × nº de sessões do mês
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <Button
                onClick={() => { setIsAddingPlan(false); resetPlanForm(); }}
                variant="outline"
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreatePlan}
                className="flex-1"
                isLoading={planLoading}
                disabled={planLoading}
              >
                Criar Plano
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Client Modal */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto">
          <div className="bg-card border border-white/10 rounded-lg p-6 w-full max-w-md mx-4 my-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Editar Cliente</h3>
              <button onClick={() => setEditingClient(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <Label className="text-sm mb-2 block">Nome</Label>
                <Input
                  value={editClientName}
                  onChange={(e) => setEditClientName(e.target.value)}
                  className="bg-secondary border-white/10"
                />
              </div>
              <div>
                <Label className="text-sm mb-2 block">Email</Label>
                <Input
                  type="email"
                  value={editClientEmail}
                  onChange={(e) => setEditClientEmail(e.target.value)}
                  className="bg-secondary border-white/10"
                />
              </div>
              <div>
                <Label className="text-sm mb-2 block">Telefone</Label>
                <Input
                  value={maskPhone(editClientPhone)}
                  onChange={(e) => setEditClientPhone(e.target.value)}
                  className="bg-secondary border-white/10"
                />
              </div>
              <div>
                <Label className="text-sm mb-2 block">CPF</Label>
                <Input
                  value={maskCPF(editClientCpf)}
                  onChange={(e) => setEditClientCpf(e.target.value)}
                  className="bg-secondary border-white/10"
                />
              </div>
              <div>
                <Label className="text-sm mb-2 block">Notas</Label>
                <textarea
                  value={editClientNotes}
                  onChange={(e) => setEditClientNotes(e.target.value)}
                  className="bg-secondary border border-white/10 rounded-lg px-3 py-2 text-foreground text-sm w-full"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <Button
                onClick={() => setEditingClient(null)}
                variant="outline"
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSaveClient}
                className="flex-1"
                isLoading={editClientLoading}
              >
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Plan Modal */}
      {editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-white/10 rounded-lg p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">Editar Preço</h3>
              <button onClick={() => setEditingPlan(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {editingPlan.type === "court" ? "Quadra" : "Aula de Beach Tennis"} — {dayNames[editingPlan.dayOfWeek]} às {editingPlan.time}
              </p>
              <div>
                <Label className="text-sm mb-2 block">Preço Mensal (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editPlanPrice}
                  onChange={(e) => setEditPlanPrice(e.target.value)}
                  className="bg-secondary border-white/10"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <Button
                onClick={() => setEditingPlan(null)}
                variant="outline"
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSavePlan}
                className="flex-1"
                isLoading={editPlanLoading}
              >
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment QR Code Modal */}
      {paymentPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-white/10 rounded-lg p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg">QR Code PIX</h3>
              <button onClick={() => setPaymentPlan(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {paymentPlan.qrCodeUrl ? (
              <div className="space-y-4">
                <p className="text-center font-semibold text-white">Olá {selectedClient?.name.split(" ")[0]}! Faça o pagamento a {profile?.company_name}</p>
                <p className="text-sm text-muted-foreground text-center">Escanear com o seu celular para pagar</p>
                <div className="flex justify-center bg-white p-4 rounded-lg">
                  <img src={paymentPlan.qrCodeUrl} alt="QR Code PIX" className="w-64 h-64" />
                </div>
                <Button
                  onClick={() => {
                    const toCopy = paymentPlan.pixQrCode || paymentPlan.qrCodeUrl;
                    if (toCopy) {
                      navigator.clipboard.writeText(toCopy);
                      showToast.success("Código PIX copiado!");
                    }
                  }}
                  variant="outline"
                  className="w-full gap-2"
                >
                  <Copy size={16} /> Copiar Código PIX
                </Button>
                <Button
                  onClick={handleMarkAsPaid}
                  disabled={generatingPayment}
                  className="w-full bg-green-600 hover:bg-green-700 gap-2"
                >
                  {generatingPayment ? "..." : "✓ Marcar como Pago"}
                </Button>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
              </div>
            )}

            <Button
              onClick={() => setPaymentPlan(null)}
              variant="outline"
              className="w-full mt-4"
            >
              Fechar
            </Button>
          </div>
        </div>
      )}

      {/* View Plan Details Modal */}
      {viewingPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-secondary border border-white/10 rounded-lg w-full max-w-sm md:max-w-xl lg:max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="sticky top-0 bg-secondary flex items-center justify-between mb-6 p-6 pb-0 border-b border-white/10">
              <h3 className="font-bold text-lg md:text-xl">Detalhes do Plano</h3>
              <button onClick={() => setViewingPlan(null)} className="flex-shrink-0 ml-2">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
            {/* Plan Info */}
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Tipo</p>
                  <p className="font-bold text-sm">Plano Mensalista</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Dia/Horário</p>
                  <p className="font-bold text-sm">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][viewingPlan.dayOfWeek]} às {viewingPlan.time}</p>
                </div>
                {viewingPlan.type === "court" && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">Quadra</p>
                      <p className="font-bold text-sm">Quadra {viewingPlan.courtNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Duração</p>
                      <p className="font-bold text-sm">{formatDuration(Number(viewingPlan.durationHours) || 1)}</p>
                    </div>
                  </>
                )}
                {viewingPlan.type === "class" && (
                  <div>
                    <p className="text-xs text-muted-foreground">Pessoas</p>
                    <p className="font-bold text-sm">{viewingPlan.numberOfPeople}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Preço/Mês</p>
                  {(() => {
                    const nearEnd = isNearMonthEnd();
                    const { nextYear, nextMonth } = getNextMonthInfo();
                    const sessionsThis = viewingPlan.sessionsThisMonth ?? countWeekdayInCurrentMonth(viewingPlan.dayOfWeek);
                    const sessionsNext = countWeekdayInMonth(viewingPlan.dayOfWeek, nextYear, nextMonth);
                    const perSession = Number(viewingPlan.monthlyPrice);
                    const sessions = (viewingPlan.status === "active" && nearEnd) ? sessionsNext : sessionsThis;
                    const totalValue = perSession * sessions;
                    return (
                      <p className="font-bold text-sm text-primary">
                        {formatCurrency(totalValue)}{" "}
                        <span className="text-muted-foreground font-normal text-xs">({sessions}x {formatCurrency(perSession)})</span>
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant={viewingPlan.status === "active" ? "gold" : "outline"} className="text-xs">
                    {viewingPlan.status === "active" ? "Ativo" : viewingPlan.status === "pending_payment" ? "Pendente" : "Inativo"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Bookings List */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm flex items-center gap-2">
                  <CalendarDays size={16} />
                  Datas Reservadas ({planBookings.length})
                </h4>
                <button
                  onClick={() => selectedClient && loadPlanBookings(selectedClient.id, viewingPlan.id)}
                  disabled={loadingBookings}
                  className="text-xs text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
                  title="Recarregar reservas"
                >
                  ↻ Atualizar
                </button>
              </div>
              {loadingBookings ? (
                <div className="text-center py-6 text-muted-foreground text-sm">Carregando reservas...</div>
              ) : planBookings.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:gap-3">
                  {planBookings.map((booking, idx) => {
                    const dateObj = new Date(booking.date + "T00:00:00");
                    const dayName = dateObj.toLocaleDateString("pt-BR", { weekday: "short", month: "2-digit", day: "2-digit" });
                    const statusColor = booking.status === "confirmed" ? "bg-green-500/20 text-green-400 border-green-500/30" : 
                                       booking.status === "cancelled" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                       "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
                    return (
                      <div key={idx} className={`border rounded-lg p-2 md:p-3 text-center text-xs md:text-sm ${statusColor}`}>
                        <p className="font-bold text-sm md:text-base">{dayName}</p>
                        <p className="text-xs opacity-80">{booking.time}</p>
                        <p className="text-xs mt-1 capitalize">{booking.status === "confirmed" ? "✓ Confirmada" : booking.status === "cancelled" ? "✗ Cancelada" : "Pendente"}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-muted-foreground text-sm mb-3">Nenhuma reserva encontrada para este plano.</p>
                  {viewingPlan.status !== "active" && (
                    <Button
                      onClick={handleActivatePlanFromModal}
                      disabled={activatingPlanFromModal}
                      className="bg-primary hover:bg-primary/90 text-white text-sm"
                    >
                      {activatingPlanFromModal ? "Ativando..." : "Ativar Plano e Gerar Reservas"}
                    </Button>
                  )}
                  {viewingPlan.status === "active" && (
                    <p className="text-xs text-yellow-400">Plano ativo mas sem reservas disponíveis no período atual.</p>
                  )}
                </div>
              )}
            </div>
            </div>

            <div className="sticky bottom-0 bg-secondary border-t border-white/10 p-6 pt-4">
              <Button
                onClick={() => setViewingPlan(null)}
                variant="outline"
                className="w-full"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
