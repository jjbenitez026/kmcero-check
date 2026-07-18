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
      console.log('No product found on main page');
      await browser.close();
      return;
    }

    console.log('Navigating to:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForFunction(() => {
      const t = document.body.innerText || '';
      return !t.includes('Cargando...');
    }, { timeout: 30000 });
    console.log('Search page loaded');

    const verBtn = page.getByText('Ver').first();
    if ((await verBtn.count()) > 0) {
      console.log('Clicking "Ver" button...');
      await verBtn.scrollIntoViewIfNeeded();
      await verBtn.click({ force: true });
      await page.waitForTimeout(5000);
    } else {
      console.log('No "Ver" button found, clicking product card...');
      const badge = page.locator('[data-slot="badge"]').filter({ hasText: config.productBadge }).first();
      if ((await badge.count()) > 0) {
        const card = badge.locator('xpath=ancestor::div[contains(@class, "group")]').first();
        await card.scrollIntoViewIfNeeded();
        await card.click({ force: true });
        await page.waitForTimeout(5000);
      }
    }

    await page.screenshot({ path: 'debug.png', fullPage: true });

    const info = await page.evaluate(() => {
      const allSpans = document.querySelectorAll('span');
      let disponibilidadText = '';

      for (const s of allSpans) {
        if (s.textContent.trim() === 'Disponibilidad') {
          const parent = s.parentElement;
          if (parent) {
            const nextSpan = parent.querySelector('span.text-sm.font-semibold');
            if (nextSpan) disponibilidadText = nextSpan.textContent.trim();
          }
        }
      }

      if (!disponibilidadText) {
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
          if (el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' &&
              el.textContent.includes('Disponibilidad') &&
              (el.textContent.includes('Agotado') || /\d+\s*u\./.test(el.textContent))) {
            const text = el.textContent;
            const agotado = text.toLowerCase().includes('agotado');
            const match = text.match(/(\d+\s*u\.)/);
            return {
              found: true,
              text: match ? match[1] : (agotado ? 'Agotado' : text.trim().substring(0, 200)),
              isAgotado: agotado,
              source: 'dom',
            };
          }
        }
        return { found: false, text: '', isAgotado: true };
      }

      return {
        found: true,
        text: disponibilidadText,
        isAgotado: disponibilidadText.toLowerCase().includes('agotado'),
        source: 'span',
      };
    });

    console.log('Disponibilidad:', JSON.stringify(info));

    if (info?.found && !info.isAgotado) {
      const msg = [
        `🟢 <b>${config.productBadge}</b>`,
        '',
        `📦 <b>Disponibilidad:</b> ${info.text}`,
        '',
        `<a href="${config.url}">${config.url}</a>`,
        `🕐 ${new Date().toLocaleString('es-CU', { timeZone: 'America/Havana' })}`,
      ].join('\n');
      await sendTelegram(msg);
    } else {
      console.log('Out of stock or not found.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await page.screenshot({ path: 'debug.png', fullPage: true }).catch(() => {});
    await browser.close();
  }
})();
