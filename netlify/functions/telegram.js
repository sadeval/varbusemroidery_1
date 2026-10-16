// Serverless-функция Netlify: приём заявок и отправка их в Telegram.
// Токен бота и chat id хранятся в переменных окружения Netlify
// (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) и никогда не попадают в код страницы.

const ALLOWED_HOSTS = ['varbusembroidery.com.ua', 'www.varbusembroidery.com.ua'];

function originAllowed(origin) {
  if (!origin) return true; // запросы не из браузера (например, проверки)
  try {
    const host = new URL(origin).host;
    return ALLOWED_HOSTS.includes(host) || host.endsWith('.netlify.app');
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clean(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function reply(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { Allow: 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return reply(405, { ok: false, error: 'Method not allowed' });
  }

  const origin = event.headers.origin || event.headers.Origin || '';
  if (!originAllowed(origin)) {
    return reply(403, { ok: false, error: 'Forbidden' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return reply(500, { ok: false, error: 'Server not configured' });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { ok: false, error: 'Bad request' });
  }

  // Приховане поле-пастка для ботів: якщо заповнене — тихо ігноруємо.
  if (clean(data.hp, 100)) {
    return reply(200, { ok: true });
  }

  const name = clean(data.name, 100);
  const contact = clean(data.contact, 150);
  const message = clean(data.message, 3000);
  const calc = clean(data.calc, 2000);
  const image = typeof data.image === 'string' ? data.image : '';

  if (!name || contact.length < 5 || !message) {
    return reply(400, { ok: false, error: 'Заповніть ім’я, контакт і опис замовлення.' });
  }

  const text = [
    '🔔 Нова заявка на вишивку',
    `Ім’я: ${escapeHtml(name)}`,
    `Контакт: ${escapeHtml(contact)}`,
    '',
    '<i>Замовлення:</i>',
    escapeHtml(message),
    calc ? `\n<i>Розрахунок:</i>\n${escapeHtml(calc)}` : ''
  ].join('\n');

  const apiBase = `https://api.telegram.org/bot${token}`;

  try {
    if (image.startsWith('data:image/')) {
      const comma = image.indexOf(',');
      const mime = image.slice(5, comma).split(';')[0] || 'image/jpeg';
      const buffer = Buffer.from(image.slice(comma + 1), 'base64');

      if (buffer.length > 5 * 1024 * 1024) {
        throw new Error('Макет завеликий (максимум 5 МБ).');
      }

      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', text);
      form.append('parse_mode', 'HTML');
      form.append('photo', new Blob([buffer], { type: mime }), 'maket.jpg');

      const response = await fetch(`${apiBase}/sendPhoto`, { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.description || `Telegram: HTTP ${response.status}`);
      }
    } else {
      const response = await fetch(`${apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.description || `Telegram: HTTP ${response.status}`);
      }
    }

    return reply(200, { ok: true });
  } catch (error) {
    return reply(502, { ok: false, error: error.message || 'Telegram error' });
  }
};
