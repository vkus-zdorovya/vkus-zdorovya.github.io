// Supabase Edge Function «product»: ищет товар по штрихкоду для сканера.
// 1) смотрит в нашей таблице products; 2) если нет — спрашивает Open Food Facts
// со стороны сервера Supabase и сохраняет ответ. Так сканер работает в России без VPN.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const FIELDS = 'product_name,product_name_ru,brands,image_front_small_url,nutriments,nutriscore_grade,nova_group,additives_tags,ingredients_text_ru,ingredients_text,categories_tags,quantity';
const REFRESH_DAYS = 30; // товары из Open Food Facts раз в месяц обновляем

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { code } = await req.json();
    const barcode = String(code ?? '').replace(/\D/g, '');
    if (!/^[0-9]{6,14}$/.test(barcode)) return json({ error: 'Штрихкод должен содержать 8–14 цифр' }, 400);

    // ключ service_role есть только на сервере Supabase — им пишем в таблицу товаров
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: saved } = await db.from('products').select('data, source, updated_at').eq('barcode', barcode).maybeSingle();
    const fresh = saved && (saved.source === 'user' || Date.now() - new Date(saved.updated_at).getTime() < REFRESH_DAYS * 864e5);
    if (fresh) return json({ product: saved.data, source: saved.source });

    let product = null;
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${FIELDS}`, {
        headers: { 'User-Agent': 'VkusZdorovya/1.0 (https://vkus-zdorovya.github.io)' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.status === 1 && body.product) product = body.product;
      }
    } catch { /* Open Food Facts недоступен — отдадим то, что есть у нас */ }

    if (product) {
      await db.from('products').upsert({ barcode, data: product, source: 'off', updated_at: new Date().toISOString() });
      return json({ product, source: 'off' });
    }
    if (saved) return json({ product: saved.data, source: saved.source, stale: true });
    return json({ product: null });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
