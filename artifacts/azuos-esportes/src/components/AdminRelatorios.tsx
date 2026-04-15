import { useState, useRef, useCallback, useEffect } from "react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { formatCurrency, cn } from "@/lib/utils";
import {
  GripVertical, Plus, X, FileText, Download, Loader2, Calendar, Users, TrendingUp,
  CheckCircle2, XCircle, Clock, BarChart2, Trophy, UserX, Star, ChevronDown, ChevronUp,
} from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "@/components/ui";

const BASE = import.meta.env.BASE_URL;
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ── Types ────────────────────────────────────────────────────────────────────

type BlockId =
  | "resumo_agendamentos"
  | "agendamentos_recentes"
  | "receita_resumo"
  | "mensalistas_ativos"
  | "mensalistas_inativos"
  | "clientes_sem_plano"
  | "top_clientes"
  | "clientes_mais_antigos"
  | "todos_clientes";

interface BlockConfig {
  id: string;
  type: BlockId;
  title: string;
  limit?: number;
  fromDate?: string;
  toDate?: string;
}

interface BlockDef {
  type: BlockId;
  label: string;
  description: string;
  icon: React.ReactNode;
  defaultTitle: string;
  hasLimit?: boolean;
  hasDateRange?: boolean;
}

const BLOCK_DEFS: BlockDef[] = [
  { type: "resumo_agendamentos", label: "Resumo de Agendamentos", description: "Total, confirmados, concluídos, pendentes e cancelados", icon: <Calendar size={16} />, defaultTitle: "Resumo de Agendamentos", hasDateRange: true },
  { type: "receita_resumo", label: "Receita por Categoria", description: "Agendamentos individuais, aulas, mensalistas e torneios", icon: <TrendingUp size={16} />, defaultTitle: "Receita por Categoria", hasDateRange: true },
  { type: "agendamentos_recentes", label: "Lista de Agendamentos", description: "Tabela detalhada de agendamentos no período", icon: <BarChart2 size={16} />, defaultTitle: "Lista de Agendamentos", hasDateRange: true, hasLimit: true },
  { type: "mensalistas_ativos", label: "Mensalistas Ativos", description: "Clientes com plano mensal ativo", icon: <CheckCircle2 size={16} />, defaultTitle: "Mensalistas Ativos" },
  { type: "mensalistas_inativos", label: "Mensalistas Inativos", description: "Clientes com plano mensal inativo", icon: <XCircle size={16} />, defaultTitle: "Mensalistas Inativos" },
  { type: "clientes_sem_plano", label: "Clientes sem Plano", description: "Clientes cadastrados sem plano mensal ativo", icon: <UserX size={16} />, defaultTitle: "Clientes sem Plano" },
  { type: "top_clientes", label: "Top Clientes (Agendamentos)", description: "Ranking de clientes por número de agendamentos individuais", icon: <Star size={16} />, defaultTitle: "Top Clientes", hasDateRange: true, hasLimit: true },
  { type: "clientes_mais_antigos", label: "Fidelidade — Planos mais Antigos", description: "Clientes com plano ativo há mais tempo", icon: <Trophy size={16} />, defaultTitle: "Clientes mais Antigos com Plano", hasLimit: true },
  { type: "todos_clientes", label: "Todos os Clientes", description: "Lista completa de clientes cadastrados", icon: <Users size={16} />, defaultTitle: "Todos os Clientes" },
];

// ── API helpers ───────────────────────────────────────────────────────────────

function buildQuery(base: string, params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const q = p.toString();
  return `${BASE}api/reports/${base}${q ? "?" + q : ""}`;
}

async function fetchBlock(type: BlockId, cfg: BlockConfig, headers: Record<string, string>) {
  switch (type) {
    case "resumo_agendamentos":
      return fetch(buildQuery("bookings-summary", { from: cfg.fromDate, to: cfg.toDate }), { headers }).then(r => r.json());
    case "receita_resumo":
      return fetch(buildQuery("revenue-summary", { from: cfg.fromDate, to: cfg.toDate }), { headers }).then(r => r.json());
    case "agendamentos_recentes":
      return fetch(buildQuery("bookings-list", { from: cfg.fromDate, to: cfg.toDate, limit: cfg.limit ?? 50 }), { headers }).then(r => r.json());
    case "mensalistas_ativos":
      return fetch(buildQuery("monthly-plans", { status: "active" }), { headers }).then(r => r.json());
    case "mensalistas_inativos":
      return fetch(buildQuery("monthly-plans", { status: "inactive" }), { headers }).then(r => r.json());
    case "clientes_sem_plano":
      return fetch(buildQuery("clients-no-plan", {}), { headers }).then(r => r.json());
    case "top_clientes":
      return fetch(buildQuery("top-clients", { from: cfg.fromDate, to: cfg.toDate, limit: cfg.limit ?? 10 }), { headers }).then(r => r.json());
    case "clientes_mais_antigos":
      return fetch(buildQuery("oldest-plans", { limit: cfg.limit ?? 10 }), { headers }).then(r => r.json());
    case "todos_clientes":
      return fetch(buildQuery("all-clients", {}), { headers }).then(r => r.json());
  }
}

// ── Block renderers ───────────────────────────────────────────────────────────

function ResumoAgendamentosView({ data }: { data: any }) {
  const rows = [
    { label: "Total", value: data.total, color: "text-foreground" },
    { label: "Confirmados", value: data.confirmed, color: "text-emerald-400" },
    { label: "Concluídos", value: data.completed, color: "text-blue-400" },
    { label: "Pendentes", value: data.pending, color: "text-amber-400" },
    { label: "Cancelados", value: data.cancelled, color: "text-rose-400" },
    { label: "Receita gerada", value: formatCurrency(data.revenue), color: "text-primary" },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {rows.map(r => (
        <div key={r.label} className="bg-black/10 rounded-lg p-3 text-center border border-white/5">
          <p className="text-xs text-muted-foreground">{r.label}</p>
          <p className={cn("text-xl font-bold", r.color)}>{r.value}</p>
        </div>
      ))}
    </div>
  );
}

function ReceitaResumoView({ data }: { data: any }) {
  const items = [
    { label: "Agendamentos Individuais", value: data.agendamentos_individuais },
    { label: "Aulas", value: data.aulas },
    { label: "Mensalistas", value: data.mensalistas },
    { label: "Torneios", value: data.torneios },
  ];
  return (
    <div className="space-y-2">
      {items.map(i => (
        <div key={i.label} className="flex justify-between items-center py-2 border-b border-white/5 text-sm">
          <span className="text-muted-foreground">{i.label}</span>
          <span className="font-semibold">{formatCurrency(Number(i.value))}</span>
        </div>
      ))}
      <div className="flex justify-between items-center pt-1 text-sm font-bold">
        <span>Total</span>
        <span className="text-primary">{formatCurrency(Number(data.total))}</span>
      </div>
    </div>
  );
}

function AgendamentosRecentesView({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground text-center py-4">Nenhum agendamento no período</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {["Tipo", "Cliente", "E-mail", "Data", "Horário", "Valor", "Status"].map(h => (
              <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1.5 px-2 capitalize">{row.type}</td>
              <td className="py-1.5 px-2">{row.customer_name}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.customer_email}</td>
              <td className="py-1.5 px-2">{row.date}</td>
              <td className="py-1.5 px-2">{row.time}</td>
              <td className="py-1.5 px-2">{formatCurrency(Number(row.amount))}</td>
              <td className="py-1.5 px-2">
                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                  row.status === "confirmed" ? "bg-emerald-500/20 text-emerald-400" :
                  row.status === "cancelled" ? "bg-rose-500/20 text-rose-400" :
                  "bg-amber-500/20 text-amber-400"
                )}>{row.status === "confirmed" ? "confirmado" : row.status === "cancelled" ? "cancelado" : "pendente"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MensaListaView({ data, inactive }: { data: any[]; inactive?: boolean }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground text-center py-4">{inactive ? "Nenhum mensalista inativo" : "Nenhum mensalista ativo"}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {["Cliente", "E-mail", "Tipo", "Dia / Horário", "Valor/mês", "Desde"].map(h => (
              <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1.5 px-2 font-medium">{row.client_name}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.client_email}</td>
              <td className="py-1.5 px-2 capitalize">{row.type === "court" ? "Quadra" : "Aula"}</td>
              <td className="py-1.5 px-2">{DAYS[row.day_of_week]} {row.time}</td>
              <td className="py-1.5 px-2">{formatCurrency(Number(row.monthly_price))}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientesSemPlanoView({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground text-center py-4">Todos os clientes têm plano ativo</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {["Nome", "E-mail", "Telefone", "Cadastro"].map(h => (
              <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1.5 px-2 font-medium">{row.name}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.email}</td>
              <td className="py-1.5 px-2">{row.phone}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopClientesView({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground text-center py-4">Sem dados no período</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {["#", "Cliente", "E-mail", "Agendamentos", "Total gasto"].map(h => (
              <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1.5 px-2 font-bold text-primary">{i + 1}º</td>
              <td className="py-1.5 px-2 font-medium">{row.name}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.email}</td>
              <td className="py-1.5 px-2 text-center">{row.total_bookings}</td>
              <td className="py-1.5 px-2">{formatCurrency(Number(row.total_spent))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientesMaisAntigosView({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground text-center py-4">Nenhum plano ativo encontrado</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {["#", "Cliente", "E-mail", "Tipo", "Dia / Horário", "Valor/mês", "Ativo desde"].map(h => (
              <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1.5 px-2 font-bold text-primary">{i + 1}º</td>
              <td className="py-1.5 px-2 font-medium">{row.client_name}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.client_email}</td>
              <td className="py-1.5 px-2 capitalize">{row.type === "court" ? "Quadra" : "Aula"}</td>
              <td className="py-1.5 px-2">{DAYS[row.day_of_week]} {row.time}</td>
              <td className="py-1.5 px-2">{formatCurrency(Number(row.monthly_price))}</td>
              <td className="py-1.5 px-2">{row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TodosClientesView({ data }: { data: any[] }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground text-center py-4">Nenhum cliente cadastrado</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10">
            {["Nome", "E-mail", "Telefone", "Planos ativos", "Agendamentos ind.", "Cadastro"].map(h => (
              <th key={h} className="text-left py-2 px-2 text-muted-foreground font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              <td className="py-1.5 px-2 font-medium">{row.name}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.email}</td>
              <td className="py-1.5 px-2">{row.phone}</td>
              <td className="py-1.5 px-2 text-center">{row.active_plans}</td>
              <td className="py-1.5 px-2 text-center">{row.individual_bookings}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockDataView({ type, data }: { type: BlockId; data: any }) {
  if (!data) return <div className="flex items-center justify-center py-6 text-muted-foreground text-sm"><Loader2 size={16} className="animate-spin mr-2" /> Carregando...</div>;
  switch (type) {
    case "resumo_agendamentos": return <ResumoAgendamentosView data={data} />;
    case "receita_resumo": return <ReceitaResumoView data={data} />;
    case "agendamentos_recentes": return <AgendamentosRecentesView data={data} />;
    case "mensalistas_ativos": return <MensaListaView data={data} />;
    case "mensalistas_inativos": return <MensaListaView data={data} inactive />;
    case "clientes_sem_plano": return <ClientesSemPlanoView data={data} />;
    case "top_clientes": return <TopClientesView data={data} />;
    case "clientes_mais_antigos": return <ClientesMaisAntigosView data={data} />;
    case "todos_clientes": return <TodosClientesView data={data} />;
    default: return null;
  }
}

// ── Sortable block card ───────────────────────────────────────────────────────

function SortableBlock({
  cfg, def, data, onRemove, onUpdate,
}: {
  cfg: BlockConfig;
  def: BlockDef;
  data: any;
  onRemove: () => void;
  onUpdate: (patch: Partial<BlockConfig>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cfg.id });
  const [expanded, setExpanded] = useState(true);
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(cfg.title);

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="bg-card border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 md:px-4 py-3 bg-black/20">
        <button {...attributes} {...listeners} className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none">
          <GripVertical size={16} />
        </button>
        <div className="text-primary shrink-0">{def.icon}</div>
        {editTitle ? (
          <input
            autoFocus
            value={titleVal}
            onChange={e => setTitleVal(e.target.value)}
            onBlur={() => { onUpdate({ title: titleVal }); setEditTitle(false); }}
            onKeyDown={e => { if (e.key === "Enter") { onUpdate({ title: titleVal }); setEditTitle(false); } }}
            className="flex-1 min-w-0 bg-transparent border-b border-primary text-sm font-bold outline-none"
          />
        ) : (
          <span className="flex-1 min-w-0 text-sm font-bold cursor-pointer hover:text-primary truncate" onClick={() => setEditTitle(true)}>{cfg.title}</span>
        )}
        <button onClick={() => setExpanded(v => !v)} className="text-muted-foreground hover:text-foreground shrink-0 p-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <button onClick={onRemove} className="text-muted-foreground hover:text-rose-400 shrink-0 p-1">
          <X size={14} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 md:px-4 py-3 space-y-3">
          {(def.hasDateRange || def.hasLimit) && (
            <div className="flex flex-col sm:flex-row flex-wrap gap-2 text-xs">
              {def.hasDateRange && (
                <>
                  <label className="flex items-center gap-1 text-muted-foreground">
                    <span className="shrink-0">De:</span>
                    <input type="date" value={cfg.fromDate ?? ""} onChange={e => onUpdate({ fromDate: e.target.value || undefined })}
                      className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-foreground min-w-0" />
                  </label>
                  <label className="flex items-center gap-1 text-muted-foreground">
                    <span className="shrink-0">Até:</span>
                    <input type="date" value={cfg.toDate ?? ""} onChange={e => onUpdate({ toDate: e.target.value || undefined })}
                      className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-foreground min-w-0" />
                  </label>
                </>
              )}
              {def.hasLimit && (
                <label className="flex items-center gap-1 text-muted-foreground">
                  <span className="shrink-0">Máx. registros:</span>
                  <input type="number" min={1} max={200} value={cfg.limit ?? ""} onChange={e => onUpdate({ limit: Number(e.target.value) || undefined })}
                    className="bg-black/30 border border-white/10 rounded px-2 py-1.5 w-20 text-foreground" />
                </label>
              )}
            </div>
          )}
          <BlockDataView type={cfg.type} data={data} />
        </div>
      )}
    </div>
  );
}

// ── PDF print view ────────────────────────────────────────────────────────────

function PrintBlock({ cfg, def, data, primary }: { cfg: BlockConfig; def: BlockDef; data: any; primary: string }) {
  return (
    <div style={{ marginBottom: 32, pageBreakInside: "avoid" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${primary}` }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>{cfg.title}</span>
      </div>
      <div style={{ fontSize: 12, color: "#222" }}>
        <BlockDataViewPrint type={cfg.type} data={data} />
      </div>
    </div>
  );
}

function BlockDataViewPrint({ type, data }: { type: BlockId; data: any }) {
  if (!data) return <p style={{ color: "#888" }}>Sem dados</p>;

  const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 11 };
  const thStyle: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #ddd", color: "#555", fontWeight: 600 };
  const tdStyle: React.CSSProperties = { padding: "5px 8px", borderBottom: "1px solid #eee" };

  switch (type) {
    case "resumo_agendamentos": {
      const rows = [
        ["Total", data.total], ["Confirmados", data.confirmed], ["Concluídos", data.completed],
        ["Pendentes", data.pending], ["Cancelados", data.cancelled], ["Receita gerada", formatCurrency(data.revenue)],
      ];
      return (
        <table style={tableStyle}>
          <thead><tr>{["Métrica", "Valor"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>{rows.map(([l, v]) => <tr key={String(l)}><td style={tdStyle}>{l}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{v}</td></tr>)}</tbody>
        </table>
      );
    }
    case "receita_resumo": {
      const rows = [
        ["Agendamentos Individuais", data.agendamentos_individuais], ["Aulas", data.aulas],
        ["Mensalistas", data.mensalistas], ["Torneios", data.torneios], ["Total", data.total],
      ];
      return (
        <table style={tableStyle}>
          <thead><tr>{["Categoria", "Valor"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>{rows.map(([l, v]) => <tr key={String(l)}><td style={tdStyle}>{l}</td><td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(Number(v))}</td></tr>)}</tbody>
        </table>
      );
    }
    case "agendamentos_recentes": {
      if (!data?.length) return <p style={{ color: "#888" }}>Nenhum agendamento no período</p>;
      return (
        <table style={tableStyle}>
          <thead><tr>{["Tipo", "Cliente", "E-mail", "Data", "Horário", "Valor", "Status"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>{(data as any[]).map((row, i) => (
            <tr key={i}><td style={tdStyle}>{row.type}</td><td style={tdStyle}>{row.customer_name}</td><td style={tdStyle}>{row.customer_email}</td><td style={tdStyle}>{row.date}</td><td style={tdStyle}>{row.time}</td><td style={tdStyle}>{formatCurrency(Number(row.amount))}</td><td style={tdStyle}>{row.status}</td></tr>
          ))}</tbody>
        </table>
      );
    }
    case "mensalistas_ativos":
    case "mensalistas_inativos": {
      if (!data?.length) return <p style={{ color: "#888" }}>Nenhum registro</p>;
      return (
        <table style={tableStyle}>
          <thead><tr>{["Cliente", "E-mail", "Tipo", "Dia/Horário", "Valor/mês", "Desde"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>{(data as any[]).map((row, i) => (
            <tr key={i}><td style={tdStyle}>{row.client_name}</td><td style={tdStyle}>{row.client_email}</td><td style={tdStyle}>{row.type === "court" ? "Quadra" : "Aula"}</td><td style={tdStyle}>{DAYS[row.day_of_week]} {row.time}</td><td style={tdStyle}>{formatCurrency(Number(row.monthly_price))}</td><td style={tdStyle}>{row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "—"}</td></tr>
          ))}</tbody>
        </table>
      );
    }
    case "clientes_sem_plano":
    case "todos_clientes": {
      if (!data?.length) return <p style={{ color: "#888" }}>Nenhum registro</p>;
      const isAll = type === "todos_clientes";
      return (
        <table style={tableStyle}>
          <thead><tr>{["Nome", "E-mail", "Telefone", ...(isAll ? ["Planos ativos", "Agendamentos"] : []), "Cadastro"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>{(data as any[]).map((row, i) => (
            <tr key={i}><td style={tdStyle}>{row.name}</td><td style={tdStyle}>{row.email}</td><td style={tdStyle}>{row.phone}</td>{isAll && <><td style={{ ...tdStyle, textAlign: "center" }}>{row.active_plans}</td><td style={{ ...tdStyle, textAlign: "center" }}>{row.individual_bookings}</td></>}<td style={tdStyle}>{row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "—"}</td></tr>
          ))}</tbody>
        </table>
      );
    }
    case "top_clientes": {
      if (!data?.length) return <p style={{ color: "#888" }}>Sem dados</p>;
      return (
        <table style={tableStyle}>
          <thead><tr>{["#", "Cliente", "E-mail", "Agendamentos", "Total gasto"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>{(data as any[]).map((row, i) => (
            <tr key={i}><td style={tdStyle}>{i + 1}º</td><td style={tdStyle}>{row.name}</td><td style={tdStyle}>{row.email}</td><td style={{ ...tdStyle, textAlign: "center" }}>{row.total_bookings}</td><td style={tdStyle}>{formatCurrency(Number(row.total_spent))}</td></tr>
          ))}</tbody>
        </table>
      );
    }
    case "clientes_mais_antigos": {
      if (!data?.length) return <p style={{ color: "#888" }}>Nenhum plano ativo</p>;
      return (
        <table style={tableStyle}>
          <thead><tr>{["#", "Cliente", "E-mail", "Tipo", "Dia/Horário", "Valor/mês", "Ativo desde"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>{(data as any[]).map((row, i) => (
            <tr key={i}><td style={tdStyle}>{i + 1}º</td><td style={tdStyle}>{row.client_name}</td><td style={tdStyle}>{row.client_email}</td><td style={tdStyle}>{row.type === "court" ? "Quadra" : "Aula"}</td><td style={tdStyle}>{DAYS[row.day_of_week]} {row.time}</td><td style={tdStyle}>{formatCurrency(Number(row.monthly_price))}</td><td style={tdStyle}>{row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "—"}</td></tr>
          ))}</tbody>
        </table>
      );
    }
    default: return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminRelatorios() {
  const { getAuthHeaders } = useAdminAuth();
  const { profile } = useCompanyProfile();
  const [blocks, setBlocks] = useState<BlockConfig[]>([]);
  const [blockData, setBlockData] = useState<Record<string, any>>({});
  const [reportTitle, setReportTitle] = useState("Relatório");
  const [generating, setGenerating] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const addBlock = useCallback((type: BlockId) => {
    const def = BLOCK_DEFS.find(d => d.type === type)!;
    const id = `${type}_${Date.now()}`;
    setBlocks(prev => [...prev, { id, type, title: def.defaultTitle }]);
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
    setBlockData(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const updateBlock = useCallback((id: string, patch: Partial<BlockConfig>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setBlocks(prev => {
        const ai = prev.findIndex(b => b.id === active.id);
        const oi = prev.findIndex(b => b.id === over.id);
        return arrayMove(prev, ai, oi);
      });
    }
  }, []);

  useEffect(() => {
    const headers = getAuthHeaders();
    for (const cfg of blocks) {
      fetchBlock(cfg.type, cfg, headers)
        .then(data => setBlockData(prev => ({ ...prev, [cfg.id]: data })))
        .catch(() => setBlockData(prev => ({ ...prev, [cfg.id]: null })));
    }
  }, [blocks]);

  const generatePdf = async () => {
    if (!printRef.current || blocks.length === 0) return;
    setGenerating(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * pageW) / canvas.width;

      let yOffset = 0;
      while (yOffset < imgH) {
        if (yOffset > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, -yOffset, imgW, imgH);
        yOffset += pageH;
      }

      const date = new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
      pdf.save(`${reportTitle.replace(/\s+/g, "_")}_${date}.pdf`);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const primary = profile?.theme_primary ?? "#c9a227";
  const companyName = profile?.company_name ?? "Arenix";
  const logoUrl = profile?.logo_url;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl md:text-2xl font-display font-bold uppercase tracking-wider">Relatórios</h2>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Monte, personalize e exporte relatórios em PDF.</p>
        </div>
        <Button
          onClick={generatePdf}
          disabled={generating || blocks.length === 0}
          className="flex items-center gap-2 shrink-0"
          size="sm"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {generating ? "Gerando..." : "Gerar PDF"}
        </Button>
      </div>

      {/* Report title */}
      <Card className="p-3 md:p-4 flex items-center gap-3">
        <FileText size={16} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-1">Título do relatório</p>
          <input
            value={reportTitle}
            onChange={e => setReportTitle(e.target.value)}
            className="w-full bg-transparent text-base md:text-lg font-bold outline-none border-b border-white/10 focus:border-primary transition-colors"
            placeholder="Ex: Relatório Mensal — Abril 2026"
          />
        </div>
      </Card>

      {/* Mobile: collapsible block library toggle */}
      <div className="lg:hidden">
        <button
          onClick={() => setLibraryOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-card border border-white/10 rounded-xl text-sm font-bold"
        >
          <span className="flex items-center gap-2">
            <Plus size={14} className="text-primary" />
            Adicionar blocos ao relatório
          </span>
          {libraryOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </button>
        {libraryOpen && (
          <div className="mt-2 space-y-2">
            {BLOCK_DEFS.map(def => (
              <button
                key={def.type}
                onClick={() => { addBlock(def.type); setLibraryOpen(false); }}
                className="w-full text-left bg-card border border-white/10 rounded-xl p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors group active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className="text-primary shrink-0">{def.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold group-hover:text-primary transition-colors">{def.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{def.description}</p>
                  </div>
                  <Plus size={14} className="text-muted-foreground shrink-0" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Block library — desktop only */}
        <div className="hidden lg:block space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Blocos disponíveis</h3>
          {BLOCK_DEFS.map(def => (
            <button
              key={def.type}
              onClick={() => addBlock(def.type)}
              className="w-full text-left bg-card border border-white/10 rounded-xl p-3 hover:border-primary/50 hover:bg-primary/5 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <div className="text-primary mt-0.5 shrink-0">{def.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold group-hover:text-primary transition-colors">{def.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                </div>
                <Plus size={14} className="text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5" />
              </div>
            </button>
          ))}
        </div>

        {/* Active blocks */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Blocos no relatório {blocks.length > 0 && <span className="text-primary">({blocks.length})</span>}
          </h3>

          {blocks.length === 0 ? (
            <div className="border-2 border-dashed border-white/10 rounded-xl p-8 md:p-12 text-center text-muted-foreground">
              <FileText size={28} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Adicione blocos {window.innerWidth < 1024 ? "acima" : "à esquerda"} para montar seu relatório</p>
              <p className="text-xs mt-1 opacity-60">Reordene arrastando, edite o título e configure filtros de cada bloco</p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {blocks.map(cfg => {
                    const def = BLOCK_DEFS.find(d => d.type === cfg.type)!;
                    return (
                      <SortableBlock
                        key={cfg.id}
                        cfg={cfg}
                        def={def}
                        data={blockData[cfg.id]}
                        onRemove={() => removeBlock(cfg.id)}
                        onUpdate={patch => updateBlock(cfg.id, patch)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      {/* Hidden print area */}
      {blocks.length > 0 && (
        <div className="overflow-hidden h-0">
          <div
            ref={printRef}
            style={{
              width: 794,
              padding: 48,
              backgroundColor: "#ffffff",
              fontFamily: "Arial, sans-serif",
              color: "#111",
            }}
          >
            {/* PDF Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32, paddingBottom: 20, borderBottom: `3px solid ${primary}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {logoUrl && <img src={logoUrl} alt="logo" style={{ height: 52, objectFit: "contain" }} crossOrigin="anonymous" />}
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, color: "#111" }}>{companyName}</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: primary, marginTop: 2 }}>{reportTitle}</p>
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#666" }}>
                <p>Gerado em</p>
                <p style={{ fontWeight: 600 }}>{new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
              </div>
            </div>

            {/* Blocks */}
            {blocks.map(cfg => {
              const def = BLOCK_DEFS.find(d => d.type === cfg.type)!;
              return <PrintBlock key={cfg.id} cfg={cfg} def={def} data={blockData[cfg.id]} primary={primary} />;
            })}

            {/* PDF Footer */}
            <div style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid #ddd`, fontSize: 10, color: "#999", display: "flex", justifyContent: "space-between" }}>
              <span>{companyName} — {reportTitle}</span>
              <span>Gerado por Arenix</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
