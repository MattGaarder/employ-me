import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';

puppeteer.use(StealthPlugin());

const LINKEDIN_URL =
  'https://www.linkedin.com/jobs/view/4458091863/';

async function main() {
  console.log('Connecting to existing authenticated LinkedIn Chrome...');

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
  });

  try {
    console.log('Connected!');
    console.log('Browser:', await browser.version());

    const pages = await browser.pages();

    console.log('\nExisting pages:', pages.length);

    for (const [index, p] of pages.entries()) {
      console.log(`Page ${index}: ${p.url()}`);
    }

    /*
     * Prefer an existing LinkedIn tab.
     *
     * If the manually launched Chrome currently has the LinkedIn
     * feed open, we'll reuse that tab.
     */
    const page =
      pages.find((p) => p.url().includes('linkedin.com')) ||
      pages[0] ||
      await browser.newPage();

    console.log('\nUsing page:', page.url());

    console.log('\n==============================');
    console.log('BROWSER INFORMATION');
    console.log('==============================');

    console.log(
      'User agent:',
      await page.evaluate(() => navigator.userAgent)
    );

    /*
     * IMPORTANT:
     * Don't print cookie values. We only care whether the
     * authenticated cookie exists.
     */
    const cookiesBeforeNavigation = await page.cookies(
      'https://www.linkedin.com'
    );

    console.log('\nLinkedIn cookies BEFORE navigation:');

    console.log(
      cookiesBeforeNavigation.map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
      }))
    );

    console.log(
      '\nAuthenticated cookie present:',
      cookiesBeforeNavigation.some(
        (cookie) => cookie.name === 'li_at'
      )
    );

    /*
     * Navigate directly to the job page.
     */
    console.log(
      `\nNavigating to:\n"${LINKEDIN_URL}"`
    );

    await page.goto(LINKEDIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    /*
     * Give LinkedIn a moment to finish rendering.
     */
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log('\n==============================');
    console.log('PAGE INFORMATION');
    console.log('==============================');

    console.log('Final URL:', page.url());
    console.log('Title:', await page.title());

    console.log(
      'Body:',
      (
        await page.evaluate(
          () => document.body?.innerText || ''
        )
      ).slice(0, 3000)
    );

    const cookiesAfterNavigation = await page.cookies(
      'https://www.linkedin.com'
    );

    console.log(
      '\nAuthenticated cookie after navigation:',
      cookiesAfterNavigation.some(
        (cookie) => cookie.name === 'li_at'
      )
    );

    /*
     * Inspect the actual LinkedIn page.
     */
    const diagnostics = await page.evaluate(() => {
      const cleanText = (
        value: string | null | undefined
      ) =>
        value?.replace(/\s+/g, ' ').trim() || '';

      /*
       * ==============================
       * ALL LINKS
       * ==============================
       */

      const allLinks = Array.from(
        document.querySelectorAll('a')
      );

      const links = allLinks.map((el) => ({
        tagName: el.tagName,
        text: cleanText(el.textContent),
        href: el.href || null,
        rawHref: el.getAttribute('href'),
        ariaLabel: el.getAttribute('aria-label'),
        trackingControlName: el.getAttribute(
          'data-tracking-control-name'
        ),
        className:
          typeof el.className === 'string'
            ? el.className
            : '',
      }));

      /*
       * ==============================
       * ALL BUTTONS
       * ==============================
       */

      const allButtons = Array.from(
        document.querySelectorAll('button')
      );

      const buttons = allButtons.map((el) => ({
        tagName: el.tagName,
        text: cleanText(el.textContent),
        ariaLabel: el.getAttribute('aria-label'),
        role: el.getAttribute('role'),
        trackingControlName: el.getAttribute(
          'data-tracking-control-name'
        ),
        className:
          typeof el.className === 'string'
            ? el.className
            : '',
      }));

      /*
       * ==============================
       * APPLICATION LINKS
       * ==============================
       *
       * Look for anything containing:
       * - apply
       * - offsite
       * - external
       * - safety/go
       */

      const applicationLinks = links.filter((link) => {
        const combined = [
          link.text,
          link.href,
          link.rawHref,
          link.ariaLabel,
          link.trackingControlName,
          link.className,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return (
          combined.includes('apply') ||
          combined.includes('offsite') ||
          combined.includes('external') ||
          combined.includes('safety/go')
        );
      });

      /*
       * ==============================
       * APPLICATION ANCESTORS
       * ==============================
       *
       * Find elements containing "apply"
       * and inspect their surrounding DOM.
       */

      const applicationAncestors = Array.from(
        document.querySelectorAll('*')
      )
        .filter((el) => {
          const htmlEl = el as HTMLElement;

          const combined = [
            el.tagName,
            el.id,
            typeof htmlEl.className === 'string'
              ? htmlEl.className
              : '',
            htmlEl.innerText,
            el.getAttribute('aria-label'),
            el.getAttribute(
              'data-tracking-control-name'
            ),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return combined.includes('apply');
        })
        .slice(0, 10)
        .map((el) => {
          const ancestors = [];

          let current: Element | null = el;

          for (
            let i = 0;
            i < 5 && current;
            i++
          ) {
            ancestors.push({
              tagName: current.tagName,
              id: current.id || null,
              className:
                typeof (
                  current as HTMLElement
                ).className === 'string'
                  ? (
                      current as HTMLElement
                    ).className
                  : null,
              outerHTML:
                current.outerHTML.slice(0, 5000),
            });

            current = current.parentElement;
          }

          return {
            element: {
              tagName: el.tagName,
              text:
                (
                  el as HTMLElement
                ).innerText?.trim() || '',
            },
            ancestors,
          };
        });

      /*
       * ==============================
       * APPLICATION BUTTONS
       * ==============================
       */

      const applicationButtons = buttons.filter(
        (button) => {
          const combined = [
            button.text,
            button.ariaLabel,
            button.role,
            button.trackingControlName,
            button.className,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return (
            combined.includes('apply') ||
            combined.includes('offsite') ||
            combined.includes('external')
          );
        }
      );

      /*
       * ==============================
       * EXTERNAL LINKS
       * ==============================
       *
       * Anything whose hostname isn't LinkedIn.
       */

      const externalLinks = links.filter((link) => {
        if (!link.href) {
          return false;
        }

        try {
          const url = new URL(link.href);

          return (
            url.hostname &&
            !url.hostname.includes('linkedin.com')
          );
        } catch {
          return false;
        }
      });

      /*
       * ==============================
       * APPLY ELEMENTS
       * ==============================
       *
       * Find elements containing the word "apply"
       * without relying on LinkedIn class names.
       */

      const applyElements = Array.from(
        document.querySelectorAll('*')
      )
        .filter((el) => {
          const text = cleanText(
            el.textContent
          ).toLowerCase();

          const ariaLabel =
            el
              .getAttribute('aria-label')
              ?.toLowerCase() || '';

          return (
            text === 'apply' ||
            ariaLabel.includes('apply')
          );
        })
        .slice(0, 20)
        .map((el) => ({
          tagName: el.tagName,
          text: cleanText(el.textContent),
          id: el.id || null,
          className: el.className,
          ariaLabel:
            el.getAttribute('aria-label'),
          role: el.getAttribute('role'),
          href:
            el instanceof HTMLAnchorElement
              ? el.href
              : null,
          rawHref: el.getAttribute('href'),
          trackingControlName:
            el.getAttribute(
              'data-tracking-control-name'
            ),
          outerHTML:
            el.outerHTML.slice(0, 5000),
        }));

      /*
       * ==============================
       * RETURN DIAGNOSTICS
       * ==============================
       */

      return {
        pageText: cleanText(
          document.body?.innerText
        ),

        applicationLinks,
        applicationButtons,
        externalLinks,
        applyElements,

        linkCount: links.length,
        buttonCount: buttons.length,
      };
    });

    /*
     * ==============================
     * OUTPUT
     * ==============================
     */

    console.log(
      '\n=============================='
    );
    console.log('APPLICATION LINKS');
    console.log(
      '=============================='
    );

    console.log(
      JSON.stringify(
        diagnostics.applicationLinks,
        null,
        2
      )
    );

    console.log(
      '\n=============================='
    );
    console.log('APPLICATION BUTTONS');
    console.log(
      '=============================='
    );

    console.log(
      JSON.stringify(
        diagnostics.applicationButtons,
        null,
        2
      )
    );

    console.log(
      '\n=============================='
    );
    console.log('EXTERNAL LINKS');
    console.log(
      '=============================='
    );

    console.log(
      JSON.stringify(
        diagnostics.externalLinks,
        null,
        2
      )
    );

    console.log(
      '\n=============================='
    );
    console.log('APPLY ELEMENTS');
    console.log(
      '=============================='
    );

    console.log(
      JSON.stringify(
        diagnostics.applyElements,
        null,
        2
      )
    );

    /*
     * Save diagnostic output.
     */

    const outputDir = path.resolve(
      process.cwd(),
      'logs/linkedin-auth-test'
    );

    await fs.mkdir(outputDir, {
      recursive: true,
    });

    await fs.writeFile(
      path.join(
        outputDir,
        'diagnostics.json'
      ),
      JSON.stringify(
        {
          requestedUrl: LINKEDIN_URL,
          finalUrl: page.url(),
          title: await page.title(),
          diagnostics,
        },
        null,
        2
      ),
      'utf8'
    );

    console.log(
      `\nDiagnostics saved to:\n${outputDir}/diagnostics.json`
    );

    console.log(
      '\nChrome will remain open.'
    );

    console.log(
      'Press Ctrl+C when finished.'
    );

    /*
     * Keep the Node process alive.
     */
    await new Promise(() => {});
  } catch (error) {
    console.error(
      'Diagnostic failed:',
      error
    );

    /*
     * Disconnect Puppeteer without closing
     * the Chrome instance.
     */
    browser.disconnect();
  }
}

main().catch(console.error);