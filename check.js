const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars');
  process.exit(1);
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Telegram error:', err);
  } else {
    console.log('Telegram notification sent');
  }
}

(async () => {
  console.log(`Checking product: "${config.productBadge}"`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });
    console.log('Page loaded');

    await page.waitForSelector('[data-slot="badge"]', { timeout: 45000 });
    console.log('Products rendered');

    const badges = page.locator('[data-slot="badge"]');
    const count = await badges.count();
    let productCard = null;

    for (let i = 0; i < count; i++) {
      const text = await badges.nth(i).textContent();
      if (text.trim().toLowerCase() === config.productBadge.trim().toLowerCase()) {
        productCard = badges.nth(i).locator('xpath=ancestor::div[contains(@class, "group")]');
        break;
      }
    }

    if (!productCard) {
      console.log(`Product "${config.productBadge}" not found`);
      await browser.close();
      return;
    }

    console.log('Product found, clicking...');
    await productCard.click();

    const modal = page.locator('.fixed.inset-0.z-52');
    await modal.waitFor({ state: 'visible', timeout: 15000 });
    console.log('Modal opened');

    const productName = (await modal.locator('h2').first().textContent()).trim();
    const statusText = (await modal.locator('span:has-text("Disponibilidad") + span').textContent()).trim();

    console.log(`Product: ${productName}`);
    console.log(`Status: "${statusText}"`);

    const isAvailable = !statusText.toLowerCase().includes('agotado');

    if (isAvailable) {
      const priceText = (await modal.locator('p.text-2xl.font-extrabold').first().textContent()).trim();
      const sellerText = (await modal.locator('span:has-text("Vendedor") + span').textContent()).trim();

      const message = [
        `🟢 <b>${productName}</b>`,
        '',
        `📦 <b>Disponibilidad:</b> ${statusText}`,
        `💵 <b>Precio:</b> ${priceText}`,
        `🏪 <b>Vendedor:</b> ${sellerText}`,
        '',
        `<a href="${config.url}">${config.url}</a>`,
        `🕐 ${new Date().toLocaleString('es-CU', { timeZone: 'America/Havana' })}`,
      ].join('\n');

      await sendTelegram(message);
    } else {
      console.log('Product is out of stock. No notification sent.');
    }
  } catch (err) {
    console.error('Error:', err.message);
    try {
      await sendTelegram(`❌ Error checking "${config.productBadge}": ${err.message}`);
    } catch (_) {}
  } finally {
    await browser.close();
  }
})();
