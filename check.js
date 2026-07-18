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

    const found = await page.evaluate((badgeText) => {
      const badges = document.querySelectorAll('[data-slot="badge"]');
      for (const badge of badges) {
        if (badge.textContent.trim().toLowerCase() === badgeText.toLowerCase()) {
          const card = badge.closest('[class*="group"]');
          if (card) {
            card.scrollIntoView({ behavior: 'instant', block: 'center' });
            card.click();
            return true;
          }
        }
      }
      return false;
    }, config.productBadge);

    if (!found) {
      console.log(`Product "${config.productBadge}" not found`);
      await browser.close();
      return;
    }

    console.log('Product found and clicked');

    await page.waitForTimeout(3000);

    const modalOpened = await page.evaluate(() => {
      const fixed = document.querySelectorAll('.fixed');
      for (const el of fixed) {
        if (el.classList.contains('inset-0') &&
            (el.classList.contains('z-50') || el.classList.contains('z-52')) &&
            el.querySelector('h2')) {
          return el.outerHTML.includes('Disponibilidad');
        }
      }
      return false;
    });

    if (!modalOpened) {
      console.log('Modal did not open');
      await browser.close();
      return;
    }

    console.log('Modal detected');

    const info = await page.evaluate(() => {
      const fixed = document.querySelectorAll('.fixed');
      let modal = null;
      for (const el of fixed) {
        if (el.classList.contains('inset-0') &&
            (el.classList.contains('z-50') || el.classList.contains('z-52')) &&
            el.querySelector('h2')) {
          modal = el;
          break;
        }
      }
      if (!modal) return null;

      const h2 = modal.querySelector('h2');
      const productName = h2 ? h2.textContent.trim() : '';

      const allSpans = modal.querySelectorAll('span');
      let statusText = '';
      let sellerText = '';

      for (const span of allSpans) {
        if (span.textContent.trim() === 'Disponibilidad') {
          const parent = span.parentElement;
          if (parent) {
            const statusSpan = parent.querySelector('span.text-sm.font-semibold');
            if (statusSpan) statusText = statusSpan.textContent.trim();
          }
        }
        if (span.textContent.trim() === 'Vendedor') {
          const parent = span.parentElement;
          if (parent) {
            const sellerSpan = parent.querySelector('span.font-semibold:not(.text-\\[10px\\])');
            if (sellerSpan) sellerText = sellerSpan.textContent.trim();
          }
        }
      }

      const priceEl = modal.querySelector('p.text-2xl');
      const priceText = priceEl ? priceEl.textContent.trim() : '';

      return { productName, statusText, sellerText, priceText };
    });

    if (!info || !info.statusText) {
      console.log('Could not extract product info');
      await browser.close();
      return;
    }

    console.log(`Product: ${info.productName}`);
    console.log(`Status: "${info.statusText}"`);
    console.log(`Seller: ${info.sellerText}`);
    console.log(`Price: ${info.priceText}`);

    const isAvailable = !info.statusText.toLowerCase().includes('agotado');

    if (isAvailable) {
      const message = [
        `🟢 <b>${info.productName}</b>`,
        '',
        `📦 <b>Disponibilidad:</b> ${info.statusText}`,
        `💵 <b>Precio:</b> ${info.priceText}`,
        `🏪 <b>Vendedor:</b> ${info.sellerText}`,
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
  } finally {
    await browser.close();
  }
})();
