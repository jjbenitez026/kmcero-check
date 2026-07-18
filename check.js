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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('[data-slot="badge"]', { timeout: 45000 });
    console.log('Page loaded, products rendered');

    const h3 = page.locator('h3').filter({ hasText: config.productBadge }).first();
    const h3Count = await h3.count();

    if (h3Count === 0) {
      console.log('Product not found by h3 text');
      await browser.close();
      return;
    }

    console.log('Product found, clicking h3...');
    await h3.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await h3.click({ force: true, timeout: 10000 });
    console.log('Clicked h3');

    await page.waitForTimeout(5000);

    await page.screenshot({ path: 'debug.png' });
    console.log('Screenshot saved');

    const html = await page.content();
    fs.writeFileSync('debug.html', html.substring(0, 100000));
    console.log('HTML saved');

    const disponibilidad = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent.includes('Disponibilidad')) {
          const parent = node.parentElement;
          if (!parent) continue;
          const container = parent.closest('[class]');
          if (!container) continue;

          const fullSection = container.closest('.flex') || container.parentElement?.closest('.flex') || container;
          const sectionHTML = fullSection ? fullSection.outerHTML : container.outerHTML;

          const allText = fullSection ? fullSection.textContent : container.textContent;
          const statusMatch = allText.match(/(\d+\s*u\.|Agotado)/i);
          const status = statusMatch ? statusMatch[1] : '';

          const isAgotado = allText.toLowerCase().includes('agotado');

          return {
            text: allText.trim().substring(0, 300),
            status,
            isAgotado,
            sectionHTML: sectionHTML.substring(0, 500),
          };
        }
      }
      return null;
    });

    if (disponibilidad) {
      console.log('Disponibilidad found:', disponibilidad.text);

      if (!disponibilidad.isAgotado) {
        const productName = await page.locator('h2').first().textContent().catch(() => '');
        const message = [
          `🟢 <b>${productName || config.productBadge}</b>`,
          '',
          `📦 <b>${disponibilidad.text}</b>`,
          '',
          `<a href="${config.url}">${config.url}</a>`,
          `🕐 ${new Date().toLocaleString('es-CU', { timeZone: 'America/Havana' })}`,
        ].join('\n');
        await sendTelegram(message);
      } else {
        console.log('Out of stock.');
      }
    } else {
      console.log('Disponibilidad text NOT FOUND anywhere on page');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
