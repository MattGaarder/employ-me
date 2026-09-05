import puppeteer from 'puppeteer-extra';
import type { Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../utils/logger';

puppeteer.use(StealthPlugin());

const MIN_LINKEDIN_DELAY_MS = Number(process.env.MIN_LINKEDIN_DELAY_MS) || 10000;
const MAX_LINKEDIN_DELAY_MS = Number(process.env.MAX_LINKEDIN_DELAY_MS) || 20000;

export interface JobSearchFilters {
  keywords?: string;
  location?: string;
  dateSincePosted?: string;
  page?: number;
}

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  link: string;
  listDate: string;
}

export interface JobDetails {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  link: string;
  applicationUrl?: string | null;
  datePosted?: string | null;
}

export class ScraperService {
  private static constructSearchUrl(filters: JobSearchFilters): string {
    const baseUrl = 'https://www.linkedin.com/jobs/search';
    const params = new URLSearchParams();
    if (filters.keywords) params.append('keywords', filters.keywords);
    if (filters.location) params.append('location', filters.location);
    if (filters.dateSincePosted) {
      const timeMap: Record<string, string> = {
        'past_24h': 'r86400',
        'past_week': 'r604800',
        'past_month': 'r2592000'
      };
      const tpr = timeMap[filters.dateSincePosted] || '';
      if (tpr) params.append('f_TPR', tpr);
    }
    params.append('position', '1');
    params.append('pageNum', '0');

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const start = (page - 1) * 25;

    if (start > 0) {
      params.append('start', start.toString());
    }

    return `${baseUrl}?${params.toString()}`;
  }

  private static isCircuitOpen = false;
  private static circuitBreakerReason: string | null = null;
  private static lastOperationTime = 0;

  static isCircuitBreakerOpen(): boolean {
    return this.isCircuitOpen;
  }

  static getCircuitBreakerReason(): string | null {
    return this.circuitBreakerReason;
  }

  private static checkCircuitBreaker(): void {
    if (this.isCircuitOpen) {
      const msg = `Circuit breaker is OPEN: ${this.circuitBreakerReason || 'LinkedIn restriction detected'}`;
      logger.warn(`[linkedin] Refusing operation — ${msg}`);
      throw new Error(msg);
    }
  }

  private static tripCircuitBreaker(reason: string): void {
    this.isCircuitOpen = true;
    this.circuitBreakerReason = reason;
    logger.error(`[linkedin] Circuit breaker opened`);
    logger.error(`[linkedin] Reason: ${reason}`);
  }

  private static async pace(): Promise<void> {
    if (this.lastOperationTime > 0) {
      const delay = Math.floor(
        Math.random() * (MAX_LINKEDIN_DELAY_MS - MIN_LINKEDIN_DELAY_MS + 1) + MIN_LINKEDIN_DELAY_MS
      );
      logger.info(`[linkedin] Waiting ${delay}ms before next LinkedIn operation`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    this.lastOperationTime = Date.now();
  }

  private static async detectRestrictionSignal(page: Page): Promise<string | null> {
    try {
      const url = page.url().toLowerCase();
      const title = (await page.title()).toLowerCase();

      if (url.includes('/authwall') || url.includes('linkedin.com/authwall')) {
        return 'authentication wall detected';
      }
      if (
        url.includes('/checkpoint') ||
        url.includes('/challenge') ||
        title.includes('security verification') ||
        title.includes('quick security check')
      ) {
        return 'security checkpoint/challenge detected';
      }
      if (
        url.includes('/login') ||
        url.includes('/uas/login') ||
        url.includes('linkedin.com/signup') ||
        title.includes('sign in') ||
        title.includes('log in')
      ) {
        return 'login redirect detected';
      }

      const pageRestriction = await page.evaluate(() => {
        const text = document.body?.innerText?.toLowerCase() || '';
        if (text.includes('unusual activity')) {
          return 'unusual activity detected';
        }
        if (text.includes('please verify you are a human') || text.includes('security check')) {
          return 'CAPTCHA / human verification challenge detected';
        }
        return null;
      });

      if (pageRestriction) {
        return pageRestriction;
      }
    } catch {
      // Ignore evaluation error if page closed or transitioning
    }

    return null;
  }

  static async searchJobs(filters: JobSearchFilters): Promise<JobListing[]> {
    this.checkCircuitBreaker();
    await this.pace();

    const searchUrl = this.constructSearchUrl(filters);
    logger.info(`Scraping URL: ${searchUrl}`);

    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

      const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (response && response.status() === 429) {
        this.tripCircuitBreaker('HTTP 429 Too Many Requests');
        throw new Error('LinkedIn returned HTTP 429 Too Many Requests');
      }

      const restriction = await this.detectRestrictionSignal(page);
      if (restriction) {
        this.tripCircuitBreaker(restriction);
        throw new Error(`LinkedIn restriction detected: ${restriction}`);
      }

      let matchedListSelector = 'none';

      try {
        const listSelector = await page.waitForSelector('ul.jobs-search__results-list, .jobs-search-results__list',{ timeout: 10000 });

        if (listSelector) {
          matchedListSelector = await page.evaluate(
            (el) =>
              `${el?.tagName.toLowerCase()}.${el?.className
                .split(' ')
                .join('.')}`,
            listSelector
          );
        }
      } catch {
        logger.warn('Initial wait for job list timed out, attempting fallback or checking if page is empty');
      }

      logger.info(`[scraper-debug] Matched job list container: ${matchedListSelector}`);

      await page.evaluate(() => { window.scrollBy(0, document.body.scrollHeight); });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const { jobs, debugSamples } = await page.evaluate(() => {
        const jobElements = document.querySelectorAll('ul.jobs-search__results-list li, .jobs-search-results__list li.jobs-search-results__list-item');

        const debugSamples: any[] = [];

        const jobs = Array.from(jobElements).map((element, index) => {
            const titleEl = element.querySelector('.base-search-card__title, .job-card-list__title');
            const companyEl = element.querySelector('.base-search-card__subtitle, .job-card-container__company-name');
            const locationEl = element.querySelector('.job-search-card__location, .job-card-container__metadata-item');
            const linkEl = element.querySelector('.base-card__full-link, a.job-card-list__title');
            const dateEl = element.querySelector('time, .job-search-card__listdate');

            let link = linkEl ? (linkEl as HTMLAnchorElement).href : '';
            let id = '';

            if (link) {
              const match = link.match(/-(\d+)\?/);
              if (match && match[1]) {
                id = match[1];
              } else {
                const viewMatch = link.match(/view\/(\d+)\//);
                if (viewMatch && viewMatch[1]) {
                  id = viewMatch[1];
                }
              }
            }

            const listDate = dateEl?.textContent?.replace(/\s+/g, ' ').trim() || dateEl?.getAttribute('datetime') || '';

            if (index < 2) {
              debugSamples.push({
                index,
                matchedTitleClass: titleEl?.className || 'none',
                matchedDateClass: dateEl?.className || 'none',
                extractedDate: listDate,
                title: titleEl?.textContent?.trim() || '',
                sampleHtml: element.outerHTML.slice(0, 180).replace(/\s+/g, ' ')
              });
            }

            return {
              id,
              title: titleEl?.textContent?.trim() || '',
              company: companyEl?.textContent?.trim() || '',
              location: locationEl?.textContent?.trim() || '',
              link,
              listDate
            };
          }).filter((j) => j.title !== '');

        return {
          jobs,
          debugSamples
        };
      });

      if (debugSamples.length > 0) {
        logger.info(`[scraper-debug] First search card sample: titleSelector="${debugSamples[0].matchedTitleClass}", dateSelector="${debugSamples[0].matchedDateClass}", date="${debugSamples[0].extractedDate}"`);
      }
      return jobs;
    } catch (error: any) {
      logger.error(`Error during scraping: ${error.message}`);
      throw new Error('Failed to scrape jobs');
    } finally {
      this.lastOperationTime = Date.now();
      await browser.close();
    }
  }

  /**
   * Connects to a manually-launched, authenticated Chrome instance and extracts
   * the external application URL from a LinkedIn job page.
   *
   * Uses puppeteer.connect() / browser.disconnect() so the Chrome window is
   * never closed — the caller is responsible for keeping Chrome open.
   *
   * Returns the external destination URL, or null if not found.
   */
  private static async extractApplicationUrlAuthenticated(link: string): Promise<string | null> {
    logger.info(`[auth-apply-url] Connecting to authenticated Chrome for job: ${link}`);

    let browser: Awaited<ReturnType<typeof puppeteer.connect>> | null = null;
    let page: Page | null = null;

    try {
      browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
      });

      logger.info(`[auth-apply-url] Connected: ${await browser.version()}`);

      page = await browser.newPage();
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });

      logger.info(`[auth-apply-url] Page loaded: ${page.url()}`);

      // Brief wait for the Apply button to render
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const result = await page.evaluate(() => {
        const applyLink =
          document.querySelector<HTMLAnchorElement>('a[aria-label="Apply on company website"]') ||
          document.querySelector<HTMLAnchorElement>('a[aria-label*="Apply on company website"]') ||
          document.querySelector<HTMLAnchorElement>('a[href*="/safety/go/"]') ||
          document.querySelector<HTMLAnchorElement>('a[href*="safety/go"]') ||
          document.querySelector<HTMLAnchorElement>('a[data-tracking-control-name*="apply-link-offsite"]');

        if (!applyLink?.href) {
          return { applicationUrl: null as string | null, rawHref: null as string | null };
        }

        const rawHref = applyLink.href;

        try {
          const url = new URL(rawHref);
          if (url.hostname === 'www.linkedin.com' && url.pathname.startsWith('/safety/go/')) {
            const destination = url.searchParams.get('url');
            return {
              applicationUrl: destination ? decodeURIComponent(destination) : null,
              rawHref,
            };
          }
          if (
            !rawHref.includes('linkedin.com/signup') &&
            !rawHref.includes('linkedin.com/login') &&
            !rawHref.includes('linkedin.com/jobs/view')
          ) {
            return { applicationUrl: rawHref, rawHref };
          }
        } catch {
          // invalid URL
        }

        return { applicationUrl: null, rawHref };
      });

      logger.info(`[auth-apply-url] Raw href: ${result.rawHref}`);
      logger.info(`[auth-apply-url] Extracted applicationUrl: ${result.applicationUrl}`);

      return result.applicationUrl;
    } catch (error: any) {
      logger.warn(`[auth-apply-url] Could not extract authenticated application URL: ${error.message}`);
      return null;
    } finally {
      // Close only the tab we opened; do NOT close the browser
      try { await page?.close(); } catch { /* ignore */ }
      if (browser) {
        browser.disconnect();
      }
    }
  }

  static async getJobDetails(link: string): Promise<JobDetails> {
    this.checkCircuitBreaker();
    await this.pace();

    let id = '';
    const idMatch = link.match(/view\/(\d+)/) || link.match(/-(\d+)\?/);
    if (idMatch && idMatch[1]) {
      id = idMatch[1];
    }

    logger.info(`[job-details] ========================================`);
    logger.info(`[job-details] Starting job details fetch`);
    logger.info(`[job-details] Job ID: ${id}`);
    logger.info(`[job-details] LinkedIn URL: ${link}`);

    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });

      logger.info(`[job-details] Page loaded`);
      logger.info(`[job-details] Final browser URL: ${page.url()}`);
      logger.info(`[job-details] Page title: ${await page.title()}`);

      const descriptionSelectors = [
        '.description__text',
        '.jobs-description__content',
        '.jobs-description-content__text',
        '.show-more-less-html__markup'
      ];

      let foundSelector: string | null = null;
      for (const selector of descriptionSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 8000 });
          foundSelector = selector;
          logger.info(`[job-details] Found description using selector: ${selector}`);
          break;
        } catch {
          logger.info(`[job-details] Description selector not found: ${selector}`);
        }
      }

      if (!foundSelector) {
        logger.warn(`[job-details] Could not find description with any known selector`);
      }

      await page.evaluate(() => {
        window.scrollBy(0, 600);
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const details = await page.evaluate(
        (descSel: string | null) => {
          const titleEl =
            document.querySelector<HTMLElement>('.top-card-layout__title') ||
            document.querySelector<HTMLElement>('.job-details-jobs-unified-top-card__job-title h1') ||
            document.querySelector<HTMLElement>('h1.t-24');

          const companyEl =
            document.querySelector<HTMLElement>('.topcard__org-name-link') ||
            document.querySelector<HTMLElement>('.topcard__flavor--black-link') ||
            document.querySelector<HTMLElement>('.job-details-jobs-unified-top-card__company-name a') ||
            document.querySelector<HTMLElement>('.job-details-jobs-unified-top-card__company-name');

          const locationEl =
            document.querySelector<HTMLElement>('.topcard__flavor--bullet') ||
            document.querySelector<HTMLElement>('.job-details-jobs-unified-top-card__bullet') ||
            document.querySelector<HTMLElement>('.jobs-unified-top-card__bullet');

          const dateEl =
            document.querySelector<HTMLElement>('.posted-time-ago__text') ||
            document.querySelector<HTMLElement>('.topcard__flavor--metadata') ||
            document.querySelector<HTMLElement>('time.job-search-card__listdate') ||
            document.querySelector<HTMLElement>('time');

          const datePosted = dateEl?.textContent?.replace(/\s+/g, ' ').trim() || null;

          const candidateSelectors = [
            'a[aria-label="Apply on company website"]',
            'a[aria-label*="Apply on company website"]',
            'a[href*="/safety/go/"]',
            'a[href*="safety/go"]',
            'a[data-tracking-control-name*="apply-link-offsite"]'
          ];

          const selectorResults = candidateSelectors.map((selector) => {
            const el = document.querySelector<HTMLAnchorElement>(selector);
            if (!el) {
              return { selector, found: false };
            }
            return {
              selector,
              found: true,
              href: el.href || null,
              rawHref: el.getAttribute('href'),
              text: el.innerText?.trim() || '',
              ariaLabel: el.getAttribute('aria-label'),
              trackingControlName: el.getAttribute('data-tracking-control-name'),
              className: el.className
            };
          });

          const relevantLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
            .map((el) => ({
              href: el.href || '',
              rawHref: el.getAttribute('href'),
              text: el.innerText?.trim() || '',
              ariaLabel: el.getAttribute('aria-label'),
              trackingControlName: el.getAttribute('data-tracking-control-name'),
              className: el.className
            }))
            .filter((link) => {
              const combined = [link.href, link.rawHref, link.text, link.ariaLabel, link.trackingControlName]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
              return (
                combined.includes('apply') ||
                combined.includes('safety/go') ||
                combined.includes('offsite') ||
                combined.includes('external')
              );
            });

          const externalLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
            .map((el) => ({
              href: el.href,
              text: el.innerText?.trim() || '',
              ariaLabel: el.getAttribute('aria-label'),
              trackingControlName: el.getAttribute('data-tracking-control-name')
            }))
            .filter((link) => {
              try {
                const url = new URL(link.href);
                return url.hostname && !url.hostname.includes('linkedin.com');
              } catch {
                return false;
              }
            });

          const applyLinkEl =
            document.querySelector<HTMLAnchorElement>('a[aria-label="Apply on company website"]') ||
            document.querySelector<HTMLAnchorElement>('a[aria-label*="Apply on company website"]') ||
            document.querySelector<HTMLAnchorElement>('a[href*="/safety/go/"]') ||
            document.querySelector<HTMLAnchorElement>('a[href*="safety/go"]') ||
            document.querySelector<HTMLAnchorElement>('a[data-tracking-control-name*="apply-link-offsite"]');

          let applicationUrl: string | null = null;
          let applySelectorUsed = 'none';
          let rawApplicationHref: string | null = null;
          let applicationUrlExtractionMethod = 'none';

          if (applyLinkEl && applyLinkEl.href) {
            applySelectorUsed =
              applyLinkEl.tagName +
              (applyLinkEl.getAttribute('aria-label')
                ? `[aria-label="${applyLinkEl.getAttribute('aria-label')}"]`
                : '');
            rawApplicationHref = applyLinkEl.href;

            if (rawApplicationHref.includes('linkedin.com/safety/go')) {
              try {
                const urlObj = new URL(rawApplicationHref);
                const targetUrl = urlObj.searchParams.get('url');
                if (targetUrl) {
                  applicationUrl = decodeURIComponent(targetUrl);
                  applicationUrlExtractionMethod = 'linkedin-safety-go';
                }
              } catch {
                applicationUrl = null;
              }
            } else if (
              !rawApplicationHref.includes('linkedin.com/signup') &&
              !rawApplicationHref.includes('linkedin.com/login') &&
              !rawApplicationHref.includes('linkedin.com/jobs/view')
            ) {
              applicationUrl = rawApplicationHref;
              applicationUrlExtractionMethod = 'direct-external-href';
            }
          }

          let descriptionEl: HTMLElement | null = null;
          if (descSel) {
            descriptionEl = document.querySelector<HTMLElement>(descSel);
          }
          if (!descriptionEl) {
            descriptionEl =
              document.querySelector<HTMLElement>('.description__text') ||
              document.querySelector<HTMLElement>('.jobs-description__content') ||
              document.querySelector<HTMLElement>('.jobs-description-content__text') ||
              document.querySelector<HTMLElement>('.show-more-less-html__markup') ||
              document.querySelector<HTMLElement>('[class*="description"]');
          }

          return {
            title: titleEl?.innerText?.trim() || '',
            company: companyEl?.innerText?.trim() || '',
            location: locationEl?.innerText?.trim() || '',
            description: descriptionEl?.innerText?.trim() || '',
            datePosted,
            applicationUrl,
            applySelectorUsed,
            rawApplicationHref,
            applicationUrlExtractionMethod,
            selectorResults,
            relevantLinks,
            externalLinks
          };
        },
        foundSelector
      );

      logger.info(`[application-url] Job ${id} (${details.company} — ${details.title})`);
      logger.info(`[application-url] LinkedIn URL: ${link}`);
      logger.info(`[application-url] Current page URL: ${page.url()}`);
      logger.info(`[application-url] Selected selector: ${details.applySelectorUsed}`);
      logger.info(`[application-url] Raw application href: ${details.rawApplicationHref}`);
      logger.info(`[application-url] Extraction method: ${details.applicationUrlExtractionMethod}`);
      logger.info(`[application-url] FINAL applicationUrl: ${details.applicationUrl}`);
      logger.info(`[application-url] Candidate selector results:\n${JSON.stringify(details.selectorResults, null, 2)}`);

      if (details.relevantLinks.length > 0) {
        logger.info(`[application-url] Relevant application-looking links:\n${JSON.stringify(details.relevantLinks, null, 2)}`);
      } else {
        logger.info(`[application-url] No application-looking links found`);
      }

      if (details.externalLinks.length > 0) {
        logger.info(`[application-url] External links found:\n${JSON.stringify(details.externalLinks, null, 2)}`);
      } else {
        logger.info(`[application-url] No external links found`);
      }

      logger.info(`[scraper-debug] Job ${id}: datePosted="${details.datePosted}", applicationUrl="${details.applicationUrl}" (via ${details.applySelectorUsed})`);

      // If the unauthenticated scrape didn't find an application URL, try the
      // authenticated Chrome session as a fallback.
      let applicationUrl = details.applicationUrl;
      if (!applicationUrl) {
        logger.info(`[application-url] Falling back to authenticated Chrome for application URL`);
        applicationUrl = await this.extractApplicationUrlAuthenticated(link);
      }

      if (!applicationUrl) {
        logger.warn(`[application-url] ⚠️ NO APPLICATION URL FOUND for job ${id}`);
      }
      if (!details.description) {
        logger.warn(`Description was empty for job ${id}. The page structure may have changed or LinkedIn is blocking the request.`);
      }

      logger.info(`[job-details] Finished job details fetch for ${id}`);

      return {
        id,
        link,
        title: details.title,
        company: details.company,
        location: details.location,
        description: details.description,
        datePosted: details.datePosted,
        applicationUrl
      };
    } catch (error: any) {
      logger.error(`Error fetching job details for ${link}: ${error.message}`);
      throw new Error(`Failed to fetch job details: ${error.message}`);
    } finally {
      this.lastOperationTime = Date.now();
      await browser.close();
    }
  }
}