import logoArenix from '../../assets/logo-arenix.png';
import sysTorneios from '../../assets/sys-torneios.png';
import sysCopa from '../../assets/sys-copa.png';

export default function Post3Torneios() {
  return (
    <div
      style={{
        width: '1080px',
        height: '1080px',
        background: 'linear-gradient(145deg, #080808 0%, #0d0d0d 60%, #080808 100%)',
        fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Glow dourado direito */}
      <div style={{
        position: 'absolute', top: 100, right: -120,
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,175,55,0.09) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '40px 50px 28px', zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={logoArenix} alt="Arenix" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 22, letterSpacing: 1 }}>ARENIX</div>
            <div style={{ color: '#d4af37', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' }}>Arena Management</div>
          </div>
        </div>
        <div style={{
          background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.5)',
          borderRadius: 50, padding: '8px 20px', color: '#d4af37', fontSize: 13, fontWeight: 600, letterSpacing: 1,
        }}>
          #03 TORNEIOS
        </div>
      </div>

      {/* Headline */}
      <div style={{ padding: '8px 50px 20px', zIndex: 10 }}>
        <div style={{ color: '#fff', fontSize: 46, fontWeight: 900, lineHeight: 1.1, letterSpacing: -1 }}>
          Organize torneios
          <br />
          <span style={{ color: '#d4af37' }}>como um pro.</span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, marginTop: 10 }}>
          Do cadastro à premiação, tudo automatizado pelo Arenix.
        </div>
      </div>

      {/* Screenshot principal torneios */}
      <div style={{
        margin: '0 50px 10px', borderRadius: 16, overflow: 'hidden',
        border: '1px solid rgba(212,175,55,0.25)', boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
        flex: 1, position: 'relative', zIndex: 10,
      }}>
        <img
          src={sysTorneios}
          alt="Gestão de Torneios"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
        />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%',
          background: 'linear-gradient(to top, rgba(8,8,8,1) 0%, transparent 100%)',
        }} />
      </div>

      {/* Screenshot menor – página pública */}
      <div style={{
        margin: '0 50px 18px', borderRadius: 12, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)', position: 'relative', zIndex: 10, height: 120,
      }}>
        <img
          src={sysCopa}
          alt="Copa"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
        />
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', padding: '0 24px',
        }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
            🏆 Página pública do torneio para os competidores
          </span>
        </div>
      </div>

      {/* Features */}
      <div style={{ display: 'flex', gap: 8, padding: '0 50px 16px', flexWrap: 'wrap', zIndex: 10 }}>
        {['🗂️ Categorias e chaves', '👥 Inscrições online', '📊 Classificação ao vivo', '🥇 Histórico de resultados'].map((f) => (
          <div key={f} style={{
            background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)',
            borderRadius: 50, padding: '7px 16px', color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 500,
          }}>{f}</div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 50px 36px', zIndex: 10 }}>
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>arenix.com.br · @arenix.arena</div>
        <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>#Arenix #Torneios #BeachTennis</div>
      </div>
    </div>
  );
}
