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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const city = typeof body.city === "string" ? body.city.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const place = typeof body.place === "string" && body.place.trim() ? body.place.trim() : null;
  const protocol = typeof body.protocol === "string" ? body.protocol.trim() : "";

  if (!city || !kind || !description || !protocol) {
    return json({ error: "invalid_payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // IP real do cliente: Supabase Edge Functions injetam x-forwarded-for de
  // forma confiável (infra Deno Deploy). Guardamos só o hash, nunca o IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const salt = Deno.env.get("RATE_LIMIT_SALT") || "conecta-direitos-default-salt";
  const ipHash = await sha256Hex(ip + ":" + salt);

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();

  const { count, error: countError } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", windowStart);

  if (countError) return json({ error: "server_error" }, 500);
  if ((count ?? 0) >= RATE_LIMIT_MAX) return json({ error: "rate_limited" }, 429);

  const { error: insertError } = await supabase
    .from("denuncias")
    .insert({ city, kind, description, place, protocol });

  if (insertError) return json({ error: "insert_failed" }, 500);

  // Registra esta tentativa e aproveita pra limpar entradas antigas
  // (mantém a tabela pequena sem precisar de um cron separado).
  await supabase.from("rate_limits").insert({ ip_hash: ipHash });
  await supabase
    .from("rate_limits")
    .delete()
    .lt("created_at", new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 2 * 60_000).toISOString());

  return json({ ok: true }, 200);
});
