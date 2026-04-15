import { ShieldX } from "lucide-react";

interface BlockedPageProps {
  superLogoUrl?: string;
}

export default function BlockedPage({ superLogoUrl }: BlockedPageProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0a] px-6 text-center">
      {superLogoUrl ? (
        <img
          src={superLogoUrl}
          alt="Logo"
          className="h-16 w-auto object-contain mb-10 opacity-90"
        />
      ) : (
        <div className="mb-10 text-white/30 text-2xl font-bold tracking-widest uppercase">PlayHub</div>
      )}

      <div className="flex items-center justify-center w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 mb-6">
        <ShieldX className="w-9 h-9 text-red-400" />
      </div>

      <h1 className="text-3xl font-bold text-white mb-3">Acesso Bloqueado</h1>
      <p className="text-white/50 text-base max-w-sm leading-relaxed">
        Esta arena está temporariamente suspensa. Entre em contato com o suporte para regularizar o acesso.
      </p>
    </div>
  );
}
