import { useState, useEffect } from "react";
import { getMatchResultResolver, setMatchResultResolver } from "@/lib/toast";

export interface MatchResultData {
  pair1Sets: number;
  pair2Sets: number;
}

export function MatchResultModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [pair1Name, setPair1Name] = useState("");
  const [pair2Name, setPair2Name] = useState("");
  const [pair1Sets, setPair1Sets] = useState<string>("0");
  const [pair2Sets, setPair2Sets] = useState<string>("0");

  useEffect(() => {
    const handleShowResult = (e: Event) => {
      const event = e as CustomEvent;
      setPair1Name(event.detail.pair1Name);
      setPair2Name(event.detail.pair2Name);
      setPair1Sets(String(event.detail.pair1Sets ?? 0));
      setPair2Sets(String(event.detail.pair2Sets ?? 0));
      setIsOpen(true);
    };

    window.addEventListener("showMatchResultModal", handleShowResult);
    return () => window.removeEventListener("showMatchResultModal", handleShowResult);
  }, []);

  const handleSubmit = (confirmed: boolean) => {
    const resolver = getMatchResultResolver();
    if (resolver) {
      if (confirmed) {
        resolver({
          pair1Sets: parseInt(pair1Sets, 10) || 0,
          pair2Sets: parseInt(pair2Sets, 10) || 0,
        });
      } else {
        resolver(null);
      }
    }
    setMatchResultResolver(null);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl p-8 max-w-md w-[90%] border border-white/10 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-white text-center text-xl font-bold mb-8">
          Lançar Resultado
        </h2>

        <div className="space-y-6 mb-8">
          {/* Dupla 1 */}
          <div className="bg-black/40 rounded-lg p-4 border border-white/5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 block">
              {pair1Name}
            </label>
            <input
              type="number"
              min="0"
              max="3"
              value={pair1Sets}
              onChange={(e) => setPair1Sets(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-lg px-4 py-3 text-white text-center text-2xl font-bold focus:border-primary focus:outline-none transition-colors"
            />
            <p className="text-xs text-muted-foreground mt-2 text-center">PTS</p>
          </div>

          {/* VS */}
          <div className="flex items-center justify-center">
            <div className="text-white/50 font-bold text-lg">vs</div>
          </div>

          {/* Dupla 2 */}
          <div className="bg-black/40 rounded-lg p-4 border border-white/5">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 block">
              {pair2Name}
            </label>
            <input
              type="number"
              min="0"
              max="3"
              value={pair2Sets}
              onChange={(e) => setPair2Sets(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-lg px-4 py-3 text-white text-center text-2xl font-bold focus:border-primary focus:outline-none transition-colors"
            />
            <p className="text-xs text-muted-foreground mt-2 text-center">PTS</p>
          </div>
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => handleSubmit(false)}
            className="px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wider bg-gray-700 text-white hover:bg-gray-600 transition-colors duration-200"
          >
            Cancelar
          </button>
          <button
            onClick={() => handleSubmit(true)}
            className="px-6 py-3 rounded-lg font-bold text-sm uppercase tracking-wider bg-blue-500 text-white hover:bg-blue-600 transition-colors duration-200"
          >
            Lançar
          </button>
        </div>
      </div>
    </div>
  );
}
