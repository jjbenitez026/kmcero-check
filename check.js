const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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
  if (!res.ok) console.error('Telegram error:', await res.text());
  else console.log('Telegram notification sent');
}

(async () => {
  console.log(`Checking: "${config.productBadge}"`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const responses = [];
  page.on('response', res => {
    const url = res.url();
    if (url.includes('/api/')) {
      responses.push({ url, status: res.status() });
    }
  });

  try {
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('[data-slot="badge"]', { timeout: 45000 });

    console.log('API endpoints found:');
    responses.forEach(r => console.log(`  ${r.status} ${r.url}`));

    let apiBase = null;
    for (const r of responses) {
      if (r.status === 200 && (r.url.includes('/products') || r.url.includes('/shop'))) {
        apiBase = r.url;
        break;
      }
    }

    await page.screenshot({ path: 'debug_initial.png' });

    const clicked = await page.evaluate((badgeText) => {
      const spans = document.querySelectorAll('span');
      for (const span of spans) {
        if (span.textContent.trim() === badgeText) {
          const card = span.closest('[class*="group"]') || span.closest('[class*="cursor"]');
          if (card) {
            card.scrollIntoView({ block: 'center' });
            const rect = card.getBoundingClientRect();
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            });
            card.dispatchEvent(clickEvent);
            return 'dispatched click on card';
          }
          return 'card not found';
        }
      }
      return 'badge not found';
    }, config.productBadge);

    console.log('Click result:', clicked);
    await page.waitForTimeout(4000);

    await page.screenshot({ path: 'debug_after_click.png' });

    const modalCheck = await page.evaluate(() => {
      const fixed = document.querySelectorAll('.fixed');
      const result = { fixedCount: fixed.length, details: [] };
      for (const el of fixed) {
        const rect = el.getBoundingClientRect();
        result.details.push({
          classes: el.className.substring(0, 100),
          visible: rect.width > 0 && rect.height > 0,
          opacity: window.getComputedStyle(el).opacity,
          zIndex: window.getComputedStyle(el).zIndex,
          hasH2: !!el.querySelector('h2'),
          h2Text: el.querySelector('h2')?.textContent?.substring(0, 80),
        });
      }
      return result;
    });

    console.log('Fixed overlays after click:', JSON.stringify(modalCheck, null, 2));

    const fullSearch = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.textContent.includes('Disponibilidad')) {
          return {
            tag: el.tagName,
            classes: el.className.substring(0, 200),
            parentClasses: el.parentElement?.className?.substring(0, 200),
            grandparentClasses: el.parentElement?.parentElement?.className?.substring(0, 200),
            fullText: el.textContent.trim().substring(0, 300),
            outerHTML: el.parentElement?.parentElement?.outerHTML?.substring(0, 500),
          };
        }
      }
      return null;
    });

    if (fullSearch) {
      console.log('Found disponibilidad:', JSON.stringify(fullSearch, null, 2));

      const statusText = fullSearch.fullText.replace('Disponibilidad', '').trim();
      const isAvailable = !statusText.toLowerCase().includes('agotado');

      if (isAvailable) {
        const productName = await page.evaluate(() => {
          const h2 = document.querySelector('.fixed h2, [role="dialog"] h2, [aria-label*="producto"] h2');
          return h2 ? h2.textContent.trim() : '';
        });

        const message = [
          `🟢 <b>${productName || 'Producto disponible'}</b>`,
          '',
          `📦 <b>Disponibilidad:</b> ${statusText}`,
          '',
          `<a href="${config.url}">${config.url}</a>`,
          `🕐 ${new Date().toLocaleString('es-CU', { timeZone: 'America/Havana' })}`,
        ].join('\n');

        await sendTelegram(message);
      } else {
        console.log('Out of stock.');
      }
    } else {
      console.log('Disponibilidad not found anywhere in DOM');
      fs.writeFileSync('debug_body.html', await page.evaluate(() => document.body.innerHTML.substring(0, 100000)));
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
