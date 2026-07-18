const { chromium } = require('playwright');

const config = JSON.parse(require('fs').readFileSync('config.json', 'utf8'));
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(msg) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
  if (!r.ok) console.error('Telegram error:', await r.text());
  else console.log('Telegram sent');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return !t.includes('Cargando...') && document.querySelector('[data-slot="badge"]');
    }, { timeout: 60000 });
    console.log('Main page loaded');

    const searchUrl = await page.evaluate((badgeText) => {
      const badges = document.querySelectorAll('[data-slot="badge"]');
      for (const b of badges) {
        if (b.textContent.trim().toLowerCase() === badgeText.toLowerCase()) {
          const card = b.closest('[class*="group"]');
          if (card) {
            const link = card.closest('a');
            if (link) return link.href;
          }
        }
      }
      return null;
    }, config.productBadge);

    if (!searchUrl) {
      console.log('Product not found on main page');
      await browser.close();
      return;
    }

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return !t.includes('Cargando...');
    }, { timeout: 30000 });

    const verBtn = page.getByText('Ver').first();
    if ((await verBtn.count()) > 0) {
      await verBtn.scrollIntoViewIfNeeded();
      await verBtn.click({ force: true });
      await page.waitForTimeout(4000);
    }

    const info = await page.evaluate(() => {
      const allSpans = document.querySelectorAll('span');
      let disponibilidad = '', vendedor = '', productName = '', price = '';

      for (const s of allSpans) {
        const t = s.textContent.trim();
        if (t === 'Disponibilidad' && s.nextElementSibling) {
          disponibilidad = s.nextElementSibling.textContent.trim();
        }
        if (t === 'Vendedor' && s.nextElementSibling) {
          vendedor = s.nextElementSibling.textContent.trim();
        }
      }

      const firstFields = document.querySelectorAll('.flex.flex-col');
      for (const f of firstFields) {
        const spans = f.querySelectorAll('span');
        if (spans.length >= 2 && spans[0].textContent.trim() === 'Vendedor') {
          vendedor = spans[1].textContent.trim();
        }
      }

      const h2 = document.querySelector('.fixed h2, h2');
      if (h2 && !h2.textContent.includes('KM CERO')) {
        productName = h2.textContent.trim();
      }

      const priceEl = document.querySelector('[class*="text-2xl"][class*="font-extrabold"]');
      if (priceEl) price = priceEl.textContent.trim();

      return { productName, disponibilidad, vendedor, price };
    });

    console.log('Status:', info.disponibilidad);

    if (info.disponibilidad && !info.disponibilidad.toLowerCase().includes('agotado')) {
      const lines = [
        `🟢 <b>${info.productName || config.productBadge}</b>`,
        '',
        `📦 <b>Disponibilidad:</b> ${info.disponibilidad}`,
      ];
      if (info.price) lines.push(`💵 <b>Precio:</b> ${info.price}`);
      if (info.vendedor) lines.push(`🏪 <b>Vendedor:</b> ${info.vendedor}`);
      lines.push('', `<a href="${config.url}">${config.url}</a>`);
      lines.push(`🕐 ${new Date().toLocaleString('es-CU', { timeZone: 'America/Havana' })}`);

      await sendTelegram(lines.join('\n'));
    } else {
      console.log('Out of stock. No notification.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
