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
    console.log('Splash gone, products rendered');

    const badge = page.locator('[data-slot="badge"]').filter({ hasText: config.productBadge }).first();
    if ((await badge.count()) === 0) {
      console.log('Product not found');
      return;
    }

    const card = badge.locator('xpath=ancestor::div[contains(@class, "group")]').first();
    await card.scrollIntoViewIfNeeded();
    await card.click({ force: true });
    console.log('Clicked product card');

    const modal = page.locator('.fixed').filter({ has: page.locator('h2') }).first();
    await modal.waitFor({ state: 'visible', timeout: 15000 });
    console.log('Modal opened');

    const info = await modal.evaluate(el => {
      const h2 = el.querySelector('h2');
      const name = h2?.textContent?.trim() || '';

      const spans = [...el.querySelectorAll('span')];
      let status = '', seller = '', price = '';

      for (const s of spans) {
        const t = s.textContent.trim();
        if (t === 'Disponibilidad' && s.nextElementSibling) {
          status = s.nextElementSibling.textContent.trim();
        }
        if (t === 'Vendedor' && s.nextElementSibling) {
          seller = s.nextElementSibling.textContent.trim();
        }
      }

      const p = el.querySelector('[class*="text-2xl"][class*="font-extrabold"]');
      price = p?.textContent?.trim() || '';

      return { name, status, seller, price };
    });

    console.log(`Product: ${info.name}`);
    console.log(`Status: "${info.status}"`);
    if (info.seller) console.log(`Seller: ${info.seller}`);
    if (info.price) console.log(`Price: ${info.price}`);

    if (info.status && !info.status.toLowerCase().includes('agotado')) {
      const lines = [
        `🟢 <b>${info.name}</b>`,
        '',
        `📦 <b>Disponibilidad:</b> ${info.status}`,
      ];
      if (info.price) lines.push(`💵 <b>Precio:</b> ${info.price}`);
      if (info.seller) lines.push(`🏪 <b>Vendedor:</b> ${info.seller}`);
      lines.push('', `<a href="${config.url}">${config.url}</a>`);
      lines.push(`🕐 ${new Date().toLocaleString('es-CU', { timeZone: 'America/Havana' })}`);

      await sendTelegram(lines.join('\n'));
    } else {
      console.log('Out of stock or no status.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
