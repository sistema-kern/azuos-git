import { PageLayout } from "@/components/layout/PageLayout";
import { useState } from "react";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { showToast } from "@/lib/toast";
import { MapPin, Phone, Instagram, Send, User, Mail, MessageSquare, Loader2, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

interface InfoCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  href?: string;
}

function InfoCard({ icon, title, value, href }: InfoCardProps) {
  const content = (
    <div className="group relative flex flex-col gap-4 p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 overflow-hidden">
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: "radial-gradient(circle at 50% 0%, rgba(var(--primary-raw, 201,162,39),0.08) 0%, transparent 70%)" }}
      />
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 text-primary flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{title}</p>
        <p className="text-sm font-medium text-foreground leading-relaxed">{value}</p>
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }
  return content;
}

export default function Contato() {
  const { profile } = useCompanyProfile();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const instagramHandle = profile.instagram_handle?.replace(/^@/, "") ?? "";
  const whatsappNumber = profile.company_phone?.replace(/\D/g, "") ?? "";
  const whatsappHref = whatsappNumber ? `https://wa.me/${whatsappNumber}` : undefined;
  const instagramHref = instagramHandle ? `https://instagram.com/${instagramHandle}` : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      showToast.error("Preencha nome, email e mensagem");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone: phone || undefined, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao enviar");
      setSent(true);
      setName(""); setEmail(""); setPhone(""); setMessage("");
    } catch (err: unknown) {
      showToast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const infoCards = [
    profile.company_address && {
      icon: <MapPin size={22} />,
      title: "Endereço",
      value: profile.company_address,
      href: profile.company_address
        ? `https://maps.google.com/?q=${encodeURIComponent(profile.company_address)}`
        : undefined,
    },
    profile.company_phone && {
      icon: <Phone size={22} />,
      title: "Telefone / WhatsApp",
      value: formatPhone(profile.company_phone),
      href: whatsappHref,
    },
    instagramHandle && {
      icon: <Instagram size={22} />,
      title: "Instagram",
      value: `@${instagramHandle}`,
      href: instagramHref,
    },
  ].filter(Boolean) as InfoCardProps[];

  return (
    <PageLayout>
      <div className="min-h-screen">
        {/* Hero */}
        <section className="relative pt-36 pb-16 px-4 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] opacity-20"
              style={{ background: "radial-gradient(ellipse, hsl(var(--primary)) 0%, transparent 70%)" }}
            />
          </div>
          <div className="relative max-w-4xl mx-auto text-center">
            <p className="text-primary text-xs font-bold uppercase tracking-[0.3em] mb-4">
              Entre em Contato
            </p>
            <h1 className="font-display text-4xl md:text-6xl font-black uppercase tracking-tight text-foreground mb-4">
              {profile.company_name || "Fale Conosco"}
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Estamos aqui para responder suas dúvidas e agendar sua visita.
            </p>
          </div>
        </section>

        {/* Info Cards */}
        {infoCards.length > 0 && (
          <section className="px-4 pb-12">
            <div className={cn(
              "max-w-5xl mx-auto grid gap-4",
              infoCards.length === 1 ? "grid-cols-1 max-w-xs" :
              infoCards.length === 2 ? "grid-cols-1 sm:grid-cols-2 max-w-2xl" :
              "grid-cols-1 sm:grid-cols-3"
            )}>
              {infoCards.map((card, i) => (
                <InfoCard key={i} {...card} />
              ))}
            </div>
          </section>
        )}

        {/* Map + Form */}
        <section className="px-4 pb-20">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

            {/* Map with logo overlay */}
            {profile.contact_map_embed ? (
              <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl group">
                <iframe
                  src={profile.contact_map_embed}
                  width="100%"
                  height="480"
                  style={{ border: 0, display: "block", filter: "grayscale(30%) contrast(1.05)" }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Localização"
                />
                {/* Logo overlay */}
                {profile.logo_url && (
                  <div className="absolute top-4 left-4 z-10">
                    <div className="bg-black/80 backdrop-blur-md rounded-xl border border-white/20 px-3 py-2 shadow-xl">
                      <img
                        src={profile.logo_url}
                        alt={profile.company_name}
                        className="h-10 w-auto object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  </div>
                )}
                {/* Address badge */}
                {profile.company_address && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-4 py-4">
                    <div className="flex items-start gap-2">
                      <MapPin size={14} className="text-primary mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-white/80 leading-relaxed">{profile.company_address}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden lg:flex items-center justify-center h-80 rounded-2xl border border-dashed border-white/10 bg-white/5">
                <div className="text-center">
                  <MapPin size={40} className="text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Mapa não configurado</p>
                </div>
              </div>
            )}

            {/* Contact Form */}
            <div className="relative">
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <Send size={18} />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-black uppercase tracking-wider text-foreground">Enviar Mensagem</h2>
                    <p className="text-xs text-muted-foreground">Responderemos em breve</p>
                  </div>
                </div>

                {sent ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                      <CheckCircle size={32} className="text-green-400" />
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-lg mb-1">Mensagem Enviada!</p>
                      <p className="text-sm text-muted-foreground">Obrigado pelo contato. Retornaremos em breve.</p>
                    </div>
                    <button
                      onClick={() => setSent(false)}
                      className="mt-2 text-sm text-primary hover:text-primary/80 font-semibold transition-colors"
                    >
                      Enviar outra mensagem
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* Name */}
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <User size={15} />
                      </div>
                      <input
                        type="text"
                        placeholder="Seu nome *"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-black/30 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                      />
                    </div>
                    {/* Email */}
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <Mail size={15} />
                      </div>
                      <input
                        type="email"
                        placeholder="Seu email *"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-black/30 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                      />
                    </div>
                    {/* Phone */}
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        <Phone size={15} />
                      </div>
                      <input
                        type="tel"
                        placeholder="Telefone / WhatsApp (opcional)"
                        value={phone}
                        onChange={(e) => setPhone(maskPhone(e.target.value))}
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-black/30 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                      />
                    </div>
                    {/* Message */}
                    <div className="relative">
                      <div className="absolute left-3 top-3.5 text-muted-foreground">
                        <MessageSquare size={15} />
                      </div>
                      <textarea
                        placeholder="Sua mensagem *"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        required
                        rows={5}
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-black/30 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all resize-none"
                      />
                    </div>
                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={sending}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold uppercase tracking-widest hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {sending ? (
                        <><Loader2 size={16} className="animate-spin" /> Enviando...</>
                      ) : (
                        <><Send size={16} /> Enviar Mensagem</>
                      )}
                    </button>
                    <p className="text-center text-xs text-muted-foreground">
                      * Campos obrigatórios
                    </p>
                  </form>
                )}
              </div>

              {/* WhatsApp quick button */}
              {whatsappHref && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400 text-sm font-semibold hover:bg-green-500/20 hover:border-green-500/50 transition-all duration-200"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Falar pelo WhatsApp
                </a>
              )}
            </div>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
