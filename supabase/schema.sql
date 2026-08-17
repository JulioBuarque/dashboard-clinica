-- ============================================================
-- DASHBOARD CLINICA - SCHEMA SUPABASE
-- Rodar em: Supabase > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1) AGENDAMENTOS
-- Origem: Google Calendar sincronizado pelo workflow n8n
-- ------------------------------------------------------------
create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  calendar_event_id text unique,            -- id do evento no Google Calendar (dedupe)
  titulo text,                              -- titulo do evento
  tipo text not null default 'outro',       -- consulta | exame | outro
  paciente_nome text,                       -- nome extraido (opcional)
  telefone text,                            -- telefone do paciente (opcional)
  inicio timestamptz,                       -- data/hora inicial
  fim timestamptz,                          -- data/hora final (opcional)
  status text not null default 'agendado',  -- agendado | remarcado | cancelado
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agendamentos_inicio on public.agendamentos (inicio);
create index if not exists idx_agendamentos_tipo  on public.agendamentos (tipo);
create index if not exists idx_agendamentos_status on public.agendamentos (status);

-- ------------------------------------------------------------
-- 2) CONTATOS (eventos de mensagem do fluxo 01)
-- Origem: inserts no n8n (opcional, para metricas ricas)
-- ------------------------------------------------------------
create table if not exists public.contatos (
  id uuid primary key default gen_random_uuid(),
  telefone text,
  nome text,
  api_type text,             -- evolution | uazapi | zapi
  tipo_mensagem text,        -- texto | audio | imagem | figurinha | documento
  from_me boolean not null default false,
  evento text not null default 'contato',
  created_at timestamptz not null default now()
);

create index if not exists idx_contatos_created on public.contatos (created_at);
create index if not exists idx_contatos_telefone on public.contatos (telefone);
create index if not exists idx_contatos_telefone_created on public.contatos (telefone, created_at desc);

-- ============================================================
-- SEGURANCA (LGPD)
-- RLS ativo e SEM politica publica: apenas o backend Node
-- (service_role key, guardada no .env do servidor) acessa.
-- Nenhuma chave "anon" e usada no site publico.
-- ============================================================
alter table public.agendamentos enable row level security;
alter table public.contatos enable row level security;

-- (Nenhuma policy adicional e criada de proposito:
--  com RLS ativo e sem policies, o acesso so funciona via
--  service_role / owner, que e o que o backend Node usa.)