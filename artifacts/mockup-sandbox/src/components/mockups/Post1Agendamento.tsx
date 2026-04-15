import logoArenix from '../../assets/logo-arenix.png';
import sysAgendamento from '../../assets/sys-agendamento.png';

export default function Post1Agendamento() {
  return (
    <div
      style={{
        width: '1080px',
        height: '1080px',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #111111 50%, #0a0a0a 100%)',
        fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Glow top-right */}
      <div style={{
        position: 'absolute', top: -100, right: -100,
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,175,55,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -80, left: -80,
        width: 350, height: 350, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(212,175,55,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '40px 50px 30px', zIndex: 10,
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
          borderRadius: 50, padding: '8px 20px',
          color: '#d4af37', fontSize: 13, fontWeight: 600, letterSpacing: 1,
        }}>
          #01 AGENDAMENTO
        </div>
      </div>

      {/* Headline */}
      <div style={{ padding: '10px 50px 24px', zIndex: 10 }}>
        <div style={{ color: '#fff', fontSize: 48, fontWeight: 900, lineHeight: 1.1, letterSpacing: -1 }}>
          Agende quadras
          <br />
          <span style={{ color: '#d4af37' }}>em segundos.</span>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 17, marginTop: 10 }}>
          Seus clientes escolhem data, quadra e horário — sozinhos.
        </div>
      </div>

      {/* Screenshot principal */}
      <div style={{
        margin: '0 50px', borderRadius: 16, overflow: 'hidden',
        border: '1px solid rgba(212,175,55,0.25)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
        flex: 1, position: 'relative', zIndex: 10,
      }}>
        <img
          src={sysAgendamento}
          alt="Sistema de Agendamento"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
        />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '35%',
          background: 'linear-gradient(to top, rgba(10,10,10,1) 0%, transparent 100%)',
        }} />
      </div>

      {/* Feature chips */}
      <div style={{ display: 'flex', gap: 10, padding: '22px 50px 16px', flexWrap: 'wrap', zIndex: 10 }}>
        {['📅 Calendário em tempo real', '🏐 4 quadras simultâneas', '💸 Cupons de desconto', '📲 100% online'].map((f) => (
          <div key={f} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 50, padding: '7px 16px', color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 500,
          }}>{f}</div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 50px 36px', zIndex: 10 }}>
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>arenix.com.br · @arenix.arena</div>
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>#Arenix #GestãoDeArena #Agendamento</div>
      </div>
    </div>
  );
}
