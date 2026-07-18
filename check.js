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

function walkForProduct(obj, badgeText, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = walkForProduct(item, badgeText, depth + 1);
      if (r) return r;
    }
    return null;
  }

  const str = JSON.stringify(obj).toLowerCase();
  if (!str.includes(badgeText.toLowerCase())) return null;

  const name = obj.name || obj.title || obj.productName || '';
  const haystack = (name + ' ' + JSON.stringify(obj)).toLowerCase();
  if (!haystack.includes(badgeText.toLowerCase())) return null;

  if (obj.stock !== undefined || obj.quantity !== undefined ||
      obj.availability !== undefined || obj.disponibilidad !== undefined ||
      obj.inStock !== undefined || obj.available !== undefined) {
    return obj;
  }

  for (const key of Object.keys(obj)) {
    const r = walkForProduct(obj[key], badgeText, depth + 1);
    if (r) return r;
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const apiResponses = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/graphql') && res.status() === 200) {
      try {
        const json = await res.json();
        apiResponses.push({ url, data: json });
      } catch {}
    }
  });

  try {
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return !t.includes('Cargando...') && document.querySelector('[data-slot="badge"]');
    }, { timeout: 60000 });
    console.log('Splash gone, products rendered');

    await page.waitForTimeout(3000);

    console.log('GraphQL responses:', apiResponses.length);

    let productData = null;

    for (const { data } of apiResponses) {
      const found = walkForProduct(data, config.productBadge);
      if (found) {
        productData = found;
        console.log('Product found:', JSON.stringify(found, null, 2).substring(0, 800));
        break;
      }
    }

    if (productData) {
      const stock = productData.stock ?? productData.quantity ?? productData.availability ?? productData.disponibilidad;
      const available = productData.available ?? productData.inStock ?? true;
      const name = productData.name || productData.title || config.productBadge;
      const price = productData.price || productData.precio || '';

      let statusText = '';
      if (typeof stock === 'number') {
        statusText = stock > 0 ? `${stock} u.` : 'Agotado';
      } else if (typeof stock === 'string') {
        statusText = stock;
      } else {
        statusText = available ? 'Disponible' : 'Agotado';
      }

      if (statusText && !statusText.toLowerCase().includes('agotado') && !statusText.toLowerCase().includes('0')) {
        const msg = [
          `🟢 <b>${name}</b>`,
          '',
          `📦 <b>Disponibilidad:</b> ${statusText}`,
          price ? `💵 <b>Precio:</b> ${price}` : '',
          '',
          `<a href="${config.url}">${config.url}</a>`,
        ].filter(Boolean).join('\n');
        await sendTelegram(msg);
      } else {
        console.log('Out of stock:', statusText);
      }
      await browser.close();
      return;
    }

    console.log('Not found in API. Navigating to search URL...');

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

    if (searchUrl) {
      console.log('Navigating to:', searchUrl);
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'debug.png', fullPage: true });

      const pageInfo = await page.evaluate(() => {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          if (el.textContent.includes('Disponibilidad') && !el.textContent.includes('Cargando')) {
            const text = el.textContent.trim();
            if (text.toLowerCase().includes('agotado')) {
              return { type: 'agotado', text };
            }
            if (/\d+\s*u\./.test(text)) {
              return { type: 'available', text: text.match(/(\d+\s*u\.)/)[1] };
            }
          }
        }
        const fixedEls = document.querySelectorAll('.fixed');
        const dialogEls = document.querySelectorAll('[role="dialog"]');
        return {
          fixedCount: fixedEls.length,
          dialogCount: dialogEls.length,
          bodyStart: document.body.innerText?.substring(0, 500),
        };
      });

      console.log('Page state:', JSON.stringify(pageInfo));

      if (pageInfo?.type === 'available') {
        const msg = [
          `🟢 <b>${config.productBadge}</b>`,
          '',
          `📦 <b>${pageInfo.text}</b>`,
          '',
          `<a href="${config.url}">${config.url}</a>`,
        ].join('\n');
        await sendTelegram(msg);
      }
    } else {
      console.log('No search URL found');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await page.screenshot({ path: 'debug.png', fullPage: true }).catch(() => {});
    await browser.close();
  }
})();
