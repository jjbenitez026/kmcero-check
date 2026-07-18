const { chromium } = require('playwright');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
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

    const { searchUrl, h3Text } = await page.evaluate((searchTerm) => {
      const lower = searchTerm.toLowerCase();
      const cards = document.querySelectorAll('[class*="group"]');
      for (const card of cards) {
        const h3 = card.querySelector('h3');
        if (h3 && h3.textContent.trim().toLowerCase().includes(lower)) {
          const link = card.closest('a');
          return {
            searchUrl: link ? link.href : window.location.origin + '/shop?search=' + encodeURIComponent(h3.textContent.trim()),
            h3Text: h3.textContent.trim(),
          };
        }
      }
      return null;
    }, config.productSearch);

    if (!searchUrl) {
      const available = await page.evaluate(() => {
        const cards = document.querySelectorAll('[class*="group"]');
        const items = [];
        for (const card of cards) {
          const badge = card.querySelector('[data-slot="badge"]');
          const h3 = card.querySelector('h3');
          items.push({
            badge: badge ? badge.textContent.trim() : '',
            title: h3 ? h3.textContent.trim() : '',
          });
        }
        return items.filter(i => i.badge || i.title);
      });
      console.log('Product not found. Available:', JSON.stringify(available, null, 2));
      await browser.close();
      return;
    }

    console.log('Searching:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return !t.includes('Cargando...');
    }, { timeout: 30000 });
    console.log('Search page loaded, URL:', page.url());

    await page.screenshot({ path: 'debug_search.png', fullPage: true }).catch(() => {});
    console.log('Screenshot saved');

    const searchInfo = await page.evaluate(() => {
      const els = document.querySelectorAll('*');
      for (const el of els) {
        if (el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' &&
            el.textContent.includes('Disponibilidad') &&
            !el.textContent.includes('Cargando')) {
          return { found: true, text: el.textContent.trim().substring(0, 300), tag: el.tagName };
        }
      }
      const body = document.body.innerText;
      return { found: false, bodyPreview: body.substring(0, 800) };
    });
    console.log('Before click:', JSON.stringify(searchInfo));

    const clicked = await page.evaluate((searchTerm) => {
      const lower = searchTerm.toLowerCase();
      const cards = document.querySelectorAll('[class*="group"]');
      for (const card of cards) {
        const h3 = card.querySelector('h3');
        if (h3 && h3.textContent.trim().toLowerCase().includes(lower)) {
          card.scrollIntoView({ block: 'center' });
          card.click();
          return { method: 'card', h3: h3.textContent.trim() };
        }
      }
      return null;
    }, config.productSearch);

    console.log('Click result:', JSON.stringify(clicked));

    if (!clicked) {
      console.log('Could not find product card on search page');
      await browser.close();
      return;
    }

    await page.waitForTimeout(5000);

    const afterUrl = page.url();
    console.log('URL after click:', afterUrl);
    if (afterUrl !== searchUrl) {
      await page.waitForFunction(() => {
        const t = document.body.innerText || '';
        return !t.includes('Cargando...');
      }, { timeout: 30000 });
      console.log('Navigated to product page');
    }

    await page.screenshot({ path: 'debug_after.png', fullPage: true }).catch(() => {});

    const result = await page.evaluate(() => {
      const allText = document.body.innerText;

      const fixedEls = document.querySelectorAll('.fixed');
      if (fixedEls.length > 0) {
        for (const el of fixedEls) {
          const text = el.textContent;
          if (text.includes('Disponibilidad')) {
            const match = text.match(/Disponibilidad\s*\n?\s*([^\n]+)/);
            if (match) {
              const status = match[1].trim();
              return { method: 'modal', status, isAgotado: status.toLowerCase().includes('agotado') };
            }
          }
        }
      }

      const spanMatch = allText.match(/Disponibilidad\s*\n?\s*([^\n]+)/);
      if (spanMatch) {
        const status = spanMatch[1].trim();
        return { method: 'regex', status, isAgotado: status.toLowerCase().includes('agotado') };
      }

      return { method: 'none', status: '', isAgotado: true, text: allText.substring(0, 1000) };
    });

    console.log('Result:', JSON.stringify(result));

    if (result.status && !result.isAgotado) {
      const lines = [
        `🟢 <b>${h3Text || config.productSearch}</b>`,
        '',
        `📦 <b>Disponibilidad:</b> ${result.status}`,
        '',
        `<a href="${config.url}">${config.url}</a>`,
        `🕐 ${new Date().toLocaleString('es-CU', { timeZone: 'America/Havana' })}`,
      ];
      await sendTelegram(lines.join('\n'));
    } else {
      console.log('Out of stock or not found.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
