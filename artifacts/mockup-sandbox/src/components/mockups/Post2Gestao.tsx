import logoArenix from '../../assets/logo-arenix.png';
import sysPainel from '../../assets/sys-painel.png';
import sysClientes from '../../assets/sys-clientes.png';
import sysEmail from '../../assets/sys-email.png';
import sysConfig from '../../assets/sys-config.png';

export default function Post2Gestao() {
  return (
    <div
      style={{
        width: '1080px',
        height: '1080px',
        background: 'linear-gradient(135deg, #080808 0%, #0f0f0f 50%, #080808 100%)',
        fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Glow decorativo */}
      <div style={{
        position: 'absolute', top: -60, left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 250,
        background: 'radial-gradient(ellipse, rgba(212,175,55,0.1) 0%, transparent 70%)',
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
          #02 GESTÃO COMPLETA
        </div>
      </div>

      {/* Headline */}
      <div style={{ padding: '8px 50px 20px', zIndex: 10 }}>
        <div style={{ color: '#fff', fontSize: 46, fontWeight: 900, lineHeight: 1.1, letterSpacing: -1 }}>
          Painel de controle
          <br />
          <span style={{ color: '#d4af37' }}>do seu negócio.</span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, marginTop: 10 }}>
          Reservas, clientes, financeiro e marketing — tudo em um só lugar.
        </div>
      </div>

      {/* Screenshots em grid 2x2 */}
      <div style={{
        margin: '0 50px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
        gap: 8, flex: 1, borderRadius: 16, overflow: 'hidden',
        border: '1px solid rgba(212,175,55,0.2)', boxShadow: '0 20px 60px rgba(0,0,0,0.9)', zIndex: 10,
      }}>
        {[
          { src: sysPainel, label: 'Reservas' },
          { src: sysClientes, label: 'Clientes' },
          { src: sysEmail, label: 'Email Marketing' },
          { src: sysConfig, label: 'Configurações' },
        ].map(({ src, label }) => (
          <div key={label} style={{ position: 'relative', overflow: 'hidden' }}>
            <img src={src} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)',
            }} />
            <div style={{
              position: 'absolute', bottom: 10, left: 12,
              color: '#d4af37', fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
            }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', padding: '20px 50px 16px', zIndex: 10 }}>
        {[
          { num: '∞', label: 'Reservas' },
          { num: '360°', label: 'Visibilidade' },
          { num: '1', label: 'Painel único' },
        ].map(({ num, label }, i) => (
          <div key={label} style={{
            flex: 1, borderRight: i < 2 ? '1px solid rgba(255,255,255,0.08)' : 'none', textAlign: 'center',
          }}>
            <div style={{ color: '#d4af37', fontSize: 28, fontWeight: 900 }}>{num}</div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 50px 36px', zIndex: 10 }}>
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>arenix.com.br · @arenix.arena</div>
        <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>#Arenix #PainelDeGestão #Arena</div>
      </div>
    </div>
  );
}
