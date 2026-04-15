import React from 'react';

export default function ArenixInstagram() {
  const posts = [
    {
      id: 1,
      title: 'Conheça Arenix',
      subtitle: 'A plataforma completa para gerenciar sua arena',
      description: 'Sistema inteligente de agendamentos, gestão financeira e análise de dados em tempo real.',
      gradient: 'from-purple-600 to-blue-600',
      emoji: '🚀',
      hashtags: '#Arenix #ArenaMagagement #Inovação'
    },
    {
      id: 2,
      title: 'Gerencie com eficiência',
      subtitle: 'Tudo em um só lugar',
      description: 'Quadras • Agendamentos • Pagamentos • Torneiros • Integrações',
      gradient: 'from-blue-600 to-cyan-600',
      emoji: '⚡',
      hashtags: '#Gestão #SistemaSmart #ArenasModernas'
    },
    {
      id: 3,
      title: 'Transforme seu negócio',
      subtitle: 'Clientes satisfeitos = Receita crescente',
      description: 'Aumente sua ocupação, melhore a experiência dos clientes e potencialize seus lucros.',
      gradient: 'from-cyan-600 to-emerald-600',
      emoji: '💰',
      hashtags: '#Resultados #Crescimento #ArenixSucesso'
    }
  ];

  return (
    <div className="min-h-screen bg-black p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-white mb-2">Posts Instagram - Arenix</h1>
          <p className="text-gray-400">Sequência de 3 posts interligados para divulgar o sistema</p>
        </div>

        {/* Posts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {posts.map((post) => (
            <div
              key={post.id}
              className="aspect-square rounded-3xl overflow-hidden shadow-2xl hover:scale-105 transition-transform duration-300"
            >
              {/* Instagram Post Container */}
              <div className="w-full h-full flex flex-col bg-white">
                {/* Post Content Area */}
                <div className={`flex-1 bg-gradient-to-br ${post.gradient} p-8 flex flex-col justify-between relative overflow-hidden`}>
                  {/* Background decorative elements */}
                  <div className="absolute top-0 right-0 w-40 h-40 bg-white opacity-10 rounded-full -mr-20 -mt-20"></div>
                  <div className="absolute bottom-0 left-0 w-40 h-40 bg-black opacity-10 rounded-full -ml-20 -mb-20"></div>

                  {/* Header */}
                  <div className="relative z-10">
                    <div className="text-5xl mb-4">{post.emoji}</div>
                    <h2 className="text-3xl font-bold text-white mb-2">{post.title}</h2>
                    <p className="text-white text-opacity-90 font-semibold">{post.subtitle}</p>
                  </div>

                  {/* Logo/Center element */}
                  <div className="flex justify-center items-center relative z-10">
                    <div className="w-24 h-24 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center border-2 border-white border-opacity-40">
                      <span className="text-4xl font-bold text-white">A</span>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="relative z-10">
                    <p className="text-white text-sm leading-relaxed mb-3">{post.description}</p>
                    <p className="text-white text-opacity-80 text-xs font-semibold">{post.hashtags}</p>
                  </div>
                </div>

                {/* Footer (Instagram-like) */}
                <div className="bg-white p-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-2">
                      <button className="text-2xl hover:opacity-70 transition">❤️</button>
                      <button className="text-2xl hover:opacity-70 transition">💬</button>
                      <button className="text-2xl hover:opacity-70 transition">📤</button>
                    </div>
                    <button className="text-2xl hover:opacity-70 transition">🔖</button>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">
                    <span className="font-bold text-gray-900">12.5K</span> curtidas
                  </p>
                  <p className="text-xs text-gray-700">
                    <span className="font-bold">Arenix</span> {post.id === 1 ? 'Descubra nossa solução' : post.id === 2 ? 'Gestão eficiente' : 'Comece agora'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tips Section */}
        <div className="mt-16 bg-gray-900 rounded-2xl p-8 border border-gray-800">
          <h3 className="text-xl font-bold text-white mb-6">💡 Dicas de Postagem</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-white font-semibold mb-2">📅 Melhor Horário</p>
              <p className="text-gray-400 text-sm">Terça a quinta, entre 18h-21h (horário Brasília)</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-white font-semibold mb-2">🎯 Público Alvo</p>
              <p className="text-gray-400 text-sm">Donos de arenas e quadras de esportes</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4">
              <p className="text-white font-semibold mb-2">📍 Call to Action</p>
              <p className="text-gray-400 text-sm">Link do site ou demo na bio</p>
            </div>
          </div>
        </div>

        {/* Copy Caption */}
        <div className="mt-8 bg-gray-900 rounded-2xl p-6 border border-gray-800">
          <p className="text-white font-semibold mb-4">📝 Caption Sugerida (para os 3 posts):</p>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-gray-300 text-sm mb-4">
              <span className="font-semibold text-white">Post 1:</span> "Conheça Arenix, a plataforma que está revolucionando a gestão de arenas no Brasil 🚀 Sistema completo de agendamentos, financeiro e análise de dados. Sua arena merece evoluir! 
              #Arenix #ArenasModernas #GestãoInteligente"
            </p>
            <p className="text-gray-300 text-sm mb-4">
              <span className="font-semibold text-white">Post 2:</span> "Tudo que você precisa em um só lugar ⚡ Gerencie quadras, agendamentos, pagamentos, torneiros e integrações sem complicações. Deixe a tecnologia trabalhar para você! 
              #Arenix #SistemaSmartdisponível #EficiênciaOperacional"
            </p>
            <p className="text-gray-300 text-sm">
              <span className="font-semibold text-white">Post 3:</span> "Transforme seus números 💰 Arenas que usam Arenix aumentam ocupação, melhoram satisfação dos clientes e potencializam lucros. Seu crescimento começa aqui! 
              #Arenix #ResultadosReais #ArenasQueGanham"
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}