// Supabase Edge Function «admin-reply»: отправляет ответ на сообщение с сайта
// с общей почты (Gmail) и отмечает сообщение как отвеченное.
// Нужны секреты (Edge Functions → Secrets): GMAIL_USER и GMAIL_APP_PASSWORD.
import nodemailer from 'npm:nodemailer@6.9.16';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const user = Deno.env.get('GMAIL_USER');
    const pass = Deno.env.get('GMAIL_APP_PASSWORD');
    if (!user || !pass) return json({ error: 'Не заданы секреты GMAIL_USER и GMAIL_APP_PASSWORD' }, 500);

    // запрос выполняется от имени вошедшего администратора — права проверяет база
    const db = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY'))!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: isAdmin } = await db.rpc('is_admin');
    if (!isAdmin) return json({ error: 'Нет доступа' }, 403);

    const { message_id, text } = await req.json();
    const reply = String(text ?? '').trim();
    if (!reply) return json({ error: 'Напишите текст ответа' }, 400);
    if (reply.length > 5000) return json({ error: 'Ответ слишком длинный' }, 400);

    const { data: msg, error } = await db.from('contact_messages').select('*').eq('id', message_id).single();
    if (error || !msg) return json({ error: 'Сообщение не найдено' }, 404);

    const date = new Date(msg.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const quote = `${msg.name} писал(а) ${date}:\n${msg.message}`;
    const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
    await transport.sendMail({
      from: `"ВкусЗдоровья" <${user}>`,
      to: msg.email,
      replyTo: user,
      subject: 'ВкусЗдоровья: ответ на ваше сообщение',
      text: `Здравствуйте, ${msg.name}!\n\n${reply}\n\nС уважением,\nкоманда ВкусЗдоровья\n\n— — —\n${quote}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d2b20">
        <p>Здравствуйте, ${esc(msg.name)}!</p>
        <p style="white-space:pre-wrap">${esc(reply)}</p>
        <p>С уважением,<br>команда <b style="color:#2d5f3b">ВкусЗдоровья</b></p>
        <blockquote style="margin:24px 0 0;padding:8px 12px;border-left:3px solid #b9e2a3;color:#6b7a6e;white-space:pre-wrap">${esc(quote)}</blockquote>
      </div>`,
    });

    await db.rpc('admin_mark_answered', { message_id, reply });
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
