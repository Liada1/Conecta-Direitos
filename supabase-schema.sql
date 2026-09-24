-- Conecta Direitos — schema das denúncias anônimas
-- Rode isto no SQL Editor do seu projeto Supabase (supabase.com > seu projeto > SQL Editor > New query).
-- Depois disso, publique também a Edge Function em supabase/functions/submit-denuncia/
-- (veja as instruções no final deste arquivo) — sem ela, ninguém consegue enviar denúncia,
-- porque este schema deliberadamente NÃO dá à chave pública ("anon") permissão de INSERT.

create table if not exists public.denuncias (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  city text not null,
  kind text not null,
  description text not null,
  place text,
  protocol text not null
);

-- Se a tabela já existia de uma execução anterior sem esta coluna:
alter table public.denuncias add column if not exists protocol text;

-- Limites de tamanho também no banco (defesa em profundidade: a Edge
-- Function já valida, mas se um dia alguém escrever por outro caminho, o
-- banco segura). Batem com MAX_DESCRIPTION / MAX_PLACE da function.
-- "not valid" = não reprova linhas antigas, só as novas.
alter table public.denuncias drop constraint if exists denuncias_description_len;
alter table public.denuncias add constraint denuncias_description_len
  check (char_length(description) between 1 and 5000) not valid;
alter table public.denuncias drop constraint if exists denuncias_place_len;
alter table public.denuncias add constraint denuncias_place_len
  check (place is null or char_length(place) <= 200) not valid;
alter table public.denuncias drop constraint if exists denuncias_short_fields_len;
alter table public.denuncias add constraint denuncias_short_fields_len
  check (char_length(city) <= 60 and char_length(kind) <= 80 and char_length(protocol) <= 20) not valid;

-- Protocolo é o que a pessoa usa pra acompanhar o caso: não pode repetir.
-- Se esta linha falhar, já existem protocolos duplicados na tabela —
-- rode: select protocol, count(*) from denuncias group by 1 having count(*) > 1;
create unique index if not exists denuncias_protocol_key on public.denuncias (protocol);

alter table public.denuncias enable row level security;

-- Nenhuma policy é criada para "anon" — de propósito, e é uma mudança em
-- relação à primeira versão deste schema. Antes, a chave pública do site
-- tinha permissão de INSERT direto na tabela; isso funcionava, mas não
-- impedia ninguém de escrever um script batendo direto na API REST do
-- Supabase e enviando centenas de denúncias falsas por minuto (o honeypot
-- do formulário só engana preenchimento automático de campo, não alguém
-- chamando a API na mão).
--
-- Agora a única forma de inserir uma linha é através da Edge Function
-- submit-denuncia (supabase/functions/submit-denuncia/index.ts), que roda
-- com a service_role key (que ignora RLS) e aplica um limite de 5 envios
-- por IP a cada 30 minutos antes de gravar. Com RLS ligado e zero policies
-- para "anon", uma tentativa de INSERT direto na tabela é rejeitada.
drop policy if exists "anon pode inserir denuncias" on public.denuncias;

-- Tabela de apoio do rate limit da Edge Function. Guarda só um hash do IP
-- (nunca o IP em texto puro) + quando. Só a service_role toca nela — RLS
-- ligado e sem nenhuma policy trava qualquer acesso pela chave anon.
create table if not exists public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limits_ip_hash_created_at_idx
  on public.rate_limits (ip_hash, created_at);

alter table public.rate_limits enable row level security;

-- Para você mesmo ver as denúncias, use a aba "Table Editor" do Supabase
-- logado com sua conta (isso usa suas credenciais de dono do projeto, não
-- a anon key nem a service_role key da function).

-- ============================================================================
-- Publicando a Edge Function (obrigatório para o formulário funcionar):
--
-- Opção A — pelo painel (sem instalar nada):
--   Supabase Dashboard > seu projeto > Edge Functions > "Deploy a new function"
--   Nome: submit-denuncia
--   Cole o conteúdo de supabase/functions/submit-denuncia/index.ts
--   Deploy. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já ficam disponíveis
--   automaticamente dentro da function.
--
-- Depois, em Edge Functions > Secrets, configure:
--   RATE_LIMIT_SALT = um texto aleatório longo (ex.: gere com
--                     `openssl rand -hex 32`). Importante: sem ele a function
--                     usa um salt padrão que está público no GitHub.
--   ALLOWED_ORIGINS = (opcional) domínios que podem enviar, separados por
--                     vírgula. Padrão: https://conectadireitos.vercel.app
--                     — adicione aqui se o site ganhar um domínio próprio.
--
-- Opção B — com a Supabase CLI instalada e logada:
--   supabase functions deploy submit-denuncia --project-ref <seu-project-ref>
-- ============================================================================
