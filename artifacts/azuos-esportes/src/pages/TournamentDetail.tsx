import { PageLayout } from "@/components/layout/PageLayout";
import { Button, Card, Badge, Select } from "@/components/ui";
import {
  useGetTournament, useGetTournamentChampions, useGetStandings, useGetMatches,
  getGetStandingsQueryKey, getGetMatchesQueryKey, getGetTournamentChampionsQueryKey,
} from "@workspace/api-client-react";
import { useParams } from "wouter";
import { useState, useEffect } from "react";
import { Trophy, Calendar as CalendarIcon, MapPin, Users, Medal, X, Award, ClipboardList, CheckCircle, QrCode, Copy, ChevronDown, ChevronUp, User, Shirt, School, Phone, Tag, CheckCircle2, Loader2, Instagram, Camera, Upload } from "lucide-react";
import { formatDate, cn } from "@/lib/utils";

type RegistrationType = "individual" | "dupla" | "trio";
type ShirtSize = "PP" | "P" | "M" | "G" | "GG" | "XGG";

interface PlayerForm {
  fullName: string;
  nickname: string;
  cpf: string;
  phone: string;
  email: string;
  age: string;
  shirtSize: ShirtSize | "";
  school: string;
  instagram: string;
  photoUrl: string;
}

const emptyPlayer = (): PlayerForm => ({ fullName: "", nickname: "", cpf: "", phone: "", email: "", age: "", shirtSize: "", school: "", instagram: "", photoUrl: "" });

const formatCPF = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const formatPhone = (value: string) => {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

const unformat = (val: string) => val.replace(/\D/g, "");

export default function TournamentDetail() {
  const { id } = useParams();
  const tid = Number(id);
  const { data: tournament, isLoading } = useGetTournament(tid, { query: { refetchInterval: 15000 } });
  
  const [activeTab, setActiveTab] = useState<"inscrições" | "info" | "categories" | "standings" | "grupos" | "eliminatórias" | "champions">("info");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  // Registration form state
  const [regCategory, setRegCategory] = useState("");
  const [regPlayers, setRegPlayers] = useState<PlayerForm[]>([emptyPlayer(), emptyPlayer()]);
  const [regNotes, setRegNotes] = useState("");
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regSuccess, setRegSuccess] = useState<{ pixQrCodeBase64?: string | null; pixCopiaECola?: string | null; expiresAt?: string | null; registrationId?: number } | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);
  const [pixTimeLeft, setPixTimeLeft] = useState<number | null>(null); // seconds remaining
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  // Coupon state
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discountType: string; discountValue: string; originalPrice: string; discountAmount: string; finalPrice: string } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  // Player photo upload state
  const [playerPhotoUploading, setPlayerPhotoUploading] = useState<boolean[]>([false, false, false]);

  const handlePlayerPhotoChange = async (idx: number, file: File) => {
    setPlayerPhotoUploading((prev) => prev.map((v, i) => i === idx ? true : v));
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch(`${import.meta.env.BASE_URL}api/tournaments/player-upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao enviar foto");
      updatePlayer(idx, "photoUrl", data.url as string);
    } catch {
      // ignore upload errors silently
    } finally {
      setPlayerPhotoUploading((prev) => prev.map((v, i) => i === idx ? false : v));
    }
  };

  // Scroll to top on tab change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  // Derive initial selected category once data loads
  useEffect(() => {
    if (tournament?.categories?.length && !selectedCategory) {
      setSelectedCategory(tournament.categories[0].id);
    }
  }, [tournament?.categories, selectedCategory]);

  // Auto-open Inscrições tab when registrations are open
  useEffect(() => {
    if (tournament?.status === "open_registration") {
      setActiveTab("inscrições");
    }
  }, [tournament?.status]);

  // Sync regPlayers count based on tournament's registrationType
  useEffect(() => {
    if (!tournament?.registrationType) return;
    const count = tournament.registrationType === "individual" ? 1 : tournament.registrationType === "dupla" ? 2 : 3;
    setRegPlayers((prev) => {
      if (prev.length === count) return prev;
      if (prev.length > count) return prev.slice(0, count);
      return [...prev, ...Array(count - prev.length).fill(null).map(emptyPlayer)];
    });
  }, [tournament?.registrationType]);

  // Poll for payment confirmation
  useEffect(() => {
    if (!regSuccess?.registrationId || paymentConfirmed) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/tournaments/${tid}/registrations/${regSuccess.registrationId}`);
        if (res.ok) {
          const reg = await res.json();
          if (reg.status === "confirmed") {
            setPaymentConfirmed(true);
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
  }, [regSuccess?.registrationId, paymentConfirmed, tid]);

  const updatePlayer = (idx: number, field: keyof PlayerForm, value: string) => {
    setRegPlayers((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  // PIX countdown timer
  useEffect(() => {
    if (!regSuccess?.expiresAt) { setPixTimeLeft(null); return; }
    const target = new Date(regSuccess.expiresAt).getTime();
    const tick = () => {
      const remaining = Math.floor((target - Date.now()) / 1000);
      setPixTimeLeft(remaining > 0 ? remaining : 0);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [regSuccess?.expiresAt]);

  // Derive effective price: use selected category's price if set, else tournament's
  const selectedCategoryData = tournament?.categories?.find((c) => c.name === regCategory);
  const effectivePrice: string | null = selectedCategoryData?.registrationPrice
    ? selectedCategoryData.registrationPrice
    : (tournament?.registrationPrice ?? null);

  const handleValidateCoupon = async () => {
    if (!couponInput.trim()) return;
    setCouponError(null);
    setCouponLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tid}/validate-coupon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim(), categoryName: regCategory || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cupom inválido");
      setCouponApplied(data);
    } catch (err: unknown) {
      setCouponError(err instanceof Error ? err.message : "Cupom inválido");
      setCouponApplied(null);
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponApplied(null);
    setCouponInput("");
    setCouponError(null);
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    const missingPhoto = regPlayers.findIndex((p) => !p.photoUrl);
    if (missingPhoto !== -1) {
      setRegError(`Foto jogando é obrigatória para o Jogador ${missingPhoto + 1}.`);
      return;
    }
    setRegSubmitting(true);
    try {
      const res = await fetch(`/api/tournaments/${tid}/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationType: tournament?.registrationType || "dupla",
          categoryName: regCategory || undefined,
          players: regPlayers.map((p) => ({
            ...p,
            age: Number(p.age),
          })),
          notes: regNotes || undefined,
          couponCode: couponApplied?.code || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao enviar inscrição");
      setRegSuccess({ pixQrCodeBase64: data.pixQrCodeBase64, pixCopiaECola: data.pixCopiaECola, expiresAt: data.expiresAt, registrationId: data.id });
      setPaymentConfirmed(false);
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : "Erro ao enviar inscrição. Tente novamente.");
    } finally {
      setRegSubmitting(false);
    }
  };

  const copyPix = () => {
    if (regSuccess?.pixCopiaECola) {
      navigator.clipboard.writeText(regSuccess.pixCopiaECola);
      setCopiedPix(true);
      setTimeout(() => setCopiedPix(false), 2500);
    }
  };

  // Data fetching for tabs
  const catId = selectedCategory || 0;
  const { data: standings } = useGetStandings(tid, catId, { query: { queryKey: getGetStandingsQueryKey(tid, catId), enabled: activeTab === "standings" && !!selectedCategory } });
  const { data: matches } = useGetMatches(tid, catId, { query: { queryKey: getGetMatchesQueryKey(tid, catId), enabled: (activeTab === "grupos" || activeTab === "eliminatórias") && !!selectedCategory } });
  const { data: champions } = useGetTournamentChampions(tid, { query: { queryKey: getGetTournamentChampionsQueryKey(tid), enabled: activeTab === "champions" } });

  if (isLoading) return <PageLayout><div className="flex justify-center py-32"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div></PageLayout>;
  if (!tournament) return <PageLayout><div className="text-center py-32">Torneio não encontrado</div></PageLayout>;

  const sponsorsLeft = tournament.sponsors?.filter(s => s.position === 'left') || [];
  const sponsorsRight = tournament.sponsors?.filter(s => s.position === 'right') || [];
  const sponsorsBottom = tournament.sponsors?.filter(s => s.position === 'bottom') || [];
  
  const bracketMatches = matches?.filter(m => ['quarterfinals', 'semifinals', 'final', 'eighthfinals'].includes(m.phase)) || [];

  return (
    <PageLayout>
      <div className="flex max-w-[1600px] mx-auto">
        
        {/* Left Sponsors Sidebar */}
        <aside className="hidden xl:flex w-48 flex-col gap-6 py-12 px-4 sticky top-20 h-[calc(100vh-80px)] overflow-y-auto">
          {sponsorsLeft.map(s => {
            const url = s.websiteUrl ? (s.websiteUrl.startsWith('http') ? s.websiteUrl : `https://${s.websiteUrl}`) : '#';
            return (
              <a key={s.id} href={url} target={s.websiteUrl ? '_blank' : undefined} rel={s.websiteUrl ? 'noopener noreferrer' : undefined} className="bg-card rounded-xl p-3 border border-white/5 flex flex-col items-center hover:border-primary/30 hover:bg-card/80 transition-colors cursor-pointer">
                <div className="text-[10px] text-muted-foreground uppercase mb-2">Patrocinador</div>
                {s.logoUrl ? <img src={s.logoUrl} alt={s.name} className="w-full h-auto object-contain" /> : <div className="font-bold text-center">{s.name}</div>}
              </a>
            );
          })}
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-8 md:py-12">
          
          {/* Header */}
          <div className="mb-10 text-center md:text-left">
            <Badge variant="gold" className="mb-4">
              {tournament.status === 'upcoming' ? 'Em breve' : tournament.status === 'open_registration' ? '🏆 Inscrições Abertas' : tournament.status === 'ongoing' ? 'Em andamento' : 'Finalizado'}
            </Badge>
            <h1 className="text-5xl md:text-7xl font-display font-bold uppercase gold-gradient-text mb-4 leading-none">{tournament.name}</h1>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-muted-foreground">
              <span className="flex items-center gap-2"><CalendarIcon size={18} className="text-primary"/> {formatDate(tournament.startDate)}</span>
              {tournament.location && <span className="flex items-center gap-2"><MapPin size={18} className="text-primary"/> {tournament.location}</span>}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex overflow-x-auto border-b border-white/10 mb-8 hide-scrollbar">
            {[
              tournament.status === "open_registration" ? { id: "inscrições", label: "🏆 Inscrever-se" } : null,
              { id: "info", label: "Informações" },
              { id: "categories", label: "Categorias" },
              { id: "standings", label: "Classificação" },
              { id: "grupos", label: "Fase de Grupos" },
              { id: "eliminatórias", label: "Eliminatórias" },
              { id: "champions", label: "Campeões" },
            ].filter(Boolean).map((tab) => (
              <button
                key={tab!.id}
                onClick={() => setActiveTab(tab!.id as typeof activeTab)}
                className={cn(
                  "px-6 py-4 font-bold uppercase tracking-wider text-sm whitespace-nowrap transition-colors border-b-2",
                  activeTab === tab!.id
                    ? tab!.id === "inscrições" ? "border-primary text-primary bg-primary/5" : "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-white"
                )}
              >
                {tab!.label}
              </button>
            ))}
          </div>

          {/* Sub-navigation for categories (only if tab requires it) */}
          {['standings', 'grupos', 'eliminatórias'].includes(activeTab) && tournament.categories && tournament.categories.length > 0 && (
            <div className="mb-8 grid grid-cols-2 gap-3 md:flex md:w-full md:gap-3">
              {tournament.categories.sort((a, b) => a.id - b.id).map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "px-4 py-3 rounded-lg text-sm font-bold transition-all md:flex-1",
                    selectedCategory === cat.id 
                      ? "bg-primary text-black" 
                      : "bg-secondary/50 border border-white/10 text-muted-foreground hover:text-white hover:border-primary/50"
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {/* TAB CONTENTS */}
          <div className="min-h-[50vh] mb-24">

            {/* INSCRIÇÕES */}
            {activeTab === 'inscrições' && (
              <div className="max-w-3xl mx-auto">
                {regSuccess ? (
                  /* ── Sucesso / Expirado / Pagamento Confirmado ── */
                  <div className="text-center py-8">
                    {paymentConfirmed ? (
                      /* PAGAMENTO CONFIRMADO */
                      <>
                        <div className="w-24 h-24 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center mx-auto mb-8 animate-pulse">
                          <CheckCircle size={48} className="text-green-400" />
                        </div>
                        <h2 className="text-4xl font-display font-bold gold-gradient-text mb-4">🎉 Pagamento Confirmado!</h2>
                        <p className="text-lg text-muted-foreground mb-3">Sua inscrição foi confirmada com sucesso!</p>
                        <p className="text-muted-foreground mb-8">Você receberá um e-mail de confirmação com todos os detalhes da sua participação. Prepare-se para um grande evento! 🏆</p>
                        <div className="bg-primary/10 border border-primary/30 rounded-xl p-6 mb-8 text-left inline-block">
                          <p className="text-sm text-primary font-bold uppercase tracking-wide mb-2">Seus dados foram registrados</p>
                          <p className="text-muted-foreground text-sm">Verifique seu e-mail para instruções importantes e informações sobre o evento.</p>
                        </div>
                        <Button variant="gold" onClick={() => { setRegSuccess(null); setPaymentConfirmed(false); setRegPlayers([emptyPlayer(), emptyPlayer()]); setRegCategory(""); setPixTimeLeft(null); }}>
                          Voltar aos Detalhes do Torneio
                        </Button>
                      </>
                    ) : pixTimeLeft === 0 ? (
                      /* EXPIRADO */
                      <>
                        <div className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center mx-auto mb-6">
                          <X size={40} className="text-red-400" />
                        </div>
                        <h2 className="text-3xl font-display font-bold text-red-400 mb-2">Inscrição Expirada</h2>
                        <p className="text-muted-foreground mb-8">O tempo para pagamento via PIX expirou. Faça uma nova inscrição para tentar novamente.</p>
                        <Button variant="gold" onClick={() => { setRegSuccess(null); setPaymentConfirmed(false); setRegPlayers([emptyPlayer(), emptyPlayer()]); setRegCategory(""); setPixTimeLeft(null); }}>
                          Nova Inscrição
                        </Button>
                      </>
                    ) : (
                      /* AGUARDANDO PAGAMENTO */
                      <>
                        <div className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center mx-auto mb-6">
                          <CheckCircle size={40} className="text-green-400" />
                        </div>
                        <h2 className="text-3xl font-display font-bold gold-gradient-text mb-2">Inscrição Enviada!</h2>
                        <p className="text-muted-foreground mb-4">Você receberá um e-mail de confirmação. Efetue o pagamento para garantir sua vaga.</p>

                        {/* Countdown timer */}
                        {pixTimeLeft !== null && regSuccess.expiresAt && (
                          <div className={cn(
                            "flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold mb-6 border mx-auto w-fit",
                            pixTimeLeft > 120 ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" : "bg-red-500/10 border-red-500/40 text-red-400 animate-pulse"
                          )}>
                            <span>⏳ PIX expira em:</span>
                            <span className="font-mono text-base">
                              {String(Math.floor(pixTimeLeft / 60)).padStart(2, "0")}:{String(pixTimeLeft % 60).padStart(2, "0")}
                            </span>
                          </div>
                        )}

                        {regSuccess.pixQrCodeBase64 && (
                          <Card className="p-6 mb-6 border-primary/30 mx-auto w-fit">
                            <p className="text-sm font-bold mb-1 text-primary uppercase tracking-wider flex items-center justify-center gap-2"><QrCode size={16}/> Pague via PIX</p>
                            {regCategory && effectivePrice && Number(effectivePrice) > 0 && (
                              <p className="text-2xl font-display font-bold gold-gradient-text mb-4">R$ {Number(effectivePrice).toFixed(2).replace(".", ",")}</p>
                            )}
                            <img src={`data:image/png;base64,${regSuccess.pixQrCodeBase64}`} alt="QR Code PIX" className="w-56 h-56 mx-auto rounded-xl border border-white/10 mb-4" />
                            {regSuccess.pixCopiaECola && (
                              <button
                                onClick={copyPix}
                                className={cn("w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold border transition-all", copiedPix ? "border-green-500 text-green-400 bg-green-500/10" : "border-white/20 text-muted-foreground hover:text-white hover:border-white/40")}
                              >
                                {copiedPix ? <><CheckCircle size={16}/> Copiado!</> : <><Copy size={16}/> Copiar código PIX</>}
                              </button>
                            )}
                          </Card>
                        )}
                        {!regSuccess.pixQrCodeBase64 && (
                          <p className="text-muted-foreground text-sm mb-6">Aguarde as instruções de pagamento do organizador do torneio.</p>
                        )}
                        <div className="flex gap-4 justify-center">
                          <Button className="mt-2" variant="outline" onClick={() => { setRegSuccess(null); setPaymentConfirmed(false); setRegPlayers([emptyPlayer(), emptyPlayer()]); setRegCategory(""); setPixTimeLeft(null); }}>
                            Cancelar
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* ── Hero banner ── */}
                    <div className="relative overflow-hidden rounded-3xl mb-8 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent border border-primary/30 p-8 text-center">
                      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/15%)_0%,transparent_60%)]" />
                      <Trophy className="w-12 h-12 text-primary mx-auto mb-4 relative z-10" />
                      <h2 className="text-3xl md:text-4xl font-display font-bold gold-gradient-text mb-2 relative z-10">Inscreva-se Agora</h2>
                      <p className="text-muted-foreground relative z-10">
                        {tournament.registrationInfo || "Preencha os dados abaixo para garantir sua vaga no torneio."}
                      </p>
                      {regCategory && effectivePrice && Number(effectivePrice) > 0 && (
                        <div className="mt-4 inline-flex items-center gap-2 px-5 py-2 rounded-full bg-primary/20 border border-primary/40 relative z-10">
                          <span className="text-sm text-primary font-bold">
                            Valor: R$ {Number(effectivePrice).toFixed(2).replace(".", ",")}
                            {selectedCategoryData?.registrationPrice && (
                              <span className="font-normal text-primary/70 ml-1">({regCategory})</span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* ── Form ── */}
                    <form onSubmit={handleSubmitRegistration} className="space-y-8">

                      {/* Categoria */}
                      {tournament.categories && tournament.categories.length > 0 && (
                        <Card className="p-6 border-white/10">
                          <h3 className="text-lg font-display font-bold mb-4 flex items-center gap-2"><ClipboardList size={20} className="text-primary"/> Categoria</h3>
                          <select
                            value={regCategory}
                            onChange={(e) => { setRegCategory(e.target.value); setCouponApplied(null); setCouponInput(""); setCouponError(null); }}
                            className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary"
                          >
                            <option value="">Selecione a categoria</option>
                            {tournament.categories.sort((a, b) => a.id - b.id).map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}{c.registrationPrice && Number(c.registrationPrice) > 0 ? ` — R$ ${Number(c.registrationPrice).toFixed(2).replace(".", ",")}` : ""}
                              </option>
                            ))}
                          </select>
                        </Card>
                      )}

                      {/* Players */}
                      {regPlayers.map((player, idx) => (
                        <Card key={idx} className="p-6 border-white/10">
                          <h3 className="text-lg font-display font-bold mb-5 flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center text-sm font-bold text-primary">{idx + 1}</div>
                            <User size={18} className="text-primary"/>
                            {tournament?.registrationType === "individual" ? "Jogador" : idx === 0 ? "Jogador Principal" : `Jogador ${idx + 1}`}
                          </h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Nome Completo *</label>
                              <input required value={player.fullName} onChange={(e) => updatePlayer(idx, "fullName", e.target.value)}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="Nome completo do jogador" />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Apelido</label>
                              <input value={player.nickname} onChange={(e) => updatePlayer(idx, "nickname", e.target.value)}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="Apelido (opcional)" />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">CPF *</label>
                              <input required value={formatCPF(player.cpf)} onChange={(e) => updatePlayer(idx, "cpf", unformat(e.target.value))}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="000.000.000-00" maxLength={14} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Telefone *</label>
                              <input required value={formatPhone(player.phone)} onChange={(e) => updatePlayer(idx, "phone", unformat(e.target.value))}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="(11) 98765-4321" maxLength={15} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">E-mail *</label>
                              <input required type="email" value={player.email} onChange={(e) => updatePlayer(idx, "email", e.target.value)}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="email@exemplo.com" />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Idade *</label>
                              <input required type="number" min="1" max="100" value={player.age} onChange={(e) => updatePlayer(idx, "age", e.target.value)}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="Idade" />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block flex items-center gap-1"><Shirt size={12}/> Tamanho do Uniforme</label>
                              <select value={player.shirtSize} onChange={(e) => updatePlayer(idx, "shirtSize", e.target.value)}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary">
                                <option value="">Selecione</option>
                                {(["PP", "P", "M", "G", "GG", "XGG"] as ShirtSize[]).map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="md:col-span-2">
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block flex items-center gap-1"><School size={12}/> Escola / Academia</label>
                              <input value={player.school} onChange={(e) => updatePlayer(idx, "school", e.target.value)}
                                className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="Nome da escola ou academia (opcional)" />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block flex items-center gap-1"><Instagram size={12}/> Instagram</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                                <input value={player.instagram.replace(/^@/, "")} onChange={(e) => updatePlayer(idx, "instagram", e.target.value.replace(/^@/, ""))}
                                  className="w-full bg-secondary border border-white/10 rounded-lg pl-7 pr-4 py-3 text-sm focus:outline-none focus:border-primary" placeholder="seu.perfil (opcional)" />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block flex items-center gap-1"><Camera size={12}/> Foto jogando <span className="text-primary">*</span></label>
                              <label className="block cursor-pointer">
                                <div className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg border ${player.photoUrl ? "border-primary/50 bg-primary/5" : "border-dashed border-white/20 bg-secondary"} text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors`}>
                                  {playerPhotoUploading[idx] ? (
                                    <><Loader2 size={14} className="animate-spin"/><span>Enviando...</span></>
                                  ) : player.photoUrl ? (
                                    <><Camera size={14} className="text-primary"/><span className="text-primary text-xs truncate">Foto enviada ✓</span></>
                                  ) : (
                                    <><Upload size={14}/><span>Selecionar foto</span></>
                                  )}
                                </div>
                                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePlayerPhotoChange(idx, f); }} />
                              </label>
                              {player.photoUrl && (
                                <img src={player.photoUrl} alt="preview" className="mt-2 h-20 w-full object-cover rounded-lg border border-white/10" />
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}

                      {/* Observações */}
                      <Card className="p-6 border-white/10">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Observações (opcional)</label>
                        <textarea value={regNotes} onChange={(e) => setRegNotes(e.target.value)} rows={3}
                          className="w-full bg-secondary border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary resize-none"
                          placeholder="Alguma informação adicional?" />
                      </Card>

                      {/* Cupom de Desconto */}
                      {regCategory && effectivePrice && Number(effectivePrice) > 0 && (
                        <Card className="p-6 border-white/10">
                          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><Tag size={12}/> Cupom de Desconto</label>
                          {couponApplied ? (
                            <div className="flex items-center justify-between bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3">
                              <div className="flex items-center gap-2 text-green-400 text-sm font-bold">
                                <CheckCircle2 size={16}/>
                                <span>{couponApplied.code}</span>
                                <span className="text-green-300/70 font-normal">
                                  — {couponApplied.discountType === "percent"
                                    ? `${couponApplied.discountValue}% off`
                                    : `R$ ${Number(couponApplied.discountAmount).toFixed(2).replace(".", ",")} off`}
                                </span>
                              </div>
                              <button type="button" onClick={handleRemoveCoupon} className="text-muted-foreground hover:text-foreground transition-colors"><X size={16}/></button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={couponInput}
                                onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(null); }}
                                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleValidateCoupon())}
                                placeholder="CÓDIGO DO CUPOM"
                                className="flex-1 bg-secondary border border-white/10 rounded-lg px-4 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:border-primary uppercase"
                              />
                              <button
                                type="button"
                                onClick={handleValidateCoupon}
                                disabled={couponLoading || !couponInput.trim()}
                                className="px-4 py-2.5 bg-secondary border border-white/10 rounded-lg text-sm font-bold hover:border-primary/50 transition-colors disabled:opacity-50 flex items-center gap-2"
                              >
                                {couponLoading ? <Loader2 size={14} className="animate-spin"/> : <Tag size={14}/>}
                                Aplicar
                              </button>
                            </div>
                          )}
                          {couponError && <p className="mt-2 text-red-400 text-xs flex items-center gap-1"><X size={12}/> {couponError}</p>}
                          {couponApplied && (
                            <div className="mt-3 text-sm space-y-1">
                              <div className="flex justify-between text-muted-foreground">
                                <span>Valor original</span>
                                <span>R$ {Number(couponApplied.originalPrice).toFixed(2).replace(".", ",")}</span>
                              </div>
                              <div className="flex justify-between text-green-400">
                                <span>Desconto</span>
                                <span>− R$ {Number(couponApplied.discountAmount).toFixed(2).replace(".", ",")}</span>
                              </div>
                              <div className="flex justify-between font-bold text-foreground border-t border-white/10 pt-1 mt-1">
                                <span>Total</span>
                                <span>R$ {Number(couponApplied.finalPrice).toFixed(2).replace(".", ",")}</span>
                              </div>
                            </div>
                          )}
                        </Card>
                      )}

                      {regError && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm flex items-center gap-2">
                          <X size={16}/> {regError}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={regSubmitting}
                        className="w-full py-4 rounded-xl font-display font-bold text-lg uppercase tracking-wider text-black bg-gradient-to-r from-primary to-[hsl(var(--primary-highlight))] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                      >
                        {regSubmitting ? (
                          <><div className="w-5 h-5 border-2 border-black/40 border-t-black rounded-full animate-spin" /> Enviando...</>
                        ) : (
                          <>
                            <Trophy size={20}/>
                            Confirmar Inscrição
                            {regCategory && effectivePrice && Number(effectivePrice) > 0 && (
                              couponApplied
                                ? <span className="ml-1 opacity-80">— R$ {Number(couponApplied.finalPrice).toFixed(2).replace(".", ",")}</span>
                                : <span className="ml-1 opacity-80">— R$ {Number(effectivePrice).toFixed(2).replace(".", ",")}</span>
                            )}
                          </>
                        )}
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}

            {/* INFO */}
            {activeTab === 'info' && (
              <div className="prose prose-invert max-w-none">
                <p className="text-lg text-white/80 whitespace-pre-wrap">{tournament.description || "Nenhuma descrição fornecida."}</p>
                {tournament.bannerUrl && (
                  <img src={tournament.bannerUrl} alt="Banner" className="w-full max-w-4xl rounded-2xl mt-8 border border-white/10" />
                )}
              </div>
            )}

            {/* CATEGORIES */}
            {activeTab === 'categories' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tournament.categories?.map(cat => (
                  <Card key={cat.id} className="p-6">
                    <div className="flex justify-between items-start mb-6 pb-4 border-b border-white/5">
                      <h3 className="text-2xl font-display font-bold">{cat.name}</h3>
                    </div>
                    <div className="flex items-center gap-2 mb-4 text-muted-foreground">
                      <Users size={18} className="text-primary" /> {cat.pairs?.length || 0} Duplas Inscritas
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                      {cat.pairs?.map((p, idx) => (
                        <div key={p.id} className="flex justify-between items-center p-3 rounded-lg bg-black/30 border border-white/5">
                          <span className="text-sm font-medium text-white/60 w-6">{idx + 1}.</span>
                          <div className="flex-1 font-bold text-sm">
                            {p.player1Name} <span className="text-primary/50 text-xs px-1">&</span> {p.player2Name}
                          </div>
                        </div>
                      ))}
                      {(!cat.pairs || cat.pairs.length === 0) && <div className="text-sm text-muted-foreground">Nenhuma dupla registrada.</div>}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* STANDINGS */}
            {activeTab === 'standings' && standings && (
              <div className="space-y-8">
                {standings.groups.map(g => (
                  <Card key={g.groupName} className="overflow-hidden border-primary/20">
                    <div className="bg-primary/10 px-6 py-4 border-b border-primary/20">
                      <h3 className="font-display text-2xl font-bold text-primary">{g.groupName}</h3>
                    </div>
                    <div className="px-6 py-4 space-y-3">
                      <div className="flex items-center gap-6 text-xs uppercase text-muted-foreground font-bold border-b border-white/10 pb-2">
                        <div className="flex-1">Dupla</div>
                        <div className="w-8 text-center">J</div>
                        <div className="w-8 text-center">V</div>
                        <div className="w-8 text-center">D</div>
                        <div className="w-8 text-center">SP</div>
                        <div className="w-8 text-center">SC</div>
                        <div className="w-10 text-center">Saldo</div>
                      </div>
                      {g.standings.map((s, idx) => (
                        <div key={s.pairId} className={cn("flex items-center gap-6 hover:bg-white/5 transition-colors py-3", idx < g.standings.length - 1 && "border-b border-white/5")}>
                          <div className="flex-1 flex items-center gap-2">
                            <span className={cn("font-bold text-lg w-6", idx < 2 ? "text-primary" : "text-muted-foreground")}>{idx + 1}</span>
                            <span className="font-bold">{s.player1Name} / {s.player2Name}</span>
                          </div>
                          <div className="w-8 text-center text-sm">{s.played}</div>
                          <div className="w-8 text-center text-sm text-green-500">{s.won}</div>
                          <div className="w-8 text-center text-sm text-red-500">{s.lost}</div>
                          <div className="w-8 text-center text-sm">{s.setsWon}</div>
                          <div className="w-8 text-center text-sm">{s.setsLost}</div>
                          <div className={cn("w-10 text-center text-sm font-bold", s.setsWon - s.setsLost > 0 ? "text-green-500" : s.setsWon - s.setsLost < 0 ? "text-red-500" : "text-muted-foreground")}>{s.setsWon - s.setsLost > 0 ? "+" : ""}{s.setsWon - s.setsLost}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
                {standings.groups.length === 0 && <p className="text-muted-foreground">Grupos ainda não gerados para esta categoria.</p>}
              </div>
            )}

            {/* FASE DE GRUPOS */}
            {activeTab === 'grupos' && (
              <div className="space-y-8">
                {matches ? (
                  (() => {
                    const groupMatches = [...matches.filter(m => m.phase === "group" || m.phase === "group_stage")].sort((a, b) => a.id - b.id);
                    const groupNames = [...new Set(groupMatches.map(m => m.groupName || "Sem Grupo").filter(Boolean))].sort();
                    
                    return groupMatches.length > 0 ? (
                      <div className="space-y-6">
                        {groupNames.map(groupName => (
                          <Card key={groupName} className="overflow-hidden border-primary/20">
                            <div className="bg-primary/10 px-4 md:px-6 py-3 md:py-4 border-b border-primary/20">
                              <h3 className="font-display text-lg md:text-2xl font-bold text-primary">FASE DE GRUPOS - {groupName}</h3>
                            </div>
                            <div className="p-4 md:p-6 space-y-3 md:space-y-4">
                              {groupMatches.filter(m => (m.groupName || "Sem Grupo") === groupName).sort((a, b) => a.id - b.id).map(m => (
                                <div key={m.id} className="bg-background border border-white/5 rounded-lg p-3 md:p-4">
                                  {!m.completed && (m as any).court && (
                                    <div className="text-xs font-bold text-primary uppercase tracking-wider text-center mb-2">
                                      {(m as any).court}
                                    </div>
                                  )}
                                  {/* Desktop: horizontal layout */}
                                  <div className="hidden md:flex justify-between items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                      <span className={cn("font-bold text-sm truncate", m.winnerId === m.pair1Id && "text-primary")}>{m.pair1Name || "TBD"}</span>
                                    </div>
                                    <span className="font-bold text-sm tabular-nums shrink-0">{m.pair1Sets ?? '-'}</span>
                                    <span className="text-muted-foreground text-xs shrink-0">x</span>
                                    <span className="font-bold text-sm tabular-nums shrink-0">{m.pair2Sets ?? '-'}</span>
                                    <div className="flex-1 min-w-0 text-right">
                                      <span className={cn("font-bold text-sm truncate", m.winnerId === m.pair2Id && "text-primary")}>{m.pair2Name || "TBD"}</span>
                                    </div>
                                  </div>
                                  {/* Mobile: vertical stack */}
                                  <div className="md:hidden space-y-2">
                                    <div className="flex justify-between items-start gap-2">
                                      <span className={cn("font-bold text-sm flex-1 break-words", m.winnerId === m.pair1Id && "text-primary")}>{m.pair1Name || "TBD"}</span>
                                      <span className="font-bold text-sm tabular-nums shrink-0">{m.pair1Sets ?? '-'}</span>
                                    </div>
                                    <div className="flex justify-between items-start gap-2">
                                      <span className={cn("font-bold text-sm flex-1 break-words", m.winnerId === m.pair2Id && "text-primary")}>{m.pair2Name || "TBD"}</span>
                                      <span className="font-bold text-sm tabular-nums shrink-0">{m.pair2Sets ?? '-'}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">Nenhum jogo da fase de grupos para esta categoria.</p>
                    );
                  })()
                ) : (
                  <p className="text-muted-foreground">Carregando jogos...</p>
                )}
              </div>
            )}

            {/* ELIMINATÓRIAS */}
            {activeTab === 'eliminatórias' && (() => {
              const PHASE_ORDER = ['eighthfinals', 'quarterfinals', 'semifinals', 'final'];
              const PHASE_NAMES: Record<string, string> = { eighthfinals: 'Oitavas', quarterfinals: 'Quartas', semifinals: 'Semifinal', final: 'Final' };
              const elimMatches = matches?.filter(m => PHASE_ORDER.includes(m.phase)) || [];
              const activePhases = PHASE_ORDER.filter(p => elimMatches.some(m => m.phase === p));
              const maxMatches = activePhases.length > 0 ? Math.max(...activePhases.map(p => elimMatches.filter(m => m.phase === p).length)) : 0;
              // Each match slot = 90px card + spacing; all columns share same height for proper bracket alignment
              const bracketH = Math.max(maxMatches * 130, 260);

              const MatchCard = ({ m }: { m: typeof elimMatches[0] }) => (
                <div className="w-full bg-card border border-white/10 rounded-xl overflow-hidden shadow-xl">
                  <div className={cn("px-4 py-2.5 border-b border-white/5 flex items-center justify-between gap-3", m.winnerId === m.pair1Id && "bg-primary/10")}>
                    <span className={cn("font-semibold text-sm truncate", m.winnerId === m.pair1Id ? "text-primary" : "text-foreground/90")}>
                      {m.pair1Name || "A definir"}
                    </span>
                    <span className={cn("font-bold text-sm tabular-nums shrink-0 min-w-[1.5rem] text-right", m.winnerId === m.pair1Id ? "text-primary" : "text-muted-foreground")}>
                      {m.pair1Sets ?? "—"}
                    </span>
                  </div>
                  <div className={cn("px-4 py-2.5 flex items-center justify-between gap-3", m.winnerId === m.pair2Id && "bg-primary/10")}>
                    <span className={cn("font-semibold text-sm truncate", m.winnerId === m.pair2Id ? "text-primary" : "text-foreground/90")}>
                      {m.pair2Name || "A definir"}
                    </span>
                    <span className={cn("font-bold text-sm tabular-nums shrink-0 min-w-[1.5rem] text-right", m.winnerId === m.pair2Id ? "text-primary" : "text-muted-foreground")}>
                      {m.pair2Sets ?? "—"}
                    </span>
                  </div>
                </div>
              );

              if (!matches) return <p className="text-muted-foreground py-8">Carregando...</p>;
              if (activePhases.length === 0) return <p className="text-muted-foreground py-8">Nenhuma eliminatória gerada para esta categoria.</p>;

              return (
                <div className="pb-8 w-full">
                  {/* ── DESKTOP bracket ── */}
                  <div className="hidden md:flex flex-row items-stretch overflow-x-auto gap-0 select-none">
                    {activePhases.map((phase) => {
                      const phaseMatches = elimMatches.filter(m => m.phase === phase);
                      return (
                        <div key={phase} className="flex flex-col flex-shrink-0 w-56 lg:w-64 xl:w-72">
                          {/* Header */}
                          <div className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground/60 pb-4 px-3">
                            {PHASE_NAMES[phase]}
                          </div>
                          {/* Cards — all columns have same height; justify-around aligns each card to midpoint of its parent pair */}
                          <div
                            className="flex flex-col justify-around"
                            style={{ height: `${bracketH}px` }}
                          >
                            {phaseMatches.map(m => (
                              <div key={m.id} className="px-3">
                                <MatchCard m={m} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── MOBILE list by phase ── */}
                  <div className="md:hidden space-y-8">
                    {activePhases.map(phase => {
                      const phaseMatches = elimMatches.filter(m => m.phase === phase);
                      return (
                        <div key={phase}>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="flex-1 h-px bg-white/10" />
                            <span className="text-xs font-bold uppercase tracking-widest text-primary/70">{PHASE_NAMES[phase]}</span>
                            <div className="flex-1 h-px bg-white/10" />
                          </div>
                          <div className="space-y-3">
                            {phaseMatches.map(m => <MatchCard key={m.id} m={m} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* CHAMPIONS */}
            {activeTab === 'champions' && (
              <>
                {/* Category Tabs - All sizes */}
                <div className="mb-8 grid grid-cols-2 gap-3 md:flex md:w-full md:gap-3">
                  {champions?.sort((a, b) => a.categoryId - b.categoryId).map((cat) => (
                    <button
                      key={cat.categoryId}
                      onClick={() => setSelectedCategory(cat.categoryId)}
                      className={cn(
                        "px-4 py-3 rounded-lg text-sm font-bold transition-all md:flex-1",
                        selectedCategory === cat.categoryId 
                          ? "bg-primary text-black" 
                          : "bg-secondary/50 border border-white/10 text-muted-foreground hover:text-white hover:border-primary/50"
                      )}
                    >
                      {cat.categoryName}
                    </button>
                  ))}
                </div>

                {/* Champions Display - Only selected category */}
                <div className="flex flex-col items-center justify-center space-y-16 w-full">
                  {champions?.filter(c => c.categoryId === selectedCategory).map((catChamp) => (
                    <div key={catChamp.categoryId} className="w-full text-center">
                      <h3 className="font-display text-2xl md:text-4xl font-bold mb-8 md:mb-16 uppercase tracking-wider">{catChamp.categoryName}</h3>
                    
                    {catChamp.champion ? (
                      <div className="flex justify-center overflow-x-auto md:overflow-visible">
                        <div className="relative">
                          {/* Podium Container */}
                          <div className="flex items-flex-end justify-center gap-1 md:gap-8 h-auto md:h-96 flex-col md:flex-row">
                            {/* 1st Place - Champion (order 1 on mobile, center on desktop) */}
                            <div className="flex flex-col items-center w-full md:w-auto order-1 md:order-2">
                              <Trophy className="w-12 md:w-28 h-12 md:h-28 text-primary mx-auto mb-2 md:mb-6 drop-shadow-2xl animate-pulse" />
                              <div className="bg-gradient-to-b from-primary/30 to-primary/10 border-2 md:border-4 border-primary rounded-lg md:rounded-2xl p-3 md:p-8 w-full md:w-72 shadow-xl md:shadow-2xl">
                                {/* Champion Photo */}
                                {catChamp.champion.photoUrl && (
                                  <div className="mb-3 md:mb-6 flex justify-center cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setSelectedPhoto(catChamp.champion.photoUrl)}>
                                    <img 
                                      src={catChamp.champion.photoUrl} 
                                      alt="Champion" 
                                      className="w-24 md:w-40 h-24 md:h-40 rounded-full object-cover border-2 md:border-4 border-primary drop-shadow-lg"
                                    />
                                  </div>
                                )}
                                <div className="text-xs md:text-sm font-bold text-primary uppercase mb-2 md:mb-3 tracking-wider">Campeões</div>
                                <h4 className="font-display text-lg md:text-3xl font-bold gold-gradient-text mb-0.5 break-words">{catChamp.champion.player1Name}</h4>
                                {catChamp.champion.player1School && <p className="text-[10px] md:text-xs text-muted-foreground mb-1 md:mb-2 break-words">{catChamp.champion.player1School}</p>}
                                <h4 className="font-display text-lg md:text-3xl font-bold gold-gradient-text mb-0.5 break-words">{catChamp.champion.player2Name}</h4>
                                {catChamp.champion.player2School && <p className="text-[10px] md:text-xs text-muted-foreground break-words">{catChamp.champion.player2School}</p>}
                              </div>
                            </div>
                            
                            {/* 2nd Place - Runner Up (order 2 on mobile, right on desktop) */}
                            <div className="flex flex-col items-center w-full md:w-auto order-2 md:order-3">
                              {catChamp.runnerUp && (
                                <div className="bg-gradient-to-b from-gray-500/20 to-gray-500/5 border border-gray-400/30 md:border-2 rounded-lg p-3 md:p-4 w-full md:w-40 min-h-auto md:min-h-48 flex flex-col items-center justify-start">
                                  {catChamp.runnerUp.photoUrl ? (
                                    <div className="mb-2 md:mb-3 flex justify-center cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setSelectedPhoto(catChamp.runnerUp.photoUrl)}>
                                      <img 
                                        src={catChamp.runnerUp.photoUrl} 
                                        alt="2º Lugar" 
                                        className="w-20 md:w-32 h-20 md:h-32 rounded-full object-cover border border-gray-400 md:border-2 drop-shadow-lg"
                                      />
                                    </div>
                                  ) : (
                                    <div className="relative mb-2 md:mb-4">
                                      <Award className="w-10 md:w-16 h-10 md:h-16 text-gray-400 drop-shadow-lg" />
                                    </div>
                                  )}
                                  <div className="text-[10px] md:text-xs font-bold text-gray-400 uppercase mb-1 md:mb-2">2º Lugar</div>
                                  <div className="text-xs md:text-sm font-bold text-white text-center break-words">{catChamp.runnerUp.player1Name}</div>
                                  {catChamp.runnerUp.player1School && <div className="text-[8px] md:text-[10px] text-muted-foreground text-center break-words">{catChamp.runnerUp.player1School}</div>}
                                  <div className="text-xs md:text-sm font-bold text-white text-center mt-1 break-words">{catChamp.runnerUp.player2Name}</div>
                                  {catChamp.runnerUp.player2School && <div className="text-[8px] md:text-[10px] text-muted-foreground text-center break-words">{catChamp.runnerUp.player2School}</div>}
                                </div>
                              )}
                            </div>
                            
                            {/* 3rd Place - Terceiro lugar (order 3 on mobile, left on desktop) */}
                            <div className="flex flex-col items-center w-full md:w-auto order-3 md:order-1">
                              {catChamp.thirdPlace && (
                                <div className="bg-gradient-to-b from-amber-900/20 to-amber-900/5 border border-amber-700/30 md:border-2 rounded-lg p-3 md:p-4 w-full md:w-40 min-h-auto md:min-h-48 flex flex-col items-center justify-start">
                                  {catChamp.thirdPlace.photoUrl ? (
                                    <div className="mb-2 md:mb-3 flex justify-center cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setSelectedPhoto(catChamp.thirdPlace.photoUrl)}>
                                      <img 
                                        src={catChamp.thirdPlace.photoUrl} 
                                        alt="3º Lugar" 
                                        className="w-20 md:w-32 h-20 md:h-32 rounded-full object-cover border border-amber-700 md:border-2 drop-shadow-lg"
                                      />
                                    </div>
                                  ) : (
                                    <div className="relative mb-2 md:mb-4">
                                      <Medal className="w-10 md:w-16 h-10 md:h-16 text-amber-700 drop-shadow-lg" />
                                    </div>
                                  )}
                                  <div className="text-[10px] md:text-xs font-bold text-amber-700 uppercase mb-1 md:mb-2">3º Lugar</div>
                                  <div className="text-xs md:text-sm font-bold text-white text-center break-words">{catChamp.thirdPlace.player1Name}</div>
                                  {catChamp.thirdPlace.player1School && <div className="text-[8px] md:text-[10px] text-muted-foreground text-center break-words">{catChamp.thirdPlace.player1School}</div>}
                                  <div className="text-xs md:text-sm font-bold text-white text-center mt-1 break-words">{catChamp.thirdPlace.player2Name}</div>
                                  {catChamp.thirdPlace.player2School && <div className="text-[8px] md:text-[10px] text-muted-foreground text-center break-words">{catChamp.thirdPlace.player2School}</div>}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground py-12">Campeões não definidos</div>
                    )}
                  </div>
                ))}
                {champions?.length === 0 && <p className="text-muted-foreground">Nenhum campeão registrado.</p>}
              </div>
              </>
            )}

          </div>
        </div>

        {/* Right Sponsors Sidebar */}
        <aside className="hidden xl:flex w-48 flex-col gap-6 py-12 px-4 sticky top-20 h-[calc(100vh-80px)] overflow-y-auto">
          {sponsorsRight.map(s => {
            const url = s.websiteUrl ? (s.websiteUrl.startsWith('http') ? s.websiteUrl : `https://${s.websiteUrl}`) : '#';
            return (
              <a key={s.id} href={url} target={s.websiteUrl ? '_blank' : undefined} rel={s.websiteUrl ? 'noopener noreferrer' : undefined} className="bg-card rounded-xl p-3 border border-white/5 flex flex-col items-center hover:border-primary/30 hover:bg-card/80 transition-colors cursor-pointer">
                <div className="text-[10px] text-muted-foreground uppercase mb-2">Patrocinador</div>
                {s.logoUrl ? <img src={s.logoUrl} alt={s.name} className="w-full h-auto object-contain" /> : <div className="font-bold text-center">{s.name}</div>}
              </a>
            );
          })}
        </aside>

      </div>

      {/* Mobile Sponsors Carousel */}
      {(sponsorsLeft.length > 0 || sponsorsRight.length > 0 || sponsorsBottom.length > 0) && (
        <div className="xl:hidden max-w-[1600px] mx-auto px-4 py-8">
          <div className="border-t border-white/10 pt-8">
            <div className="text-[10px] text-muted-foreground uppercase text-center mb-6">Patrocinadores</div>
            <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
              {[...sponsorsLeft, ...sponsorsRight, ...sponsorsBottom].map(s => {
                const url = s.websiteUrl ? (s.websiteUrl.startsWith('http') ? s.websiteUrl : `https://${s.websiteUrl}`) : '#';
                return (
                  <a 
                    key={s.id} 
                    href={url} 
                    target={s.websiteUrl ? '_blank' : undefined} 
                    rel={s.websiteUrl ? 'noopener noreferrer' : undefined} 
                    className="bg-card rounded-xl p-4 border border-white/5 flex flex-col items-center min-w-[120px] hover:border-primary/30 hover:bg-card/80 transition-colors cursor-pointer snap-center shrink-0"
                  >
                    {s.logoUrl
                      ? <img src={s.logoUrl} alt={s.name} className="h-12 w-auto object-contain" />
                      : <div className="font-bold text-center text-xs">{s.name}</div>}
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sponsors Bar - Desktop only */}
      {sponsorsBottom.length > 0 && (
        <div className="hidden xl:block max-w-[1600px] mx-auto px-4 py-16">
          <div className="border-t border-white/10 pt-8">
            <div className="text-[10px] text-muted-foreground uppercase text-center mb-4">Patrocinadores</div>
            <div className="flex flex-wrap justify-center gap-6">
              {sponsorsBottom.map(s => {
                const url = s.websiteUrl ? (s.websiteUrl.startsWith('http') ? s.websiteUrl : `https://${s.websiteUrl}`) : '#';
                return (
                  <a key={s.id} href={url} target={s.websiteUrl ? '_blank' : undefined} rel={s.websiteUrl ? 'noopener noreferrer' : undefined} className="bg-card rounded-xl p-4 border border-white/5 flex flex-col items-center min-w-[100px] hover:border-primary/30 hover:bg-card/80 transition-colors cursor-pointer">
                    {s.logoUrl
                      ? <img src={s.logoUrl} alt={s.name} className="h-12 w-auto object-contain" />
                      : <div className="font-bold text-center text-sm">{s.name}</div>}
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Photo Lightbox */}
      {selectedPhoto && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-4" onClick={() => setSelectedPhoto(null)}>
            <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
              <button 
                onClick={() => setSelectedPhoto(null)}
                className="absolute -top-10 right-0 text-white hover:text-primary transition-colors z-50"
              >
                <X size={32} />
              </button>
              <img src={selectedPhoto} alt="Foto ampliada" className="w-full h-auto rounded-xl animate-in fade-in zoom-in duration-300" />
            </div>
          </div>

          {/* Fullscreen Fireworks */}
          <style>{`
            @keyframes burst {
              0% {
                transform: translate(0, 0) scale(1);
                opacity: 1;
              }
              30% {
                opacity: 1;
              }
              100% {
                transform: translate(var(--tx), var(--ty)) scale(0.3);
                opacity: 0;
              }
            }
            .particle {
              position: fixed;
              pointer-events: none;
              border-radius: 50%;
              animation: burst 3.5s ease-out forwards;
              will-change: transform, opacity;
            }
          `}</style>
          
          <div className="fixed inset-0 z-[100] pointer-events-none">
            {Array.from({ length: 200 }).map((_, i) => {
              const explosionWave = Math.floor(i / 50);
              const indexInWave = i % 50;
              const angle = (indexInWave / 50) * Math.PI * 2;
              const speed = 200 + Math.random() * 300;
              const tx = Math.cos(angle) * speed;
              const ty = Math.sin(angle) * speed * (0.8 + Math.random() * 0.4);
              const size = 2 + Math.random() * 6;
              const colors = ['#FFD700', '#FFA500', '#FF8C00', '#FF6347', '#FFB347', '#FFAC58', '#FF7F50'];
              const color = colors[Math.floor(Math.random() * colors.length)];
              const delay = explosionWave * 0.8;
              
              return (
                <div
                  key={i}
                  className="particle"
                  style={{
                    '--tx': `${tx}px`,
                    '--ty': `${ty}px`,
                    left: '50%',
                    top: '50%',
                    width: `${size}px`,
                    height: `${size}px`,
                    backgroundColor: color,
                    boxShadow: `0 0 ${size + 4}px ${color}, 0 0 ${size + 8}px ${color}`,
                    animationDelay: `${delay}s`,
                    filter: 'drop-shadow(0 0 2px ' + color + ')',
                  } as React.CSSProperties}
                />
              );
            })}
          </div>
        </>
      )}
    </PageLayout>
  );
}
