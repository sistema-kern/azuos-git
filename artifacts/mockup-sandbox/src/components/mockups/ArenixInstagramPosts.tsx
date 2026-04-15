import React from 'react';

export default function ArenixInstagramPosts() {
  const posts = [
    {
      id: 1,
      title: 'Agendamento Inteligente',
      description: 'Gerencie suas quadras com facilidade',
      image: '/image_1775415147933.png',
      features: ['📅 Calendar intuitivo', '🏐 Múltiplas quadras', '💳 Cupons automáticos', '👥 Dados dos clientes']
    },
    {
      id: 2,
      title: 'Gestão de Torneios',
      description: 'Organize eventos profissionais',
      image: '/image_1775415371768.png',
      features: ['🏆 Categorias', '👥 Inscrições', '📊 Pontuação', '🎯 Matches automáticos']
    },
    {
      id: 3,
      title: 'Painel Completo',
      description: 'Controle total do seu negócio',
      image: '/image_1775415279682.png',
      features: ['📊 Reservas em tempo real', '💰 Gestão financeira', '👨‍💼 CRM de clientes', '📧 Email Marketing']
    },
    {
      id: 4,
      title: 'Aulas e Cursos',
      description: 'Expanda seu negócio',
      image: '/image_1775415250754.png',
      features: ['🎓 Aulas agendadas', '💵 Tabela de preços', '📱 Planos mensais', '👥 Gestão de alunos']
    }
  ];

  return (
    <div className="min-h-screen bg-black p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-16 text-center">
          <h1 className="text-5xl font-bold text-white mb-4">Posts Instagram Arenix</h1>
          <p className="text-gray-400 text-lg">Com imagens reais do sistema e logo oficial</p>
        </div>

        {/* Posts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          {posts.map((post) => (
            <div key={post.id} className="group">
              {/* Instagram Post Container */}
              <div className="bg-white rounded-2xl overflow-hidden shadow-2xl hover:shadow-2xl transition-all duration-300 h-full flex flex-col">
                
                {/* Header com Logo */}
                <div className="bg-gradient-to-r from-gray-900 to-black px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
                      <span className="text-black font-bold text-sm">A</span>
                    </div>
                    <span className="text-white font-semibold text-sm">arenix.arena</span>
                  </div>
                  <button className="text-white text-xl">⋯</button>
                </div>

                {/* Imagem do Sistema */}
                <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
                  <img 
                    src={post.image}
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                  {/* Overlay com logo e título */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent flex flex-col justify-between p-6">
                    <div></div>
                    <div>
                      <h2 className="text-3xl font-bold text-white mb-2">{post.title}</h2>
                      <p className="text-gray-200 text-sm">{post.description}</p>
                    </div>
                  </div>
                </div>

                {/* Interação (Like, Comment, Share) */}
                <div className="bg-white px-4 py-3 border-b border-gray-200">
                  <div className="flex gap-3 mb-3">
                    <button className="text-2xl hover:opacity-70 transition">❤️</button>
                    <button className="text-2xl hover:opacity-70 transition">💬</button>
                    <button className="text-2xl hover:opacity-70 transition">📤</button>
                    <button className="text-2xl ml-auto hover:opacity-70 transition">🔖</button>
                  </div>
                  <p className="text-xs font-semibold text-gray-900 mb-2">18.5K curtidas</p>
                </div>

                {/* Caption e Features */}
                <div className="bg-white px-4 py-4 flex-1">
                  <p className="text-sm text-gray-900 mb-3">
                    <span className="font-bold">arenix.arena</span> {post.description.toLowerCase()}
                  </p>
                  
                  {/* Features */}
                  <div className="bg-gray-50 rounded-lg p-3 mb-3">
                    <p className="text-xs font-semibold text-gray-700 mb-2">✨ Funcionalidades:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {post.features.map((feature, idx) => (
                        <p key={idx} className="text-xs text-gray-600">{feature}</p>
                      ))}
                    </div>
                  </div>

                  {/* CTA */}
                  <p className="text-xs text-gray-500 mb-2">
                    Clique no link da bio para conhecer Arenix! 🚀
                  </p>
                  <p className="text-xs text-gray-400">
                    #Arenix #GestãoDeArenas #SistemaSmartdisponível #Inovação
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Captions para copiar */}
        <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800">
          <h3 className="text-2xl font-bold text-white mb-8">📝 Captions Sugeridas (Copie e Cole)</h3>
          
          <div className="space-y-6">
            {[
              {
                num: 1,
                title: "Post Agendamento",
                caption: "Quadras lotadas e cliente insatisfeito? 😫 Arenix é a solução! Sistema inteligente de agendamento que automatiza tudo:\n\n✅ Calendário em tempo real\n✅ Múltiplas quadras\n✅ Cupons e descontos automáticos\n✅ Dados dos clientes centralizados\n\nSeu negócio merece evoluir! 🚀\n\n#Arenix #GestãoDeArenas #SistemaInteligente #Inovação"
              },
              {
                num: 2,
                title: "Post Torneios",
                caption: "Organize torneios como um profissional! ⚡\n\nCom Arenix você consegue:\n\n🏆 Criar categorias de competição\n👥 Gerenciar inscrições automaticamente\n📊 Calcular pontuação em tempo real\n🎯 Gerar brackets automáticos\n\nSeu torneio no próximo nível! 🎊\n\n#Arenix #TorneiosProfissionais #GestãoDeEventos #Arena"
              },
              {
                num: 3,
                title: "Post Painel",
                caption: "Um painel para governar tudo! 👑\n\nReservas, Clientes, Torneios, Financeiro, Email Marketing e mais - tudo centralizado no Arenix:\n\n📊 Dashboard em tempo real\n💰 Controle financeiro completo\n👥 CRM de clientes integrado\n📧 Automação de marketing\n\nGestão completa, sem complicação! ✨\n\n#Arenix #SistemaSmartdisponível #GestãoCompleta #Arena"
              },
              {
                num: 4,
                title: "Post Aulas",
                caption: "Expanda seu negócio com aulas e cursos! 🎓\n\nArenix permite você oferecer:\n\n🎯 Aulas agendadas com facilidade\n💵 Tabelas de preço flexíveis\n📱 Planos mensais automáticos\n👥 Alunos bem organizados\n\nSua arena vai gerar mais receita! 💵\n\n#Arenix #AulasOnline #CursosEsportivos #Monetização"
              }
            ].map((item) => (
              <div key={item.num} className="bg-gray-800 rounded-lg p-6">
                <p className="text-yellow-400 font-bold mb-3">Post {item.num}: {item.title}</p>
                <p className="text-gray-300 text-sm whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {item.caption}
                </p>
                <button className="mt-3 bg-yellow-500 hover:bg-yellow-600 text-black px-4 py-2 rounded text-sm font-semibold transition">
                  📋 Copiar Caption
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-xl p-6 text-black">
            <p className="text-2xl mb-2">📅</p>
            <p className="font-bold mb-1">Melhor Dia</p>
            <p className="text-sm">Terça a quinta (18h-21h Brasília)</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl p-6 text-white">
            <p className="text-2xl mb-2">🎯</p>
            <p className="font-bold mb-1">Público Alvo</p>
            <p className="text-sm">Donos de arenas, quadras e franquias</p>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl p-6 text-white">
            <p className="text-2xl mb-2">🔗</p>
            <p className="font-bold mb-1">Link na Bio</p>
            <p className="text-sm">arenix.com.br ou demo gratuita</p>
          </div>
        </div>
      </div>
    </div>
  );
}