import { useState, useEffect, useCallback } from "react";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { applyFavicon } from "@/hooks/useCompanyProfile";
import { useAdminLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Shield, Plus, Trash2, Eye, EyeOff, ChevronDown, ChevronRight,
  Building2, Users, RefreshCw, Loader2, Globe, Copy, CheckCircle,
  DollarSign, Clock, AlertCircle, History, X, CreditCard, Settings, Wifi, Upload, Key, Camera, Bell, BellOff,
} from "lucide-react";
import { useForm } from "react-hook-form";

const BASE = import.meta.env.BASE_URL;

function fmt(val: string | number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(val ?? 0));
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR");
}

function getTokenRole(token: string): string | null {
  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex === -1) return null;
    const payloadB64 = token.substring(0, dotIndex).replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payloadB64)).role ?? null;
  } catch { return null; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Admin { id: number; tenantId: number; name: string; email: string; active: boolean; notifyBookings: boolean; createdAt: string; }

interface Tenant {
  id: number; slug: string; name: string; customDomain: string | null; active: boolean;
  monthlyPrice: string | null; subscriptionStatus: string; nextBillingDate: string | null;
  billingEmail: string | null; admins: Admin[];
}

interface Billing {
  id: number; tenantId: number; amount: string; status: string;
  dueDate: string; paidAt: string | null; pixCopyPaste: string | null; notes: string | null; createdAt: string;
}

// ── Super Admin Login ────────────────────────────────────────────────────────

function SuperAdminLogin({ onLogin }: { onLogin: (t: string) => void }) {
  const mutation = useAdminLogin();
  const { register, handleSubmit } = useForm({ defaultValues: { password: "" } });
  const onSubmit = ({ password }: { password: string }) => {
    mutation.mutate({ data: { password } }, {
      onSuccess: (res: any) => {
        const role = getTokenRole(res?.token ?? "");
        if (res?.token && (role === "super_admin" || role === "admin")) { onLogin(res.token); }
        else toast.error("Acesso negado — senha incorreta ou conta sem privilégio");
      },
      onError: () => toast.error("Senha inválida"),
    });
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2"><Shield className="w-10 h-10 text-primary" /></div>
          <CardTitle className="text-2xl">Super Admin</CardTitle>
          <CardDescription>Gerenciamento global de tenants</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>Senha Master</Label>
              <Input type="password" autoComplete="current-password" {...register("password", { required: true })} />
            </div>
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirmar", loading = false }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; description: string; confirmLabel?: string; loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── DNS helpers ───────────────────────────────────────────────────────────────

/** Check if an IPv4 belongs to a CIDR range */
function ipInCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bits] = cidr.split("/");
    const mask = ~(0xffffffff >>> Number(bits)) >>> 0;
    const ipInt = ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
    const rangeInt = range.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
    return (ipInt & mask) === (rangeInt & mask);
  } catch { return false; }
}

/** Cloudflare proxy IP ranges — https://www.cloudflare.com/ips-v4 */
const CLOUDFLARE_CIDRS = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15",
  "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];

function isCloudflareProxyIp(ip: string): boolean {
  return CLOUDFLARE_CIDRS.some(cidr => ipInCidr(ip, cidr));
}

// ── DNS Panel ─────────────────────────────────────────────────────────────────

type DnsCheckResult = { connected: boolean; type?: string; value?: string; resolvedIp?: string; expectedIp?: string; error?: string } | null;

function DnsPanel({ domain, dnsTarget, tenantId, authHeaders }: {
  domain: string; dnsTarget: string; tenantId: number; authHeaders: Record<string, string>;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [dnsResult, setDnsResult] = useState<DnsCheckResult>(null);

  const copy = (val: string, key: string) => {
    navigator.clipboard.writeText(val).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000); });
  };

  const checkDns = async () => {
    setChecking(true);
    setDnsResult(null);
    try {
      const res = await fetch(`${BASE}api/super/tenants/${tenantId}/dns-check`, { headers: authHeaders });
      const data = await res.json();
      setDnsResult(data);
    } catch {
      setDnsResult({ connected: false, error: "Erro ao verificar DNS" });
    }
    setChecking(false);
  };

  return (
    <div className="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
          <Globe className="w-3.5 h-3.5" />
          Configuração DNS para <span className="font-mono">{domain}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dnsResult?.connected && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-400">
              <CheckCircle className="w-3.5 h-3.5" /> Domínio conectado
            </span>
          )}
          {dnsResult && !dnsResult.connected && dnsResult.value && dnsResult.expectedIp && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-400">
              <AlertCircle className="w-3.5 h-3.5" /> IP errado
            </span>
          )}
          {dnsResult && !dnsResult.connected && !dnsResult.value && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <AlertCircle className="w-3.5 h-3.5" /> Não resolvido
            </span>
          )}
          <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={checkDns} disabled={checking}>
            {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
            {checking ? "Verificando…" : "Testar domínio"}
          </Button>
        </div>
      </div>
      {dnsTarget ? (
        <div className="space-y-2.5 text-xs">
          {/* VPS mode: dnsTarget is a raw IP */}
          {/^\d{1,3}(\.\d{1,3}){3}$/.test(dnsTarget) ? (
            <div className="rounded border border-muted/20 bg-black/10 px-3 py-2.5 space-y-2">
              <p className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
                Configuração DNS — adicionar no seu provedor (Cloudflare, Registro.br, etc.)
              </p>
              <div className="space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
                  <span className="text-blue-400 font-bold">A</span>
                  <span>Nome: <strong className="text-foreground">@</strong> → Valor: <strong className="text-foreground">{dnsTarget}</strong></span>
                </div>
                <p className="text-[11px] text-orange-400 flex items-start gap-1 pt-0.5">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  Se usar Cloudflare: mantenha o proxy <strong>desativado (nuvem cinza ☁️ DNS only)</strong>.
                </p>
                <p className="text-[11px] text-muted-foreground/60">
                  Se havia um CNAME, remova-o — o registro A o substitui.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Replit mode */}
              <div className="rounded border border-yellow-500/40 bg-yellow-500/5 px-3 py-2.5 space-y-1.5">
                <p className="font-semibold text-yellow-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wide">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  Passo 1 — Registrar no Replit (obrigatório)
                </p>
                <p className="text-[12px] leading-relaxed text-yellow-200/80">
                  No painel do Replit, vá em <strong className="text-yellow-200">Deploy → Domains</strong> e
                  adicione <span className="font-mono text-yellow-100">{domain}</span>.
                </p>
              </div>
              <div className="rounded border border-muted/20 bg-black/10 px-3 py-2.5 space-y-2">
                <p className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
                  Passo 2 — Adicionar no DNS
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[12px]">
                  <span className="text-blue-400 font-bold">A</span>
                  <span className="text-muted-foreground">Nome: <strong className="text-foreground">@</strong> → IP fornecido pelo Replit</span>
                  <span className="text-blue-400 font-bold">TXT</span>
                  <span className="text-muted-foreground">Nome: <strong className="text-foreground">@</strong> → <code className="text-[11px] text-yellow-300">replit-verify=…</code></span>
                </div>
              </div>
              <div className="rounded border border-green-500/25 bg-green-500/5 px-3 py-2 text-[12px] text-green-200/80">
                <strong className="text-green-300">Passo 3 —</strong> Volte ao Replit e clique em <strong className="text-green-300">Link →</strong>.
              </div>
            </>
          )}

          {dnsResult?.connected && dnsResult.value && (
            <p className="text-green-400/80 text-[11px]">
              ✓ DNS resolvido via {dnsResult.type}: <span className="font-mono">{dnsResult.value}</span>
            </p>
          )}
          {dnsResult && !dnsResult.connected && dnsResult.value && dnsResult.expectedIp && (
            <p className="text-red-400 text-[11px] flex items-start gap-1">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              DNS aponta para <span className="font-mono mx-1">{dnsResult.value}</span> mas deveria ser <span className="font-mono mx-1">{dnsResult.expectedIp}</span> — atualize o registro A no seu provedor DNS.
            </p>
          )}
          {dnsResult && !dnsResult.connected && dnsResult.error && (
            <p className="text-yellow-400/80 text-[11px]">{dnsResult.error}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Configure o APP_URL no servidor para exibir o IP de destino.
        </p>
      )}
    </div>
  );
}

function DnsRow({ label, name, value, note, copied, onCopy }: {
  label: string; name: string; value: string; note?: string; copied: string | null; onCopy: (v: string, k: string) => void;
}) {
  const key = `${label}-${name}`;
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-black/20 px-2 py-1.5 font-mono">
      <span className="text-blue-300 w-12 shrink-0">{label}</span>
      <span className="text-muted-foreground w-28 shrink-0 truncate">{name}</span>
      <span className="flex-1 text-foreground truncate">{value} {note && <span className="text-muted-foreground not-italic font-sans text-[10px]">{note}</span>}</span>
      <button onClick={() => onCopy(value, key)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
        {copied === key ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ── Billing History Modal ─────────────────────────────────────────────────────

function BillingHistoryModal({ tenant, authHeaders, onClose }: { tenant: Tenant; authHeaders: Record<string, string>; onClose: () => void; }) {
  const [billings, setBillings] = useState<Billing[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingPaid, setMarkingPaid] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [pixVisible, setPixVisible] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${BASE}api/super/tenants/${tenant.id}/billings`, { headers: authHeaders })
      .then(r => r.json()).then(setBillings).finally(() => setLoading(false));
  }, [tenant.id]);

  const markPaid = async (billingId: number) => {
    setMarkingPaid(billingId);
    const res = await fetch(`${BASE}api/super/billings/${billingId}/paid`, { method: "POST", headers: authHeaders });
    if (res.ok) {
      toast.success("Marcado como pago!");
      setBillings(prev => prev.map(b => b.id === billingId ? { ...b, status: "paid", paidAt: new Date().toISOString() } : b));
    } else toast.error("Erro ao marcar como pago");
    setMarkingPaid(null);
  };

  const deleteBilling = async () => {
    if (!confirmDeleteId) return;
    setDeleting(confirmDeleteId);
    const res = await fetch(`${BASE}api/super/billings/${confirmDeleteId}`, { method: "DELETE", headers: authHeaders });
    if (res.ok) {
      toast.success("Cobrança excluída!");
      setBillings(prev => prev.filter(b => b.id !== confirmDeleteId));
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Erro ao excluir cobrança");
    }
    setDeleting(null);
    setConfirmDeleteId(null);
  };

  const statusBadge = (status: string) => {
    if (status === "paid") return <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">Pago</Badge>;
    if (status === "pending") return <Badge className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pendente</Badge>;
    return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4" /> Histórico de cobranças — {tenant.name}
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 space-y-2">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : billings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma cobrança ainda</p>
          ) : billings.map(b => (
            <div key={b.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {statusBadge(b.status)}
                  <span className="font-semibold text-sm">{fmt(b.amount)}</span>
                  <span className="text-xs text-muted-foreground">vence {fmtDate(b.dueDate)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {b.paidAt && <span className="text-xs text-green-400">pago em {fmtDate(b.paidAt)}</span>}
                  {b.status === "pending" && (
                    <>
                      <Button size="sm" className="h-6 text-xs" onClick={() => markPaid(b.id)} disabled={markingPaid === b.id || deleting === b.id}>
                        {markingPaid === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Marcar pago"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setConfirmDeleteId(b.id)} disabled={deleting === b.id || markingPaid === b.id} title="Excluir cobrança">
                        {deleting === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {b.pixCopyPaste && (
                <div>
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setPixVisible(pixVisible === b.id ? null : b.id)}
                  >
                    {pixVisible === b.id ? "Ocultar PIX" : "Ver código PIX"}
                  </button>
                  {pixVisible === b.id && (
                    <div className="mt-1 flex gap-2">
                      <code className="text-[10px] bg-muted rounded px-2 py-1 break-all flex-1">{b.pixCopyPaste}</code>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => { navigator.clipboard.writeText(b.pixCopyPaste!); toast.success("Copiado!"); }}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {b.notes && <p className="text-xs text-muted-foreground/70">{b.notes}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={deleteBilling}
        title="Excluir cobrança pendente"
        description="Esta cobrança será removida permanentemente. Essa ação não pode ser desfeita."
        confirmLabel="Excluir cobrança"
        loading={deleting !== null}
      />
    </div>
  );
}

// ── Edit Tenant Modal ─────────────────────────────────────────────────────────

function EditTenantModal({ tenant, authHeaders, onClose, onSuccess }: {
  tenant: Tenant; authHeaders: Record<string, string>; onClose: () => void; onSuccess: () => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [customDomain, setCustomDomain] = useState(tenant.customDomain ?? "");
  const [monthlyPrice, setMonthlyPrice] = useState(tenant.monthlyPrice ?? "");
  const [billingEmail, setBillingEmail] = useState(tenant.billingEmail ?? "");
  const [subscriptionStatus, setSubscriptionStatus] = useState(tenant.subscriptionStatus);
  const [nextBillingDate, setNextBillingDate] = useState(
    tenant.nextBillingDate ? new Date(tenant.nextBillingDate).toISOString().slice(0, 10) : ""
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`${BASE}api/super/tenants/${tenant.id}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name, customDomain: customDomain || null,
        monthlyPrice: monthlyPrice ? Number(monthlyPrice) : null,
        billingEmail: billingEmail || null,
        subscriptionStatus,
        nextBillingDate: nextBillingDate || null,
      }),
    });
    setLoading(false);
    if (res.ok) { toast.success("Tenant atualizado!"); onSuccess(); onClose(); }
    else { const d = await res.json(); toast.error(d.error ?? "Erro ao atualizar"); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Editar — {tenant.name}</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Domínio personalizado</Label>
              <Input value={customDomain} onChange={e => setCustomDomain(e.target.value.toLowerCase().trim())} placeholder="app.seuclube.com.br" />
              <p className="text-xs text-muted-foreground">Sem https:// — apenas o domínio</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Mensalidade (R$)</Label>
                <Input type="number" min="0" step="0.01" value={monthlyPrice} onChange={e => setMonthlyPrice(e.target.value)} placeholder="0,00" />
              </div>
              <div className="space-y-1">
                <Label>Status da assinatura</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={subscriptionStatus}
                  onChange={e => setSubscriptionStatus(e.target.value)}
                >
                  <option value="active">Ativo</option>
                  <option value="trial">Trial</option>
                  <option value="overdue">Inadimplente</option>
                  <option value="suspended">Suspenso</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>E-mail de cobrança</Label>
              <Input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} placeholder="financeiro@clube.com.br" />
              <p className="text-xs text-muted-foreground">Para onde enviamos o PIX a cada cobrança</p>
            </div>
            <div className="space-y-1">
              <Label>Próxima data de cobrança</Label>
              <Input type="date" value={nextBillingDate} onChange={e => setNextBillingDate(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Salvar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Add Admin Modal ────────────────────────────────────────────────────────────

function AddAdminModal({ tenantId, authHeaders, onClose, onSuccess }: {
  tenantId: number; authHeaders: Record<string, string>; onClose: () => void; onSuccess: () => void;
}) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false); const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) { toast.error("Preencha todos os campos"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/super/tenants/${tenantId}/admins`, {
        method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      setLoading(false);
      if (res.ok) { toast.success("Admin criado!"); onSuccess(); onClose(); }
      else { const d = await res.json(); console.error("Add admin error:", d); toast.error(d.error ?? "Erro ao criar admin"); }
    } catch (err) { 
      setLoading(false);
      console.error("Add admin exception:", err); 
      toast.error("Erro de conexão ao criar admin");
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Novo Admin</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Nome Sobrenome" /></div>
            <div className="space-y-1"><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@clube.com.br" /></div>
            <div className="space-y-1">
              <Label>Senha</Label>
              <div className="relative">
                <Input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
                <button type="button" className="absolute right-3 top-2.5 text-muted-foreground" onClick={() => setShowPw(!showPw)}>
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Criar Admin
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── New Tenant Modal ──────────────────────────────────────────────────────────

function AddTenantModal({ authHeaders, onClose, onSuccess }: { authHeaders: Record<string, string>; onClose: () => void; onSuccess: () => void; }) {
  const [name, setName] = useState(""); const [slug, setSlug] = useState("");
  const [customDomain, setCustomDomain] = useState(""); const [monthlyPrice, setMonthlyPrice] = useState("");
  const [billingEmail, setBillingEmail] = useState(""); const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !slug) { toast.error("Nome e slug são obrigatórios"); return; }
    setLoading(true);
    const res = await fetch(`${BASE}api/super/tenants`, {
      method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name, slug, customDomain: customDomain || undefined,
        monthlyPrice: monthlyPrice ? Number(monthlyPrice) : undefined,
        billingEmail: billingEmail || undefined,
        nextBillingDate: monthlyPrice ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined,
      }),
    });
    setLoading(false);
    if (res.ok) { toast.success(`Tenant "${name}" criado!`); onSuccess(); onClose(); }
    else { const d = await res.json(); toast.error(d.error ?? "Erro ao criar tenant"); }
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Novo Tenant (Cliente SaaS)</CardTitle>
            <CardDescription className="text-xs">Cada tenant é um clube/academia separado</CardDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="w-4 h-4" /></Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label>Nome do clube</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Arena Beach Club" />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>Slug <span className="text-muted-foreground text-xs">(identificador único)</span></Label>
                <Input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="arena-beach-club" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Domínio personalizado <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input value={customDomain} onChange={e => setCustomDomain(e.target.value.toLowerCase().trim())} placeholder="app.arenabeach.com.br" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Mensalidade (R$)</Label>
                <Input type="number" min="0" step="0.01" value={monthlyPrice} onChange={e => setMonthlyPrice(e.target.value)} placeholder="0,00" />
              </div>
              <div className="space-y-1">
                <Label>E-mail de cobrança</Label>
                <Input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} placeholder="fin@clube.com.br" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Criar Tenant
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Status badges ─────────────────────────────────────────────────────────────

function SubscriptionBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Ativo", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
    trial: { label: "Trial", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    overdue: { label: "Inadimplente", cls: "bg-red-500/20 text-red-400 border-red-500/30" },
    suspended: { label: "Suspenso", cls: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
    cancelled: { label: "Cancelado", cls: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  };
  const m = map[status] ?? { label: status, cls: "" };
  return <Badge className={`text-xs ${m.cls}`}>{m.label}</Badge>;
}

// ── Tenant Card ───────────────────────────────────────────────────────────────

function TenantCard({ tenant, authHeaders, onRefresh, dnsTarget, defaultTenantId }: {
  tenant: Tenant; authHeaders: Record<string, string>; onRefresh: () => void; dnsTarget: string; defaultTenantId: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showBillingHistory, setShowBillingHistory] = useState(false);
  const [charging, setCharging] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [capturingScreenshots, setCapturingScreenshots] = useState(false);

  const toggleActive = async () => {
    await fetch(`${BASE}api/super/tenants/${tenant.id}`, {
      method: "PUT", headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ active: !tenant.active }),
    });
    toast.success(tenant.active ? "Tenant desativado" : "Tenant ativado");
    onRefresh();
  };

  const generateCharge = async () => {
    setCharging(true);
    const res = await fetch(`${BASE}api/super/tenants/${tenant.id}/charge`, { method: "POST", headers: authHeaders });
    const data = await res.json();
    setCharging(false);
    if (!res.ok) { toast.error(data.error ?? "Erro ao gerar cobrança"); return; }
    if (data.warning) toast.warning(data.warning);
    else toast.success("Cobrança gerada! PIX enviado por e-mail.");
    onRefresh();
  };

  const deactivateAdmin = async (adminId: number) => {
    await fetch(`${BASE}api/super/tenants/${tenant.id}/admins/${adminId}`, { method: "DELETE", headers: authHeaders });
    toast.success("Admin desativado"); onRefresh();
  };

  const toggleAdminNotify = async (adminId: number, current: boolean) => {
    const res = await fetch(`${BASE}api/super/tenants/${tenant.id}/admins/${adminId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ notifyBookings: !current }),
    });
    if (res.ok) {
      toast.success(!current ? "Notificações ativadas" : "Notificações desativadas");
      onRefresh();
    } else {
      toast.error("Erro ao atualizar notificações");
    }
  };

  const activateAdmin = async (adminId: number) => {
    const res = await fetch(`${BASE}api/super/tenants/${tenant.id}/admins/${adminId}`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    if (res.ok) {
      toast.success("Admin ativado");
      onRefresh();
    } else {
      toast.error("Erro ao ativar admin");
    }
  };

  const deleteTenant = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${BASE}api/super/tenants/${tenant.id}`, { method: "DELETE", headers: authHeaders });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao excluir tenant"); return; }
      toast.success(`Tenant "${tenant.name}" excluído permanentemente.`);
      onRefresh();
    } catch { toast.error("Erro de conexão"); }
    finally { setDeleting(false); setShowDeleteConfirm(false); }
  };

  const generateScreenshots = async () => {
    const siteUrl = tenant.customDomain
      ? `https://${tenant.customDomain}`
      : prompt(`URL do site do tenant (ex: https://autoconsorcios.com.br):`);
    if (!siteUrl) return;
    setCapturingScreenshots(true);
    try {
      const res = await fetch(`${BASE}api/super/screenshots/capture`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id, baseUrl: siteUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao capturar screenshots"); return; }
      const ok = (data.results ?? []).filter((x: { status: string }) => x.status === "ok").length;
      const err = (data.results ?? []).filter((x: { status: string }) => x.status === "error").length;
      if (err === 0) toast.success(`Screenshots gerados: ${ok} páginas capturadas`);
      else toast.warning(`${ok} ok, ${err} com erro`);
    } catch { toast.error("Erro de conexão"); }
    finally { setCapturingScreenshots(false); }
  };

  const hasPrice = tenant.monthlyPrice && Number(tenant.monthlyPrice) > 0;

  return (
    <Card className={!tenant.active ? "opacity-60" : ""}>
      <CardHeader className="cursor-pointer pb-3" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Building2 className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{tenant.name}</span>
                <Badge variant="outline" className="text-xs font-mono">{tenant.slug}</Badge>
                {!tenant.active && <Badge variant="destructive" className="text-xs">Inativo</Badge>}
                {tenant.id === defaultTenantId && <Badge className="text-xs">Principal</Badge>}
                <SubscriptionBadge status={tenant.subscriptionStatus} />
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                {tenant.customDomain && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{tenant.customDomain}</span>}
                {hasPrice && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{fmt(tenant.monthlyPrice)}/mês</span>}
                {tenant.nextBillingDate && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Próx. {fmtDate(tenant.nextBillingDate)}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="secondary" className="text-xs">
              <Users className="w-3 h-3 mr-1" />{tenant.admins.filter(a => a.active).length} admin{tenant.admins.filter(a => a.active).length !== 1 ? "s" : ""}
            </Badge>
            {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {/* DNS Instructions */}
          {tenant.customDomain && <DnsPanel domain={tenant.customDomain} dnsTarget={dnsTarget} tenantId={tenant.id} authHeaders={authHeaders} />}

          {/* Billing warning */}
          {tenant.subscriptionStatus === "overdue" && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Este tenant está inadimplente. Considere suspender o acesso.
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowEdit(true)}>
              Editar tenant
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setShowBillingHistory(true)}>
              <History className="w-3 h-3" /> Cobranças
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={generateCharge} disabled={charging}>
              {charging ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
              Cobrar agora
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={generateScreenshots} disabled={capturingScreenshots}>
              {capturingScreenshots ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
              Screenshots
            </Button>
            {tenant.id !== 1 && (
              <>
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={toggleActive}>
                  {tenant.active ? "Desativar" : "Ativar"}
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="w-3 h-3" /> Excluir
                </Button>
              </>
            )}
            <Button size="sm" className="text-xs h-7 ml-auto" onClick={() => setShowAddAdmin(true)}>
              <Plus className="w-3 h-3 mr-1" /> Add admin
            </Button>
          </div>

          {/* Admins list */}
          <div>
            <span className="text-xs font-medium text-muted-foreground">Administradores</span>
            {tenant.admins.length === 0 ? (
              <p className="text-sm text-muted-foreground italic mt-1">Nenhum admin cadastrado</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {tenant.admins.map(admin => (
                  <div key={admin.id} className={`flex items-center justify-between p-2.5 rounded-lg border text-sm ${!admin.active ? "opacity-50" : ""}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{admin.name}</span>
                        {!admin.active && <Badge variant="secondary" className="text-xs">Inativo</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{admin.email}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {admin.active && (
                        <button
                          title={admin.notifyBookings ? "Recebe avisos de reservas (clique para desativar)" : "Não recebe avisos (clique para ativar)"}
                          onClick={() => toggleAdminNotify(admin.id, admin.notifyBookings)}
                          className={`h-7 px-2 rounded-md flex items-center gap-1.5 text-xs font-medium transition-colors ${
                            admin.notifyBookings
                              ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                              : "bg-muted/20 text-muted-foreground hover:bg-muted/40 border border-white/10"
                          }`}
                        >
                          {admin.notifyBookings ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
                          {admin.notifyBookings ? "Notif." : "Silenc."}
                        </button>
                      )}
                      {admin.active && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deactivateAdmin(admin.id)} title="Desativar admin">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {!admin.active && (
                        <Button variant="outline" size="sm" className="text-xs h-7 px-2 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => activateAdmin(admin.id)} title="Ativar admin">
                          <CheckCircle className="w-3 h-3 mr-1" /> Ativar
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}

      {showAddAdmin && <AddAdminModal tenantId={tenant.id} authHeaders={authHeaders} onClose={() => setShowAddAdmin(false)} onSuccess={onRefresh} />}
      {showEdit && <EditTenantModal tenant={tenant} authHeaders={authHeaders} onClose={() => setShowEdit(false)} onSuccess={onRefresh} />}
      {showBillingHistory && <BillingHistoryModal tenant={tenant} authHeaders={authHeaders} onClose={() => setShowBillingHistory(false)} />}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={deleteTenant}
        title={`Excluir "${tenant.name}"?`}
        description={`Esta ação é irreversível. Todos os dados do tenant serão permanentemente excluídos: clientes, agendamentos, torneios, configurações, admins e cobranças.`}
        confirmLabel="Excluir permanentemente"
        loading={deleting}
      />
    </Card>
  );
}

// ── Test MP Token Button ──────────────────────────────────────────────────────

function TestMpTokenButton({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE}api/super/settings/test-mp-token`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json() as { ok: boolean; message?: string; error?: string };
      setResult({ ok: data.ok, message: data.message ?? data.error ?? "Resultado desconhecido" });
      if (data.ok) toast.success("Token válido!");
      else toast.error(data.error ?? "Token inválido");
    } catch {
      setResult({ ok: false, message: "Erro de conexão" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      {result && (
        <span className={`text-xs ${result.ok ? "text-green-400" : "text-red-400"}`}>
          {result.ok ? "✓ Válido" : "✗ Inválido"}
        </span>
      )}
      <Button type="button" variant="outline" size="sm" className="text-xs h-7 shrink-0" onClick={test} disabled={testing}>
        {testing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
        Testar token
      </Button>
    </div>
  );
}

// ── Billing Settings Panel ────────────────────────────────────────────────────

interface BillingSettings {
  payment_provider: string;
  billing_mp_token: string;
  billing_mp_webhook_secret: string;
  billing_picpay_token: string;
  billing_picpay_key: string;
  billing_smtp_host: string;
  billing_smtp_port: string;
  billing_smtp_user: string;
  billing_smtp_pass: string;
  billing_smtp_from: string;
  billing_smtp_from_name: string;
  platform_name: string;
  platform_tagline: string;
  platform_logo_url: string;
  platform_favicon_url: string;
  default_tenant_id: string;
}

const EMPTY_SETTINGS: BillingSettings = {
  payment_provider: "mercadopago",
  billing_mp_token: "",
  billing_mp_webhook_secret: "",
  billing_picpay_token: "",
  billing_picpay_key: "",
  billing_smtp_host: "",
  billing_smtp_port: "587",
  billing_smtp_user: "",
  billing_smtp_pass: "",
  billing_smtp_from: "",
  billing_smtp_from_name: "",
  platform_name: "",
  platform_tagline: "",
  platform_logo_url: "",
  platform_favicon_url: "",
  default_tenant_id: "",
};

function resolveSuperLogoUrl(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/objects/")) return `${BASE}api/storage${raw}`;
  if (raw.startsWith("/tenant-")) return `${BASE}api/uploads${raw}`;
  if (raw.startsWith("/api/")) return raw;
  return raw;
}

function SuperChangePasswordCard({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) { toast.error("Preencha todos os campos"); return; }
    if (newPassword !== confirmPassword) { toast.error("As senhas não coincidem"); return; }
    if (newPassword.length < 6) { toast.error("Mínimo 6 caracteres"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/super/settings/change-password`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao alterar senha"); return; }
      toast.success("Senha alterada com sucesso!");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch { toast.error("Erro de conexão"); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          Alterar Senha do Super Admin
        </CardTitle>
        <CardDescription className="text-xs">
          Altere a senha de acesso ao painel super admin. A senha atual é necessária para confirmar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Senha Atual</Label>
            <div className="relative">
              <Input type={showCurrent ? "text" : "password"} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" className="text-sm pr-9" />
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowCurrent(v => !v)}>
                {showCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nova Senha</Label>
            <div className="relative">
              <Input type={showNew ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" className="text-sm pr-9" />
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNew(v => !v)}>
                {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirmar Nova Senha</Label>
            <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" className="text-sm" />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <Button type="submit" disabled={saving} size="sm" className="gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <Key className="w-3.5 h-3.5" />
              Alterar Senha
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function BillingSettingsPanel({ authHeaders, tenants }: { authHeaders: Record<string, string>; tenants: Tenant[] }) {
  const [settings, setSettings] = useState<BillingSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showMpToken, setShowMpToken] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [webhookUrlCopied, setWebhookUrlCopied] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);

  const defaultTenant = tenants.find(t => String(t.id) === String(settings.default_tenant_id));
  const webhookBase = defaultTenant?.customDomain
    ? `https://${defaultTenant.customDomain}`
    : window.location.origin;
  const webhookUrl = `${webhookBase}${BASE}api/super/billing/webhook`;

  useEffect(() => {
    fetch(`${BASE}api/super/settings`, { headers: authHeaders })
      .then(r => r.json())
      .then((data: Partial<BillingSettings>) => {
        setSettings(s => ({ ...s, ...data }));
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/super/settings`, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) toast.success("Configurações salvas!");
      else toast.error("Erro ao salvar configurações");
    } catch { toast.error("Erro de conexão"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
  <div className="space-y-6">
    <form onSubmit={handleSave} className="space-y-6">

      {/* Identidade da Plataforma */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Identidade da Plataforma
          </CardTitle>
          <CardDescription className="text-xs">
            Nome, tagline e logo que aparecem em todos os e-mails enviados aos clientes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da plataforma</Label>
              <Input
                placeholder="PlayHub"
                value={settings.platform_name}
                onChange={e => setSettings(s => ({ ...s, platform_name: e.target.value }))}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tagline</Label>
              <Input
                placeholder="Agendamentos, torneios e ranking em um só lugar"
                value={settings.platform_tagline}
                onChange={e => setSettings(s => ({ ...s, platform_tagline: e.target.value }))}
                className="text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Logo da Plataforma</Label>
            {resolveSuperLogoUrl(settings.platform_logo_url) ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-center justify-between gap-4 min-h-[80px]">
                <img
                  src={resolveSuperLogoUrl(settings.platform_logo_url)}
                  alt="Logo preview"
                  className="max-h-[60px] max-w-[180px] object-contain"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="flex flex-col gap-2 items-end shrink-0">
                  <label className={`cursor-pointer inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors ${uploadingLogo ? "opacity-50 pointer-events-none" : ""}`}>
                    {uploadingLogo ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    {uploadingLogo ? "Enviando…" : "Trocar logo"}
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingLogo} onChange={async e => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setUploadingLogo(true);
                      try {
                        const fd = new FormData(); fd.append("logo", file);
                        const res = await fetch(`${BASE}api/super/settings/logo`, { method: "POST", headers: authHeaders, body: fd });
                        const data = await res.json();
                        if (!res.ok) { toast.error(data.error ?? "Erro ao enviar logo"); return; }
                        setSettings(s => ({ ...s, platform_logo_url: data.path }));
                        toast.success("Logo atualizado!");
                      } catch { toast.error("Erro de conexão"); }
                      finally { setUploadingLogo(false); e.target.value = ""; }
                    }} />
                  </label>
                  <button type="button" className="text-xs text-destructive/70 hover:text-destructive" onClick={() => setSettings(s => ({ ...s, platform_logo_url: "" }))}>
                    Remover logo
                  </button>
                </div>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${uploadingLogo ? "opacity-50 cursor-not-allowed border-white/20" : "border-primary/40 hover:border-primary bg-black/20"}`}>
                {uploadingLogo
                  ? <><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Enviando…</span></>
                  : <><Upload className="w-5 h-5 text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Clique para enviar o logo (PNG, SVG, WebP)</span></>
                }
                <input type="file" accept="image/*" className="hidden" disabled={uploadingLogo} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setUploadingLogo(true);
                  try {
                    const fd = new FormData(); fd.append("logo", file);
                    const res = await fetch(`${BASE}api/super/settings/logo`, { method: "POST", headers: authHeaders, body: fd });
                    const data = await res.json();
                    if (!res.ok) { toast.error(data.error ?? "Erro ao enviar logo"); return; }
                    setSettings(s => ({ ...s, platform_logo_url: data.path }));
                    toast.success("Logo enviado!");
                  } catch { toast.error("Erro de conexão"); }
                  finally { setUploadingLogo(false); e.target.value = ""; }
                }} />
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              Recomendado: fundo transparente, PNG ou SVG. Aparece nos e-mails e na tela de acesso bloqueado.
            </p>
          </div>

          {/* Favicon */}
          <div className="space-y-1.5">
            <Label className="text-xs">Favicon do Super Admin</Label>
            {resolveSuperLogoUrl(settings.platform_favicon_url) ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-center justify-between gap-4 min-h-[72px]">
                <div className="flex items-center gap-3">
                  <img
                    src={resolveSuperLogoUrl(settings.platform_favicon_url)}
                    alt="Favicon preview"
                    className="w-8 h-8 object-contain rounded"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <span className="text-xs text-muted-foreground">Favicon configurado</span>
                </div>
                <div className="flex flex-col gap-2 items-end shrink-0">
                  <label className={`cursor-pointer inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors ${uploadingFavicon ? "opacity-50 pointer-events-none" : ""}`}>
                    {uploadingFavicon ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    {uploadingFavicon ? "Enviando…" : "Trocar favicon"}
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingFavicon} onChange={async e => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setUploadingFavicon(true);
                      try {
                        const fd = new FormData(); fd.append("favicon", file);
                        const res = await fetch(`${BASE}api/super/settings/favicon`, { method: "POST", headers: authHeaders, body: fd });
                        const data = await res.json();
                        if (!res.ok) { toast.error(data.error ?? "Erro ao enviar favicon"); return; }
                        setSettings(s => ({ ...s, platform_favicon_url: data.path }));
                        toast.success("Favicon atualizado!");
                      } catch { toast.error("Erro de conexão"); }
                      finally { setUploadingFavicon(false); e.target.value = ""; }
                    }} />
                  </label>
                  <button type="button" className="text-xs text-destructive/70 hover:text-destructive" onClick={() => setSettings(s => ({ ...s, platform_favicon_url: "" }))}>
                    Remover favicon
                  </button>
                </div>
              </div>
            ) : (
              <label className={`flex flex-col items-center justify-center w-full h-20 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${uploadingFavicon ? "opacity-50 cursor-not-allowed border-white/20" : "border-primary/40 hover:border-primary bg-black/20"}`}>
                {uploadingFavicon
                  ? <><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Enviando…</span></>
                  : <><Upload className="w-4 h-4 text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Clique para enviar o favicon (PNG, ICO, SVG)</span></>
                }
                <input type="file" accept="image/*,.ico" className="hidden" disabled={uploadingFavicon} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setUploadingFavicon(true);
                  try {
                    const fd = new FormData(); fd.append("favicon", file);
                    const res = await fetch(`${BASE}api/super/settings/favicon`, { method: "POST", headers: authHeaders, body: fd });
                    const data = await res.json();
                    if (!res.ok) { toast.error(data.error ?? "Erro ao enviar favicon"); return; }
                    setSettings(s => ({ ...s, platform_favicon_url: data.path }));
                    toast.success("Favicon enviado!");
                  } catch { toast.error("Erro de conexão"); }
                  finally { setUploadingFavicon(false); e.target.value = ""; }
                }} />
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              Aparece somente no navegador ao acessar o painel <code className="text-primary/80">/super</code>. Tamanho recomendado: 32×32 ou 64×64px.
            </p>
          </div>

          {/* Default tenant */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <Label className="text-xs">Tenant padrão (domínio sem match)</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={settings.default_tenant_id}
              onChange={e => setSettings(s => ({ ...s, default_tenant_id: e.target.value }))}
            >
              <option value="">— Tenant ID 1 (padrão do sistema) —</option>
              {tenants.map(t => (
                <option key={t.id} value={String(t.id)}>
                  #{t.id} — {t.name}{t.customDomain ? ` (${t.customDomain})` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Quando nenhum domínio configurado bate com a URL acessada, o sistema serve este tenant.
              Use para que o seu domínio principal (<span className="font-mono">arenix.com.br</span>) mostre o seu próprio sistema.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            Provedor de Pagamento
          </CardTitle>
          <CardDescription className="text-xs">
            Escolha qual integração será usada para gerar PIX e validar webhook.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label className="text-xs">Provedor padrão</Label>
          <select
            value={settings.payment_provider}
            onChange={e => setSettings(s => ({ ...s, payment_provider: e.target.value }))}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="mercadopago">Mercado Pago</option>
            <option value="picpay">PicPay</option>
          </select>
          <p className="text-xs text-muted-foreground">
            O provedor escolhido aqui será usado como padrão no tenant.
          </p>
        </CardContent>
      </Card>

      {/* Credenciais — Mercado Pago */}
      {settings.payment_provider === "mercadopago" && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            Mercado Pago — Cobrança de clientes
          </CardTitle>
          <CardDescription className="text-xs">
            Token usado para gerar PIX e cobrar os clubes clientes da plataforma.
            Diferente do token que cada clube usa para seus próprios agendamentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Access Token</Label>
            <div className="relative">
              <Input
                type={showMpToken ? "text" : "password"}
                placeholder="APP_USR-xxxxxxxx..."
                value={settings.billing_mp_token}
                onChange={e => setSettings(s => ({ ...s, billing_mp_token: e.target.value }))}
                className="pr-10 font-mono text-sm"
              />
              <button type="button" onClick={() => setShowMpToken(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showMpToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Use o <strong>Access Token</strong> (não a Public Key). Deixe em branco para manter o valor atual.</p>
              <TestMpTokenButton authHeaders={authHeaders} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Webhook Secret</Label>
            <div className="relative">
              <Input
                type={showWebhookSecret ? "text" : "password"}
                placeholder="Chave secreta gerada pelo Mercado Pago"
                value={settings.billing_mp_webhook_secret}
                onChange={e => setSettings(s => ({ ...s, billing_mp_webhook_secret: e.target.value }))}
                className="pr-10 font-mono text-sm"
              />
              <button type="button" onClick={() => setShowWebhookSecret(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showWebhookSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Encontrado em Mercado Pago → Seu negócio → Webhooks → Chave secreta.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">URL do Webhook</Label>
            <Input value={webhookUrl} readOnly className="font-mono text-sm" />
          </div>

          {/* Webhook URL info box */}
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
            <p className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              URL do Webhook — configure no Mercado Pago
            </p>
            <div className="flex items-center gap-2 rounded bg-black/20 px-2 py-1.5 font-mono text-xs">
              <span className="flex-1 text-foreground break-all">{webhookUrl}</span>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(webhookUrl).then(() => { setWebhookUrlCopied(true); setTimeout(() => setWebhookUrlCopied(false), 2000); }); }}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {webhookUrlCopied ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground/70">
              No painel do Mercado Pago: <strong>Seu negócio → Webhooks</strong> → adicione esta URL com o evento <strong>Pagamentos</strong>. Após salvar, copie a chave secreta gerada e cole no campo acima.
            </p>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Credenciais — PicPay */}
      {settings.payment_provider === "picpay" && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            PicPay — Cobrança de clientes
          </CardTitle>
          <CardDescription className="text-xs">
            Credenciais PicPay usadas para gerar PIX de cobrança dos clubes clientes da plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">x-picpay-token</Label>
            <div className="relative">
              <Input
                type={showMpToken ? "text" : "password"}
                placeholder="Token de produção PicPay"
                value={settings.billing_picpay_token}
                onChange={e => setSettings(s => ({ ...s, billing_picpay_token: e.target.value }))}
                className="pr-10 font-mono text-sm"
              />
              <button type="button" onClick={() => setShowMpToken(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showMpToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Token de autenticação da API PicPay. Deixe em branco para manter o valor atual.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Token de segurança do webhook</Label>
            <div className="relative">
              <Input
                type={showWebhookSecret ? "text" : "password"}
                placeholder="Token adicionado à URL do webhook"
                value={settings.billing_picpay_key}
                onChange={e => setSettings(s => ({ ...s, billing_picpay_key: e.target.value }))}
                className="pr-10 font-mono text-sm"
              />
              <button type="button" onClick={() => setShowWebhookSecret(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showWebhookSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Será adicionado como <code className="font-mono text-xs">?token=</code> na URL de callback para validar notificações.
            </p>
          </div>

          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
            <p className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              URL do Webhook — configure no PicPay
            </p>
            <div className="flex items-center gap-2 rounded bg-black/20 px-2 py-1.5 font-mono text-xs">
              <span className="flex-1 text-foreground break-all">
                {`${webhookBase}/api/super/billing/picpay-webhook?token=<seu-token>`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70">
              No painel PicPay, configure esta URL como <strong>callbackUrl</strong> ao criar cobranças.
              Substitua <code className="font-mono text-xs">&lt;seu-token&gt;</code> pelo valor acima.
            </p>
          </div>
        </CardContent>
      </Card>
      )}

      {/* SMTP */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            E-mail — Envio de cobranças
          </CardTitle>
          <CardDescription className="text-xs">
            Conta de e-mail usada para enviar os boletos/PIX de mensalidade para os clientes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Servidor SMTP (Host)</Label>
            <Input placeholder="smtp.gmail.com" value={settings.billing_smtp_host}
              onChange={e => setSettings(s => ({ ...s, billing_smtp_host: e.target.value }))} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Porta</Label>
            <Input placeholder="587" value={settings.billing_smtp_port}
              onChange={e => setSettings(s => ({ ...s, billing_smtp_port: e.target.value }))} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Usuário (e-mail de login)</Label>
            <Input placeholder="contato@azuos.com.br" type="email" value={settings.billing_smtp_user}
              onChange={e => setSettings(s => ({ ...s, billing_smtp_user: e.target.value }))} className="text-sm" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Senha / App Password</Label>
            <div className="relative">
              <Input
                type={showSmtpPass ? "text" : "password"}
                placeholder="••••••••"
                value={settings.billing_smtp_pass}
                onChange={e => setSettings(s => ({ ...s, billing_smtp_pass: e.target.value }))}
                className="pr-10 text-sm"
              />
              <button type="button" onClick={() => setShowSmtpPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">E-mail remetente (From)</Label>
            <Input placeholder="financeiro@azuos.com.br" type="email" value={settings.billing_smtp_from}
              onChange={e => setSettings(s => ({ ...s, billing_smtp_from: e.target.value }))} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome do remetente</Label>
            <Input placeholder="Azuos Esportes" value={settings.billing_smtp_from_name}
              onChange={e => setSettings(s => ({ ...s, billing_smtp_from_name: e.target.value }))} className="text-sm" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving} className="gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar configurações
        </Button>
      </div>
    </form>

    <SuperChangePasswordCard authHeaders={authHeaders} />
  </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Super() {
  const { token, login, getAuthHeaders } = useAdminAuth();
  const [superToken, setSuperToken] = useState<string | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [dnsTarget, setDnsTarget] = useState("");
  const [activeTab, setActiveTab] = useState<"tenants" | "settings">("tenants");
  const [defaultTenantId, setDefaultTenantId] = useState<number | null>(null);
  const [platformName, setPlatformName] = useState("Super Admin");
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");

  // Store original title/favicon on mount and restore on unmount
  useEffect(() => {
    const originalTitle = document.title;
    const originalHref = (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href ?? "";
    return () => {
      document.title = originalTitle;
      document.querySelectorAll("link[rel~='icon']").forEach(el => el.remove());
      if (originalHref) {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = originalHref;
        document.head.appendChild(link);
      }
    };
  }, []);

  const isSuperAdmin = !!superToken && (getTokenRole(superToken) === "super_admin" || getTokenRole(superToken) === "admin");
  const authHeaders: Record<string, string> = superToken ? { "x-admin-key": superToken } : getAuthHeaders();

  useEffect(() => {
    const role = token ? getTokenRole(token) : null;
    if (role === "super_admin" || role === "admin") setSuperToken(token);
  }, [token]);

  const fetchTenants = useCallback(async (headers: Record<string, string>) => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}api/super/tenants`, { headers });
      if (!res.ok) { toast.error("Erro ao carregar tenants"); return; }
      setTenants(await res.json());
    } catch { toast.error("Erro de conexão"); }
    finally { setLoading(false); }
  }, []);

  const fetchServerInfo = useCallback(async (headers: Record<string, string>) => {
    try {
      const res = await fetch(`${BASE}api/super/server-info`, { headers });
      if (res.ok) { const d = await res.json(); setDnsTarget(d.dnsTarget ?? ""); }
    } catch { /* silent */ }
  }, []);

  const fetchDefaultTenantId = useCallback(async (headers: Record<string, string>) => {
    try {
      const res = await fetch(`${BASE}api/super/settings`, { headers });
      if (res.ok) {
        const data: Partial<BillingSettings> = await res.json();
        if (data.default_tenant_id) setDefaultTenantId(Number(data.default_tenant_id));
        const name = data.platform_name || "Super Admin";
        setPlatformName(name);
        document.title = `${name} — Super Admin`;
        const logoRaw = data.platform_logo_url ?? "";
        if (logoRaw) setPlatformLogoUrl(resolveSuperLogoUrl(logoRaw));
        const faviconRaw = data.platform_favicon_url ?? "";
        if (faviconRaw) applyFavicon(resolveSuperLogoUrl(faviconRaw), true);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (isSuperAdmin && superToken) {
      const h = { "x-admin-key": superToken };
      fetchTenants(h);
      fetchServerInfo(h);
      fetchDefaultTenantId(h);
    }
  }, [isSuperAdmin, superToken]);

  const handleSuperLogin = (t: string) => {
    setSuperToken(t); login(t);
    const h = { "x-admin-key": t };
    fetchTenants(h);
    fetchServerInfo(h);
    fetchDefaultTenantId(h);
    toast.success("Acesso liberado!");
  };

  if (!isSuperAdmin) return <SuperAdminLogin onLogin={handleSuperLogin} />;

  const active = tenants.filter(t => t.active);
  const overdue = tenants.filter(t => t.subscriptionStatus === "overdue");

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {platformLogoUrl
              ? <img src={platformLogoUrl} alt="logo" className="h-7 w-auto object-contain" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              : <Shield className="w-5 h-5 text-primary" />
            }
            <span className="font-bold text-lg">{platformName}</span>
            <Badge variant="outline" className="text-xs">Super Admin</Badge>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "tenants" && (
              <>
                <Button variant="outline" size="sm" onClick={() => fetchTenants(authHeaders)} disabled={loading}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
                </Button>
                <Button size="sm" onClick={() => setShowAddTenant(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Novo Tenant
                </Button>
              </>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-4xl mx-auto px-4 flex gap-1 pb-0">
          <button
            onClick={() => setActiveTab("tenants")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "tenants" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Building2 className="w-3.5 h-3.5" /> Tenants
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "settings" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Settings className="w-3.5 h-3.5" /> Configurações de Cobrança
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {activeTab === "tenants" ? (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total de tenants", value: tenants.length, icon: Building2 },
                { label: "Ativos", value: active.length, icon: CheckCircle },
                { label: "Inadimplentes", value: overdue.length, icon: AlertCircle, warn: overdue.length > 0 },
              ].map(s => (
                <Card key={s.label} className={`p-3 ${s.warn ? "border-red-500/30" : ""}`}>
                  <div className="flex items-center gap-2">
                    <s.icon className={`w-4 h-4 ${s.warn ? "text-red-400" : "text-muted-foreground"}`} />
                    <div>
                      <p className="text-xl font-bold leading-none">{s.value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-3">
                {tenants.map(tenant => (
                  <TenantCard key={tenant.id} tenant={tenant} authHeaders={authHeaders} onRefresh={() => fetchTenants(authHeaders)} dnsTarget={dnsTarget} defaultTenantId={defaultTenantId} />
                ))}
              </div>
            )}
          </>
        ) : (
          <BillingSettingsPanel authHeaders={authHeaders} tenants={tenants} />
        )}
      </div>

      {showAddTenant && <AddTenantModal authHeaders={authHeaders} onClose={() => setShowAddTenant(false)} onSuccess={() => fetchTenants(authHeaders)} />}
    </div>
  );
}

