# Azuos Esportes

## Overview

Site completo da Azuos Esportes — plataforma de futvolei e beach tennis com agendamento de quadras, Copa Azuos (sistema de torneios), aulas de beach tennis, galeria de fotos e painel administrativo. Pagamentos via Mercado Pago.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **Payments**: Mercado Pago ou PicPay (configurável por tenant; suporte nos 3 fluxos: agendamentos, planos mensais e cobrança SaaS)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (backend)
│   └── azuos-esportes/     # React Vite frontend (at /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
```

## Database Schema

- `court_bookings` — Reservas de quadra de futvolei
- `class_bookings` — Reservas de aulas de beach tennis
- `tournaments` — Torneios da Copa Azuos
- `categories` — Categorias por torneio (estreante, iniciante, misto, etc.)
- `groups` — Grupos da fase de grupos
- `pairs` — Duplas cadastradas por categoria
- `matches` — Partidas (fase de grupos + eliminatórias)
- `sponsors` — Patrocinadores por torneio (posição: left, right, bottom)
- `gallery_photos` — Galeria de fotos do local

## Pages

- `/` — Home com slide banner animado, logo Azuos
- `/agendamento` — Agendamento de quadra futvolei (data, horário, pagamento MP)
- `/beach-tennis` — Info + agendamento de aulas com tabela de preços
- `/copa-azuos` — Lista de torneios + galeria de campeões
- `/copa-azuos/:id` — Detalhe do torneio (categorias, grupos, chaves, campeões, patrocinadores)
- `/galeria` — Galeria de fotos
- `/admin` — Painel admin protegido por senha

## Admin

- URL: `/admin`
- Senha padrão: `azuos2024admin` (mudar via env var `ADMIN_PASSWORD`)
- Funcionalidades: Criar torneios, categorias, duplas; gerar grupos e chaves; registrar resultados; upload de fotos e patrocinadores

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (provisionado automaticamente pelo Replit)
- `ADMIN_PASSWORD` — Senha do painel admin (default: `azuos2024admin`)
- `MERCADOPAGO_ACCESS_TOKEN` — Token de acesso do Mercado Pago (obter em mercadopago.com)
- `APP_URL` — URL base da aplicação para webhooks do Mercado Pago (ex: https://seusite.repl.co)

## Beach Tennis Pricing

- 1 pessoa: R$ 65,00
- 2 pessoas: R$ 55,00 cada
- 3 pessoas: R$ 50,00 cada
- 4 pessoas: R$ 45,00 cada

## Court Pricing

- R$ 80,00/hora

## Tournament System

- Phases: registration → group_stage → knockout → finished
- Bracket auto-generated: eighthfinals (>8 pairs), quarterfinals (5-8 pairs), semifinals (≤4 pairs)
- Standings calculated from group stage results
- Champions, runners-up and third place tracked per category

## Ranking System

- Table `pair_tournament_points` stores points per pair per tournament per category
- Points auto-calculated from match results, or set manually in admin
- Phase → Points: group_stage=10, eighthfinals=25, quarterfinals=35, semifinals=50, third_place=65, final=75, champion=100
- Public ranking at GET /api/tournaments/ranking — aggregated by categoryName across all tournaments
- Admin tab "Ranking" allows: select tournament/category, auto-calculate, add/edit/delete points
- Frontend: "Ranking Geral" section in Copa Azuos page with category tabs, medal icons, per-tournament columns

## Commands

- `pnpm --filter @workspace/db run push` — Apply DB migrations
- `pnpm --filter @workspace/api-spec run codegen` — Regenerate API client from OpenAPI spec
- `pnpm --filter @workspace/api-server run build` — Build API server
