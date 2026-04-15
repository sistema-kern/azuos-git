import { PageLayout } from "@/components/layout/PageLayout";
import { Button, Card, Badge } from "@/components/ui";
import { useGetTournaments, useGetAllChampions } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Trophy, Calendar as CalendarIcon, MapPin, Medal, X, BarChart2, ChevronDown } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useCompanyProfile } from "@/hooks/useCompanyProfile";

type RankingRow = {
  rank: number;
  pairName: string;
  total: number;
  byTournament: Record<number, number>;
};

type RankingCategory = {
  categoryName: string;
  tournaments: Array<{ id: number; name: string; startDate: string }>;
  rows: RankingRow[];
};

function useRanking() {
  const [data, setData] = useState<RankingCategory[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/tournaments/ranking`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}

const MEDAL_COLORS = ["text-yellow-400", "text-gray-400", "text-amber-700"];
const MEDAL_BG = ["bg-yellow-400/10 border-yellow-400/30", "bg-gray-400/10 border-gray-400/30", "bg-amber-700/10 border-amber-700/30"];

export default function CopaAzuos() {
  const { data: tournaments, isLoading } = useGetTournaments({ query: { refetchInterval: 15000 } });
  const { data: champions } = useGetAllChampions();
  const { data: ranking, loading: rankingLoading } = useRanking();
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [rankingCategory, setRankingCategory] = useState<string>("");
  const { profile } = useCompanyProfile();

  const allCategories = ranking?.map((r) => r.categoryName) ?? [];
  const activeCategory = rankingCategory || allCategories[0] || "";
  const activeCategoryData = ranking?.find((r) => r.categoryName === activeCategory);

  return (
    <PageLayout>
      <div className="bg-background">
        
        {/* Header */}
        <div className="relative py-20 border-b border-white/10 overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary via-background to-background"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
            <Trophy className="mx-auto w-20 h-20 text-primary mb-6 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
            <h1 className="text-6xl md:text-8xl font-display font-bold gold-gradient-text tracking-wider mb-4">
              {(profile.copa_page_title || profile.copa_page_name || "Copa").toUpperCase()}
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {profile.copa_page_description || "O circuito definitivo de futvolei. Forme sua dupla, entre na arena e faça história."}
            </p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          
          <h2 className="text-4xl font-display font-bold mb-8 border-l-4 border-primary pl-4">Torneios</h2>
          
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1,2,3].map(i => <div key={i} className="h-64 bg-card rounded-2xl animate-pulse"></div>)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {tournaments?.map((t) => (
                <Card key={t.id} className="group relative overflow-hidden border-white/10 hover:border-primary/50 transition-colors flex flex-col">
                  {t.photoUrl ? (
                    <div className="h-48 w-full overflow-hidden">
                      <img src={t.photoUrl} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  ) : t.bannerUrl ? (
                    <div className="h-48 w-full overflow-hidden">
                      <img src={t.bannerUrl} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  ) : (
                    <div className="h-32 w-full bg-secondary flex items-center justify-center border-b border-white/5">
                      <Trophy className="text-white/20 w-12 h-12" />
                    </div>
                  )}
                  
                  <div className="p-6 flex-grow flex flex-col">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-2xl font-display font-bold leading-tight">{t.name}</h3>
                      <Badge variant={t.status === 'finished' ? 'outline' : (t.status === 'ongoing' || t.status === 'open_registration') ? 'gold' : 'default'}>
                        {t.status === 'upcoming' ? 'Em breve' : t.status === 'open_registration' ? '🏆 Inscrições Abertas' : t.status === 'ongoing' ? 'Em andamento' : 'Finalizado'}
                      </Badge>
                    </div>
                    
                    <div className="space-y-2 text-sm text-muted-foreground mb-6">
                      <div className="flex items-center gap-2">
                        <CalendarIcon size={16} className="text-primary" />
                        {formatDate(t.startDate)} {t.endDate && `- ${formatDate(t.endDate)}`}
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={16} className="text-primary" />
                        {t.location || `${profile?.company_name} Arena`}
                      </div>
                    </div>
                    
                    <div className="mt-auto pt-4 border-t border-white/10">
                      <Link href={`/copa/${t.id}`}>
                        <Button variant="outline" className="w-full border-white/20 hover:bg-primary hover:text-black hover:border-primary">
                          Ver Detalhes
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              ))}
              {tournaments?.length === 0 && <p className="text-muted-foreground">Nenhum torneio encontrado.</p>}
            </div>
          )}

          {/* Hall of Fame */}
          <div className="mt-24">
            <h2 className="text-4xl font-display font-bold mb-8 border-l-4 border-primary pl-4">Galeria de Campeões</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {champions?.filter(c => c.champion).map((champ, idx) => (
                <Card key={idx} className="p-6 text-center border-primary/20 bg-gradient-to-b from-card to-background relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent"></div>
                  <Medal className="w-12 h-12 text-primary mx-auto mb-4" />
                  <div className="text-xs text-primary font-bold tracking-widest uppercase mb-1">{champ.tournamentName}</div>
                  <div className="text-[10px] text-muted-foreground mb-2">{formatDate(champ.startDate)}</div>
                  <div className="text-sm text-muted-foreground mb-4">{champ.categoryName}</div>
                  
                  {champ.champion?.photoUrl ? (
                    <div className="w-24 h-24 mx-auto rounded-full overflow-hidden border-2 border-primary mb-4 p-1 cursor-pointer hover:border-primary/70 transition-colors" onClick={() => setSelectedPhoto(champ.champion.photoUrl)}>
                      <img src={champ.champion.photoUrl} className="w-full h-full object-cover rounded-full" alt="Campeão" />
                    </div>
                  ) : (
                    <div className="w-24 h-24 mx-auto rounded-full bg-secondary flex items-center justify-center border-2 border-primary mb-4">
                      <Trophy className="text-primary/50" />
                    </div>
                  )}
                  
                  <h4 className="font-bold text-lg leading-tight">{champ.champion?.player1Name}</h4>
                  {champ.champion?.player1School && <p className="text-xs text-muted-foreground leading-tight">{champ.champion.player1School}</p>}
                  <div className="text-primary/50 text-sm">&</div>
                  <h4 className="font-bold text-lg leading-tight">{champ.champion?.player2Name}</h4>
                  {champ.champion?.player2School && <p className="text-xs text-muted-foreground leading-tight">{champ.champion.player2School}</p>}
                </Card>
              ))}
              {(!champions || champions.filter(c => c.champion).length === 0) && (
                <p className="text-muted-foreground col-span-full">Os campeões aparecerão aqui assim que os torneios finalizarem.</p>
              )}
            </div>
          </div>

          {/* ── RANKING ──────────────────────────────────────────────── */}
          <div className="mt-24">
            <div className="flex items-center gap-4 mb-8">
              <BarChart2 className="text-primary w-8 h-8 flex-shrink-0" />
              <h2 className="text-4xl font-display font-bold border-l-4 border-primary pl-4">Ranking Geral</h2>
            </div>

            {rankingLoading ? (
              <div className="space-y-3">
                {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-card rounded-xl animate-pulse" />)}
              </div>
            ) : !ranking || ranking.length === 0 ? (
              <Card className="p-10 text-center border-white/10">
                <BarChart2 className="w-12 h-12 text-white/20 mx-auto mb-3" />
                <p className="text-muted-foreground">O ranking será publicado após os torneios.</p>
              </Card>
            ) : (
              <div>
                {/* Category tabs */}
                {allCategories.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-8">
                    {allCategories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setRankingCategory(cat)}
                        className={`px-5 py-2 rounded-full text-sm font-semibold border transition-all ${
                          activeCategory === cat
                            ? "bg-primary text-black border-primary"
                            : "border-white/20 text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {activeCategoryData && (
                  <div>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto rounded-2xl border border-white/10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10 bg-card/60">
                            <th className="text-left py-3 px-4 font-semibold text-muted-foreground w-12">#</th>
                            <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Dupla</th>
                            {activeCategoryData.tournaments.map((t) => (
                              <th key={t.id} className="text-center py-3 px-3 font-semibold text-muted-foreground whitespace-nowrap min-w-[100px]">
                                <div className="text-xs">{t.name}</div>
                              </th>
                            ))}
                            <th className="text-center py-3 px-4 font-bold text-primary whitespace-nowrap">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeCategoryData.rows.map((row) => {
                            const isTop3 = row.rank <= 3;
                            return (
                              <tr
                                key={row.pairName}
                                className={`border-b border-white/5 transition-colors hover:bg-white/5 ${isTop3 ? "bg-card/30" : ""}`}
                              >
                                <td className="py-3 px-4">
                                  {row.rank <= 3 ? (
                                    <span className={`font-black text-lg ${MEDAL_COLORS[row.rank - 1]}`}>
                                      {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : "🥉"}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground font-mono">{row.rank}</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <span className={`font-semibold ${isTop3 ? "text-white" : "text-foreground"}`}>
                                    {row.pairName.split(" E ").join(" & ")}
                                  </span>
                                </td>
                                {activeCategoryData.tournaments.map((t) => (
                                  <td key={t.id} className="py-3 px-3 text-center">
                                    {row.byTournament[t.id] !== undefined ? (
                                      <span className="inline-flex items-center justify-center w-10 h-7 rounded-lg bg-white/5 text-primary font-mono font-bold text-xs">
                                        {row.byTournament[t.id]}
                                      </span>
                                    ) : (
                                      <span className="text-white/20">—</span>
                                    )}
                                  </td>
                                ))}
                                <td className="py-3 px-4 text-center">
                                  <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full font-bold text-sm ${
                                    row.rank === 1
                                      ? "bg-yellow-400/20 text-yellow-400 border border-yellow-400/40"
                                      : row.rank === 2
                                      ? "bg-gray-400/20 text-gray-300 border border-gray-400/40"
                                      : row.rank === 3
                                      ? "bg-amber-700/20 text-amber-600 border border-amber-700/40"
                                      : "bg-white/5 text-foreground"
                                  }`}>
                                    {row.total} pts
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-3">
                      {activeCategoryData.rows.map((row) => {
                        const isTop3 = row.rank <= 3;
                        return (
                          <Card 
                            key={row.pairName}
                            className={`p-4 border-white/10 ${isTop3 ? "bg-card/50 border-primary/30" : "bg-card/20"}`}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-2">
                                {row.rank <= 3 ? (
                                  <span className={`font-black text-2xl ${MEDAL_COLORS[row.rank - 1]}`}>
                                    {row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : "🥉"}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground font-bold text-lg w-8 text-center">#{row.rank}</span>
                                )}
                                <div>
                                  <p className={`font-bold text-sm leading-tight ${isTop3 ? "text-white" : "text-foreground"}`}>
                                    {row.pairName.split(" E ").join(" & ")}
                                  </p>
                                </div>
                              </div>
                              <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full font-bold text-xs ${
                                row.rank === 1
                                  ? "bg-yellow-400/20 text-yellow-400"
                                  : row.rank === 2
                                  ? "bg-gray-400/20 text-gray-300"
                                  : row.rank === 3
                                  ? "bg-amber-700/20 text-amber-600"
                                  : "bg-white/5 text-foreground"
                              }`}>
                                {row.total} pts
                              </span>
                            </div>

                            {activeCategoryData.tournaments.length > 0 && (
                              <div className="space-y-2 border-t border-white/10 pt-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Torneios</p>
                                <div className="flex flex-wrap gap-2">
                                  {activeCategoryData.tournaments.map((t) => (
                                    <div key={t.id} className="flex-1 min-w-[120px] text-center">
                                      <p className="text-xs text-muted-foreground truncate">{t.name}</p>
                                      {row.byTournament[t.id] !== undefined ? (
                                        <p className="text-sm font-bold text-primary">{row.byTournament[t.id]} pts</p>
                                      ) : (
                                        <p className="text-sm text-white/30">—</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>

                    {/* Points legend */}
                    <div className="mt-6 p-4 rounded-xl border border-white/10 bg-card/30">
                      <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-widest">Pontuação por Fase</p>
                      <div className="flex flex-wrap gap-3">
                        {[
                          { label: "Fase de Grupos", pts: 10 },
                          { label: "Oitavas", pts: 25 },
                          { label: "Quartas", pts: 35 },
                          { label: "Semifinal", pts: 50 },
                          { label: "3º Lugar", pts: 70 },
                          { label: "Vice-campeão", pts: 80 },
                          { label: "Campeão", pts: 100 },
                        ].map(({ label, pts }) => (
                          <div key={label} className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground">{label}:</span>
                            <span className="text-primary font-bold">{pts} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

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
