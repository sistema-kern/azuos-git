import { Link } from "wouter";
import { useState } from "react";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";
import { showToast } from "@/lib/toast";

function formatCNPJ(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

function NewsletterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/newsletter/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao inscrever");
      showToast.success("Inscrito com sucesso!");
      setEmail("");
      setName("");
    } catch (err: unknown) {
      showToast.error(err instanceof Error ? err.message : "Erro ao inscrever");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <h4 className="font-display text-xl text-foreground mb-1">Newsletter</h4>
      <input
        type="text"
        placeholder="Seu nome"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <input
        type="email"
        placeholder="seu@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-primary text-primary-foreground px-3 py-2.5 text-sm font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {submitting ? "..." : "Inscrever"}
      </button>
    </form>
  );
}

export function Footer() {
  const { profile } = useCompanyProfile();
  let hiddenRoutes: string[] = [];
  try { hiddenRoutes = JSON.parse(profile.nav_hidden || "[]"); } catch { hiddenRoutes = []; }
  const isVisible = (href: string) => !hiddenRoutes.includes(href);

  return (
    <footer className="border-t border-white/10 bg-background/80 py-12 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1.3fr_1.3fr] gap-8 items-start">
          <div className="flex flex-col gap-3">
            {profile.logo_url && (
              <img
                src={profile.logo_url}
                alt={`${profile.company_name} Logo`}
                className="h-12 w-[65%] object-contain opacity-100 grayscale-0"
              />
            )}
            {profile.company_description && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {profile.company_description}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <h4 className="font-display text-lg font-bold text-foreground uppercase tracking-wider">Links Rápidos</h4>
            {isVisible("/agendamento") && <Link href="/agendamento" className="text-muted-foreground hover:text-primary transition-colors text-sm">Agendar Quadra</Link>}
            {isVisible("/beach-tennis") && <Link href="/beach-tennis" className="text-muted-foreground hover:text-primary transition-colors text-sm">Aulas Beach Tennis</Link>}
            {isVisible("/copa") && <Link href="/copa" className="text-muted-foreground hover:text-primary transition-colors text-sm">{profile.copa_page_name || "Copa"}</Link>}
            {isVisible("/galeria") && <Link href="/galeria" className="text-muted-foreground hover:text-primary transition-colors text-sm">Galeria</Link>}
            {isVisible("/contato") && <Link href="/contato" className="text-muted-foreground hover:text-primary transition-colors text-sm">Contato</Link>}
          </div>
          <div className="flex flex-col gap-3">
            <h4 className="font-display text-lg font-bold text-foreground uppercase tracking-wider">Contato</h4>
            {profile.company_address && (
              <p className="text-muted-foreground text-sm leading-relaxed">📍 {profile.company_address}</p>
            )}
            {profile.company_phone && (
              <p className="text-muted-foreground text-sm">📱 {formatPhone(profile.company_phone)}</p>
            )}
          </div>
          <NewsletterForm />
        </div>
        <div className="mt-12 pt-8 border-t border-white/5 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} {profile.company_name}.{" "}
          Todos os direitos reservados.{profile.company_cnpj ? ` | CNPJ: ${formatCNPJ(profile.company_cnpj)}` : ""}
        </div>
      </div>
    </footer>
  );
}
