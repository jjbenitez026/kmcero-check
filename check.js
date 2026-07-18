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

  const apiResponses = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/') && res.status() === 200) {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('json')) {
        try {
          const json = await res.json();
          apiResponses.push({ url, data: json });
        } catch {}
      }
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

    console.log('API responses captured:', apiResponses.length);
    for (const r of apiResponses) {
      console.log(`  ${r.url.substring(0, 120)} → ${JSON.stringify(r.data).substring(0, 100)}`);
    }

    let productId = null;
    let productName = '';

    for (const { url, data } of apiResponses) {
      const items = Array.isArray(data) ? data : (data?.products || data?.data || data?.items || []);
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        const haystack = [
          item.name, item.title, item.badge,
          ...(item.tags || []),
          item.category?.name || item.category || '',
          (item.badges || []).join(' '),
        ].filter(Boolean).join(' ').toLowerCase();

        if (haystack.includes(config.productBadge.toLowerCase())) {
          productId = item.id || item._id || item.slug || item.sku;
          productName = item.name || item.title || '';
          console.log('Found product in API:', JSON.stringify(item).substring(0, 400));

          const stock = item.stock ?? item.quantity ?? item.availability ?? item.inStock ?? item.disponibilidad;
          let statusText = '';
          if (typeof stock === 'number') {
            statusText = stock > 0 ? `${stock} u.` : 'Agotado';
          } else if (typeof stock === 'string') {
            statusText = stock;
          } else if (item.available !== undefined) {
            statusText = item.available ? 'Disponible' : 'Agotado';
          } else {
            statusText = 'unavailable';
          }

          if (statusText && !statusText.toLowerCase().includes('agotado') && !statusText.toLowerCase().includes('0')) {
            const price = item.price || item.precio || '';
            const msg = [
              `🟢 <b>${productName || config.productBadge}</b>`,
              '',
              `📦 <b>Disponibilidad:</b> ${statusText}`,
              price ? `💵 <b>Precio:</b> ${price}` : '',
              '',
              `<a href="${config.url}">${config.url}</a>`,
            ].filter(Boolean).join('\n');
            await sendTelegram(msg);
          } else {
            console.log('Out of stock via API.');
          }
          await browser.close();
          return;
        }
      }
    }

    console.log('Product not found via API responses. Trying detail page...');

    const badge = page.locator('[data-slot="badge"]').filter({ hasText: config.productBadge }).first();
    if ((await badge.count()) === 0) {
      console.log('No badge found either. Cannot proceed.');
      await browser.close();
      return;
    }

    const slugs = await page.evaluate((badgeText) => {
      const badges = document.querySelectorAll('[data-slot="badge"]');
      for (const b of badges) {
        if (b.textContent.trim().toLowerCase() === badgeText.toLowerCase()) {
          const card = b.closest('[class*="group"]');
          if (card) {
            const link = card.closest('a');
            const h3 = card.querySelector('h3');
            const img = card.querySelector('img');
            return {
              href: link?.href || '',
              h3: h3?.textContent?.trim() || '',
              imgSrc: img?.src || '',
            };
          }
        }
      }
      return null;
    }, config.productBadge);

    console.log('Card info:', JSON.stringify(slugs));

    if (slugs?.href) {
      console.log('Navigating to product link:', slugs.href);
      await page.goto(slugs.href, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
    } else {
      console.log('No direct link. Clicking card...');
      const card = badge.locator('xpath=ancestor::div[contains(@class, "group")]').first();
      await card.scrollIntoViewIfNeeded();

      await card.hover();
      await page.waitForTimeout(1000);

      const quickViewBtn = card.locator('[data-slot="button"]').first();
      if (await quickViewBtn.count() > 0) {
        console.log('Clicking quick view button...');
        await quickViewBtn.click({ force: true });
      } else {
        await card.click({ force: true });
      }
      await page.waitForTimeout(5000);
    }

    await page.screenshot({ path: 'debug.png', fullPage: true });

    const afterInfo = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.textContent.includes('Disponibilidad') && el.textContent.includes('Agotado')) {
          return { type: 'agotado', text: el.textContent.trim().substring(0, 200) };
        }
        if (el.textContent.includes('Disponibilidad') && /\d+\s*u\./.test(el.textContent)) {
          const m = el.textContent.match(/(\d+\s*u\.)/);
          return { type: 'available', text: m ? m[1] : 'available', fullText: el.textContent.trim().substring(0, 200) };
        }
      }

      const fixedEls = document.querySelectorAll('.fixed');
      const result = { fixedCount: fixedEls.length, texts: [] };
      for (const el of fixedEls) {
        const text = el.textContent?.trim()?.substring(0, 100) || '';
        result.texts.push(text);
      }
      return result;
    });

    console.log('After click state:', JSON.stringify(afterInfo));

    if (afterInfo?.type === 'available') {
      const msg = [
        `🟢 <b>${slugs?.h3 || config.productBadge}</b>`,
        '',
        `📦 <b>${afterInfo.text}</b>`,
        '',
        `<a href="${config.url}">${config.url}</a>`,
      ].join('\n');
      await sendTelegram(msg);
    } else {
      console.log('Not available or not found.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await page.screenshot({ path: 'debug.png', fullPage: true }).catch(() => {});
    await browser.close();
  }
})();
