// Conecta Direitos — recebe uma denúncia anônima, aplica rate limit por IP
// (hasheado, nunca guardado em texto puro) e só então grava em `denuncias`
// usando a service_role key (que nunca sai deste servidor). Depois de
// publicada, a tabela `denuncias` não aceita mais INSERT direto da chave
// anon pública — este é o único caminho de escrita, então quem tentar
// enviar direto pra API REST do Supabase (sem passar por aqui) é rejeitado
// pela política de RLS. Isso é o que de fato impede alguém de gerar spam
// automatizado direto contra a API, coisa que o honeypot no formulário não
// resolve sozinho (o honeypot só engana preenchimento automático de campo,
// não barra quem chama a API na mão).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MINUTES = 30;

// Limites de tamanho: batem com o maxLength do formulário (index.html) e
// com os CHECKs de supabase-schema.sql. Impedem alguém de gravar megabytes
// de texto por requisição direto na API.
const MAX_BODY_BYTES = 16_000;
const MAX_DESCRIPTION = 5000;
const MAX_PLACE = 200;

// Só aceita os valores que o formulário oferece — nada de texto livre em
// city/kind. Mantenha em sincronia com CITIES e KINDS do index.html.
const CITIES = new Set([
  "Tianguá", "Viçosa do Ceará", "Ubajara", "São Benedito", "Ibiapina",
  "Guaraciaba do Norte", "Carnaubal", "Croatá", "Ipu",
]);
const KINDS = new Set([
  "Discriminação em serviço público",
  "Recusa de atendimento em saúde",
  "Desrespeito ao nome social",
  "Violência física ou ameaça",
  "Agressão verbal ou injúria",
  "Discriminação no trabalho ou escola",
  "Outra situação",
]);
// CD-XXXX-XXXX (atual) ou CD-###### (formato antigo, de abas abertas antes
// da atualização).
const PROTOCOL_RE = /^CD-(?:[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}|\d{6})$/;

// Origens que podem chamar a function pelo navegador. Configurável pela
// variável ALLOWED_ORIGINS (separada por vírgula) sem precisar mudar código.
// CORS não é a proteção principal (quem usa curl ignora CORS — pra isso
// existe o rate limit), mas impede outro site de embutir o formulário e
// enviar denúncias em nome dos visitantes dele.
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ||
    "https://conectadireitos.vercel.app,https://conecta-direitos.vercel.app")
    .split(",").map((o) => o.trim()).filter(Boolean),
);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  // Abrir o index.html direto do disco (file://) manda Origin "null" —
  // liberado só pra dar pra testar localmente; o rate limit continua valendo.
  if (ALLOWED_ORIGINS.has(origin) || origin === "null" || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

function json(req: Request, body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(req, { error: "payload_too_large" }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return json(req, { error: "invalid_json" }, 400);
  }

  const city = typeof body.city === "string" ? body.city.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const place = typeof body.place === "string" && body.place.trim() ? body.place.trim() : null;
  const protocol = typeof body.protocol === "string" ? body.protocol.trim() : "";

  if (
    !CITIES.has(city) || !KINDS.has(kind) || !PROTOCOL_RE.test(protocol) ||
    !description || description.length > MAX_DESCRIPTION ||
    (place !== null && place.length > MAX_PLACE)
  ) {
    return json(req, { error: "invalid_payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // IP real do cliente: Supabase Edge Functions injetam x-forwarded-for de
  // forma confiável (infra Deno Deploy). Guardamos só o hash, nunca o IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Configure RATE_LIMIT_SALT (Edge Functions > Secrets) com um texto
  // aleatório longo. O valor padrão abaixo é público (está no GitHub): com
  // ele, dá pra testar todos os IPv4 e reverter o hash em pouco tempo.
  const salt = Deno.env.get("RATE_LIMIT_SALT") || "conecta-direitos-default-salt";
  if (!Deno.env.get("RATE_LIMIT_SALT")) console.warn("RATE_LIMIT_SALT não configurado — usando salt padrão público");
  const ipHash = await sha256Hex(ip + ":" + salt);

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();

  const { count, error: countError } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart);

  if (countError) return json(req, { error: "server_error" }, 500);
  if ((count ?? 0) >= RATE_LIMIT_MAX) return json(req, { error: "rate_limited" }, 429);

  const { error: insertError } = await supabase
    .from("denuncias")
    .insert({ city, kind, description, place, protocol });

  if (insertError) return json(req, { error: "insert_failed" }, 500);

  // Registra esta tentativa e aproveita pra limpar entradas antigas
  // (mantém a tabela pequena sem precisar de um cron separado).
  await supabase.from("rate_limits").insert({ ip_hash: ipHash });
  await supabase
    .from("rate_limits")
    .delete()
    .lt("created_at", new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 2 * 60_000).toISOString());

  return json(req, { ok: true }, 200);
});
