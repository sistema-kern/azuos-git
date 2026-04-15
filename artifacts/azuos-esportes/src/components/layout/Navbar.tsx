import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";

export function Navbar() {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { profile } = useCompanyProfile();

  const allNavItems = [
    { href: "/", label: "Home" },
    { href: "/agendamento", label: "Agendamento" },
    { href: "/beach-tennis", label: "Beach Tennis" },
    { href: "/copa", label: profile.copa_page_name || "Copa" },
    { href: "/galeria", label: "Galeria" },
    { href: "/contato", label: "Contato" },
  ];

  let hiddenRoutes: string[] = [];
  try { hiddenRoutes = JSON.parse(profile.nav_hidden || "[]"); } catch { hiddenRoutes = []; }

  const navItems = allNavItems.filter((item) => !hiddenRoutes.includes(item.href));

  return (
    <nav className="fixed top-0 w-full z-40 glass-panel border-b-0 border-x-0 border-t-0 rounded-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <Link href="/" className="flex items-center gap-3 group">
            {profile.logo_url && (
              <img 
                src={profile.logo_url}
                alt={`${profile.company_name} Logo`}
                className="h-12 w-auto group-hover:scale-105 transition-transform duration-300"
              />
            )}
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 uppercase tracking-wide",
                  location === item.href 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center">
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-foreground p-2"
            >
              {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-black border-t border-white/5 absolute w-full animate-in slide-in-from-top-2">
          <div className="px-4 pt-2 pb-6 space-y-2 flex flex-col items-center">
            {navItems.map((item) => (
              <Link 
                key={item.href} 
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  "w-full text-center px-4 py-3 rounded-xl text-base font-bold uppercase tracking-wide",
                  location === item.href 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
