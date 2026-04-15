import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from "recharts";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { TrendingUp, CalendarDays, Globe, Clock, RefreshCw } from "lucide-react";
import { Card } from "./ui/card";

type Period = "day" | "week" | "month" | "year";

const PERIOD_LABELS: Record<Period, string> = { day: "Hoje", week: "7 dias", month: "Mês", year: "Ano" };

const COLORS = {
  primary: "hsl(var(--primary))",
  blue: "#60a5fa",
  emerald: "#34d399",
  rose: "#fb7185",
  amber: "#fbbf24",
  violet: "#a78bfa",
};

// ── Custom HTML legend (never overflows) ──────────────────────────────────────
function ChartLegend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block rounded-full shrink-0"
            style={{
              width: 24,
              height: 2,
              background: item.color,
              borderTop: item.dashed ? `2px dashed ${item.color}` : undefined,
            }}
          />
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex gap-1 bg-black/30 rounded-lg p-1 shrink-0">
      {(["day", "week", "month", "year"] as Period[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${value === p ? "bg-primary text-black" : "text-muted-foreground hover:text-foreground"}`}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-black/20 rounded-xl border border-white/10 p-3 flex items-start gap-2 overflow-hidden">
      <div className="text-primary mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 w-full overflow-hidden">
        <p className="text-xs text-muted-foreground leading-tight truncate">{label}</p>
        <p className="text-sm md:text-base font-bold text-foreground truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label, valueFormatter }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl max-w-[180px]">
      <p className="font-bold text-foreground mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} style={{ color: entry.color }} className="flex gap-1 flex-wrap">
          <span className="truncate max-w-[100px]">{entry.name}:</span>
          <span className="font-semibold">{valueFormatter ? valueFormatter(entry.value) : entry.value}</span>
        </p>
      ))}
    </div>
  );
};

function formatCurrency(v: number) {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatCurrencyShort(v: number) {
  if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
  return `R$${v}`;
}
function formatSeconds(v: number) {
  if (v < 60) return `${v}s`;
  return `${Math.floor(v / 60)}m ${v % 60}s`;
}

// ── Revenue Chart ────────────────────────────────────────────────────────────

function RevenueChart() {
  const { getAuthHeaders } = useAdminAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/analytics/revenue?period=${p}`, { headers: getAuthHeaders() });
      setData(await res.json());
    } catch { setData([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period); }, [period]);

  const total = data.reduce((s, r) => s + (r.total ?? 0), 0);
  const court = data.reduce((s, r) => s + (r.court ?? 0), 0);
  const cls = data.reduce((s, r) => s + (r.class ?? 0), 0);
  const tourn = data.reduce((s, r) => s + (r.tournament ?? 0), 0);
  const monthly = data.reduce((s, r) => s + (r.monthly ?? 0), 0);

  return (
    <Card className="p-4 md:p-5 space-y-3 overflow-hidden">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={16} className="text-primary shrink-0" />
          <h3 className="font-display text-sm md:text-base uppercase tracking-wider font-bold leading-tight">Gestão Financeira</h3>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatCard icon={<TrendingUp size={13} />} label="Total" value={formatCurrency(total)} />
        <StatCard icon={<TrendingUp size={13} />} label="Agendamentos" value={formatCurrency(court)} />
        <StatCard icon={<TrendingUp size={13} />} label="Aulas" value={formatCurrency(cls)} />
        <StatCard icon={<TrendingUp size={13} />} label="Mensalistas" value={formatCurrency(monthly)} />
        <StatCard icon={<TrendingUp size={13} />} label="Torneios" value={formatCurrency(tourn)} />
      </div>

      <div className="h-44 md:h-56">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" /> Carregando...
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Sem dados para o período</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gCourt" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gClass" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.blue} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gMonthly" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.emerald} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.emerald} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gTourn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.violet} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.violet} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={formatCurrencyShort} width={48} />
              <Tooltip content={<CustomTooltip valueFormatter={formatCurrency} />} />
              <Area type="monotone" dataKey="court" name="Agendamentos" stroke={COLORS.primary} fill="url(#gCourt)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="class" name="Aulas" stroke={COLORS.blue} fill="url(#gClass)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="monthly" name="Mensalistas" stroke={COLORS.emerald} fill="url(#gMonthly)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="tournament" name="Torneios" stroke={COLORS.violet} fill="url(#gTourn)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <ChartLegend items={[
        { color: COLORS.primary, label: "Agendamentos" },
        { color: COLORS.blue, label: "Aulas" },
        { color: COLORS.emerald, label: "Mensalistas" },
        { color: COLORS.violet, label: "Torneios" },
      ]} />
    </Card>
  );
}

// ── Bookings Chart ───────────────────────────────────────────────────────────

function BookingsChart() {
  const { getAuthHeaders } = useAdminAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/analytics/bookings?period=${p}`, { headers: getAuthHeaders() });
      setData(await res.json());
    } catch { setData([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period); }, [period]);

  const totalB = data.reduce((s, r) => s + (r.total ?? 0), 0);
  const totalConf = data.reduce((s, r) => s + (r.confirmed ?? 0), 0);
  const totalCompleted = data.reduce((s, r) => s + (r.completed ?? 0), 0);
  const totalPend = data.reduce((s, r) => s + (r.pending ?? 0), 0);
  const totalCanc = data.reduce((s, r) => s + (r.cancelled ?? 0), 0);

  return (
    <Card className="p-4 md:p-5 space-y-3 overflow-hidden">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays size={16} className="text-primary shrink-0" />
          <h3 className="font-display text-sm md:text-base uppercase tracking-wider font-bold">Agendamentos</h3>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatCard icon={<CalendarDays size={13} />} label="Total" value={String(totalB)} />
        <StatCard icon={<CalendarDays size={13} />} label="Confirmados" value={String(totalConf)} />
        <StatCard icon={<CalendarDays size={13} />} label="Concluídos" value={String(totalCompleted)} />
        <StatCard icon={<CalendarDays size={13} />} label="Pendentes" value={String(totalPend)} />
        <StatCard icon={<CalendarDays size={13} />} label="Cancelados" value={String(totalCanc)} />
      </div>

      <div className="h-44 md:h-56">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" /> Carregando...
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Sem dados para o período</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} allowDecimals={false} width={28} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="confirmed" name="Confirmados" fill={COLORS.emerald} radius={[3, 3, 0, 0]} />
              <Bar dataKey="completed" name="Concluídos" fill={COLORS.blue} radius={[3, 3, 0, 0]} />
              <Bar dataKey="pending" name="Pendentes" fill={COLORS.amber} radius={[3, 3, 0, 0]} />
              <Bar dataKey="cancelled" name="Cancelados" fill={COLORS.rose} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <ChartLegend items={[
        { color: COLORS.emerald, label: "Confirmados" },
        { color: COLORS.blue, label: "Concluídos" },
        { color: COLORS.amber, label: "Pendentes" },
        { color: COLORS.rose, label: "Cancelados" },
      ]} />
    </Card>
  );
}

// ── Pageviews Chart ──────────────────────────────────────────────────────────

function PageviewsChart() {
  const { getAuthHeaders } = useAdminAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/analytics/pageviews?period=${p}`, { headers: getAuthHeaders() });
      setData(await res.json());
    } catch { setData([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period); }, [period]);

  const totalViews = data.reduce((s, r) => s + (r.views ?? 0), 0);
  const totalSessions = data.reduce((s, r) => s + (r.sessions ?? 0), 0);
  const avgPagePerSession = totalSessions > 0 ? (totalViews / totalSessions).toFixed(1) : "0";

  return (
    <Card className="p-4 md:p-5 space-y-3 overflow-hidden">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={16} className="text-primary shrink-0" />
          <h3 className="font-display text-sm md:text-base uppercase tracking-wider font-bold">Acessos ao Site</h3>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={<Globe size={13} />} label="Page Views" value={totalViews.toLocaleString("pt-BR")} />
        <StatCard icon={<Globe size={13} />} label="Sessões" value={totalSessions.toLocaleString("pt-BR")} />
        <StatCard icon={<Globe size={13} />} label="Págs/sessão" value={avgPagePerSession} />
      </div>

      <div className="h-44 md:h-56">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" /> Carregando...
          </div>
        ) : data.every(r => !r.views) ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 text-center px-4">
            <Globe size={24} className="opacity-30" />
            <span>Dados sendo coletados — visite o site para gerar métricas</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} allowDecimals={false} width={28} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="views" name="Page views" stroke={COLORS.primary} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="sessions" name="Sessões" stroke={COLORS.blue} strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <ChartLegend items={[
        { color: COLORS.primary, label: "Page views" },
        { color: COLORS.blue, label: "Sessões", dashed: true },
      ]} />
    </Card>
  );
}

// ── Duration Chart ───────────────────────────────────────────────────────────

function DurationChart() {
  const { getAuthHeaders } = useAdminAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/analytics/duration?period=${p}`, { headers: getAuthHeaders() });
      setData(await res.json());
    } catch { setData([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period); }, [period]);

  const avgDuration = data.length > 0
    ? Math.round(data.reduce((s, r) => s + (r.avg_duration ?? 0), 0) / data.filter(r => r.avg_duration > 0).length || 0)
    : 0;
  const totalSessions = data.reduce((s, r) => s + (r.sessions ?? 0), 0);
  const maxDuration = Math.max(...data.map(r => r.avg_duration ?? 0));

  return (
    <Card className="p-4 md:p-5 space-y-3 overflow-hidden">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Clock size={16} className="text-primary shrink-0" />
          <h3 className="font-display text-sm md:text-base uppercase tracking-wider font-bold">Tempo de Acesso</h3>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={<Clock size={13} />} label="Tempo médio" value={formatSeconds(isNaN(avgDuration) ? 0 : avgDuration)} />
        <StatCard icon={<Clock size={13} />} label="Maior médio" value={formatSeconds(maxDuration)} />
        <StatCard icon={<Clock size={13} />} label="Sessões" value={totalSessions.toLocaleString("pt-BR")} />
      </div>

      <div className="h-44 md:h-56">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <RefreshCw size={16} className="animate-spin mr-2" /> Carregando...
          </div>
        ) : data.every(r => !r.avg_duration) ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-2 text-center px-4">
            <Clock size={24} className="opacity-30" />
            <span>Dados sendo coletados — visite o site para gerar métricas</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gDuration" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.amber} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={formatSeconds} width={40} />
              <Tooltip content={<CustomTooltip valueFormatter={formatSeconds} />} />
              <Area type="monotone" dataKey="avg_duration" name="Tempo médio" stroke={COLORS.amber} fill="url(#gDuration)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <ChartLegend items={[
        { color: COLORS.amber, label: "Tempo médio por sessão" },
      ]} />
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function AdminDesempenho() {
  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h2 className="text-xl md:text-2xl font-display font-bold uppercase tracking-wider">Desempenho</h2>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Visão geral de receita, agendamentos e acessos ao site.</p>
      </div>
      <RevenueChart />
      <BookingsChart />
      <PageviewsChart />
      <DurationChart />
    </div>
  );
}
