import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function inspectModalContent() {
  const url = 'https://www.linkedin.com/jobs/view/4458872726/';
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Look for all <a> tags, modals, hidden templates, or code tags
    const beforeClick = await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('[data-modal], .modal, .sign-up-modal, .contextual-sign-in-modal, section, div[id*="apply"], div[id*="modal"]')).map(m => ({
        id: m.id,
        className: m.className,
        html: m.outerHTML.slice(0, 400)
      }));

      // Search all elements in the entire document for any string matching safety/go or jobright or external URLs
      const fullHtml = document.documentElement.outerHTML;
      const safetyMatches = fullHtml.match(/https:\/\/[^"'\s<>]*safety\/go[^"'\s<>]*/g) || [];
      const applyMatches = fullHtml.match(/https:\/\/[^"'\s<>]*apply[^"'\s<>]*/g) || [];

      return {
        modals: modals.slice(0, 5),
        safetyMatches,
        applyMatches: applyMatches.slice(0, 10)
      };
    });

    console.log('Safety matches before click:', beforeClick.safetyMatches);
    console.log('Apply matches before click:', beforeClick.applyMatches);

    // Now let's try clicking the button with "Apply" text or #topbar-apply
    try {
      await page.click('#topbar-apply, button.sign-up-modal__outlet, button.apply-button');
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.log('Click error:', e);
    }

    const afterClick = await page.evaluate(() => {
      const allA = Array.from(document.querySelectorAll('a')).map(a => ({
        href: a.href,
        ariaLabel: a.getAttribute('aria-label'),
        text: a.textContent?.trim(),
        html: a.outerHTML.slice(0, 200)
      })).filter(a => (a.ariaLabel || '').includes('Apply') || a.href.includes('safety/go') || (a.text || '').includes('Apply') || (a.text || '').includes('Continue'));

      const fullHtml = document.documentElement.outerHTML;
      const safetyMatches = fullHtml.match(/https:\/\/[^"'\s<>]*safety\/go[^"'\s<>]*/g) || [];

      return { allA, safetyMatches };
    });

    console.log('\nAfter click all matching <a>:', JSON.stringify(afterClick.allA, null, 2));
    console.log('After click safety matches:', afterClick.safetyMatches);

  } finally {
    await browser.close();
  }
}

inspectModalContent().catch(console.error);
