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

  private static async connectToAuthenticatedChrome() {
    logger.info('[browser] Connecting to existing authenticated Chrome...');

    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
    });

    logger.info(`[browser] Connected: ${await browser.version()}`);

    return browser;
  }

  private static async extractApplicationUrl(page: Page) {
    return await page.evaluate(() => {
      const applyLink =
        document.querySelector<HTMLAnchorElement>(
          'a[aria-label="Apply on company website"]'
        ) ||
        document.querySelector<HTMLAnchorElement>(
          'a[aria-label*="Apply on company website"]'
        ) ||
        document.querySelector<HTMLAnchorElement>(
          'a[href*="/safety/go/"]'
        ) ||
        document.querySelector<HTMLAnchorElement>(
          'a[href*="safety/go"]'
        ) ||
        document.querySelector<HTMLAnchorElement>(
          'a[data-tracking-control-name*="apply-link-offsite"]'
        );

      if (!applyLink?.href) {
        return {
          applicationUrl: null,
          rawApplicationHref: null,
          extractionMethod: 'not-found',
        };
      }

      const rawHref = applyLink.href;

      try {
        const url = new URL(rawHref);

        if (
          url.hostname === 'www.linkedin.com' &&
          url.pathname.startsWith('/safety/go/')
        ) {
          const destination = url.searchParams.get('url');

          return {
            applicationUrl: destination,
            rawApplicationHref: rawHref,
            extractionMethod: destination
              ? 'linkedin-safety-go'
              : 'linkedin-safety-go-missing-url',
          };
        }

        if (
          !rawHref.includes('linkedin.com/signup') &&
          !rawHref.includes('linkedin.com/login') &&
          !rawHref.includes('linkedin.com/jobs/view')
        ) {
          return {
            applicationUrl: rawHref,
            rawApplicationHref: rawHref,
            extractionMethod: 'direct-external-href',
          };
        }

        return {
          applicationUrl: null,
          rawApplicationHref: rawHref,
          extractionMethod: 'linkedin-internal-url',
        };
      } catch {
        return {
          applicationUrl: null,
          rawApplicationHref: rawHref,
          extractionMethod: 'invalid-url',
        };
      }
    });
  }

  static async getJobDetails(link: string): Promise<JobDetails> {
    this.checkCircuitBreaker();
    await this.pace();

    let id = '';
    const idMatch = link.match(/view\/(\d+)/) || link.match(/-(\d+)\?/);

    if (idMatch && idMatch[1]) {
      id = idMatch[1];
    }

    logger.info(`[linkedin] Starting job fetch: ${id}`);
    logger.info(`[job-details] ========================================`);
    logger.info(`[job-details] Starting job details fetch`);
    logger.info(`[job-details] Job ID: ${id}`);
    logger.info(`[job-details] LinkedIn URL: ${link}`);

    const browser = await this.connectToAuthenticatedChrome();

    try {
      const pages = await browser.pages();

      const page =
        pages.find((p) => p.url().includes('linkedin.com')) ||
        pages[0] ||
        (await browser.newPage());

      await page.setViewport({ width: 1920, height: 1080 });

      const response = await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });

      logger.info(`[job-details] Page loaded`);
      logger.info(`[job-details] Final browser URL: ${page.url()}`);
      logger.info(`[job-details] Page title: ${await page.title()}`);

      if (response && response.status() === 429) {
        this.tripCircuitBreaker('HTTP 429 Too Many Requests');
        throw new Error('LinkedIn returned HTTP 429 Too Many Requests');
      }

      const restriction = await this.detectRestrictionSignal(page);
      if (restriction) {
        this.tripCircuitBreaker(restriction);
        throw new Error(`LinkedIn restriction detected: ${restriction}`);
      }

      // Allow initial page hydration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Scroll progressively down the page to trigger IntersectionObserver / lazy loading of the job description
      let foundDescriptionSection = false;
      for (let scrollStep = 0; scrollStep < 5; scrollStep++) {
        foundDescriptionSection = await page.evaluate(() => {
          const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, [role="heading"]'));
          const hasAbout = headings.some((h) => {
            const t = h.textContent?.trim().toLowerCase() || '';
            return t === 'about the job' || t.startsWith('about the job') || t === 'about the role' || t === 'job description';
          });
          const hasLegacy = Boolean(
            document.querySelector(
              '.description__text, .jobs-description__content, .jobs-description-content__text, .show-more-less-html__markup, #job-details'
            )
          );
          if (hasAbout || hasLegacy) {
            return true;
          }
          window.scrollBy(0, 500);
          return false;
        });

        if (foundDescriptionSection) {
          logger.info('[job-details] Job description section detected');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!foundDescriptionSection) {
        logger.warn('[job-details] Timed out waiting for job description section, proceeding with best-effort extraction');
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      const details = await page.evaluate(() => {
        // Document title fallback
        const docTitle = document.title || '';
        const docParts = docTitle.split(' | ').map((s) => s.trim());
        const docJobTitle = docParts[0] || '';
        const docCompany = docParts.length > 2 ? docParts[1] : (docParts.length === 2 ? docParts[1] : '');

        // Top card and company link
        const compLink = document.querySelector<HTMLAnchorElement>('a[href*="/company/"]');
        const topCard = compLink?.parentElement?.parentElement?.parentElement;
        const topCardParagraphs = Array.from(topCard?.querySelectorAll('p') || [])
          .map((p) => p.innerText.trim())
          .filter(Boolean);

        // Title extraction
        let title = document.querySelector<HTMLElement>(
          '.top-card-layout__title, .job-details-jobs-unified-top-card__job-title h1, h1.t-24, h1'
        )?.innerText?.trim();

        if (!title && topCardParagraphs.length >= 2) {
          title = topCardParagraphs[1];
        }
        if (!title) {
          title = docJobTitle;
        }

        // Company extraction
        let company =
          (compLink as HTMLElement)?.innerText?.trim() ||
          document.querySelector<HTMLElement>(
            '.topcard__org-name-link, .topcard__flavor--black-link, .job-details-jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name'
          )?.innerText?.trim();

        if (!company) {
          company = docCompany;
        }

        // Location and Date Posted extraction
        let location = document.querySelector<HTMLElement>(
          '.topcard__flavor--bullet, .job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet'
        )?.innerText?.trim();

        let datePosted =
          document.querySelector<HTMLElement>(
            '.posted-time-ago__text, .topcard__flavor--metadata, time.job-search-card__listdate, time'
          )?.textContent?.replace(/\s+/g, ' ').trim() || null;

        if ((!location || !datePosted) && topCardParagraphs.length >= 3) {
          const metaLine = topCardParagraphs[2];
          const metaParts = metaLine.split('·').map((s) => s.trim());
          if (!location && metaParts[0]) location = metaParts[0];
          if (!datePosted && metaParts[1]) datePosted = metaParts[1];
        }

        // Description extraction via semantic "About the job" heading
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, [role="heading"]'));
        const aboutHeading = allHeadings.find((h) => {
          const t = h.textContent?.trim().toLowerCase() || '';
          return t === 'about the job' || t.startsWith('about the job') || t === 'about the role' || t === 'job description';
        });

        let description = '';

        if (aboutHeading) {
          const headingParent = aboutHeading.parentElement;
          const container = headingParent?.parentElement;

          // Expand truncated text if "... more" / "see more" button exists
          if (container) {
            const moreBtn = Array.from(container.querySelectorAll('button, [role="button"], span')).find((b) => {
              const t = b.textContent?.trim().toLowerCase() || '';
              return t.includes('more') || t.includes('see more');
            });
            if (moreBtn) {
              (moreBtn as HTMLElement).click();
            }
          }

          const contentSibling = headingParent?.nextElementSibling as HTMLElement | null;
          description = contentSibling?.innerText?.trim() || '';

          if (!description && container) {
            const clone = container.cloneNode(true) as HTMLElement;
            const h = clone.querySelector('h1, h2, h3, h4, h5, [role="heading"]');
            if (h) h.remove();
            description = clone.innerText?.trim() || '';
          }
        }

        // Legacy selector fallback
        if (!description) {
          const fallbackEl = document.querySelector<HTMLElement>(
            '.description__text, .jobs-description__content, .jobs-description-content__text, .show-more-less-html__markup, #job-details, [class*="description"]'
          );
          description = fallbackEl?.innerText?.trim() || '';
        }

        // Broader container fallback if still empty
        if (!description) {
          const allContainers = Array.from(document.querySelectorAll('section, article, div'));
          const foundSection = allContainers.find((el) => {
            const t = el.textContent?.toLowerCase() || '';
            return t.includes('about the job') && (el as HTMLElement).innerText?.length > 200 && el.children.length < 20;
          });
          if (foundSection) {
            const clone = foundSection.cloneNode(true) as HTMLElement;
            const h = clone.querySelector('h1, h2, h3, h4, h5, [role="heading"]');
            if (h) h.remove();
            description = clone.innerText?.trim() || '';
          }
        }

        // Strip residual trailing button text
        description = description.replace(/\s*…\s*more\s*$/i, '').replace(/\s*see\s+more\s*$/i, '').trim();

        return {
          title: title || '',
          company: company || '',
          location: location || '',
          description,
          datePosted,
        };
      });

      const applicationResult = await this.extractApplicationUrl(page);

      logger.info(`[application-url] Job ${id} (${details.company} — ${details.title})`);
      logger.info(`[application-url] Raw LinkedIn href: ${applicationResult.rawApplicationHref}`);
      logger.info(`[application-url] Extraction method: ${applicationResult.extractionMethod}`);
      logger.info(`[application-url] FINAL applicationUrl: ${applicationResult.applicationUrl}`);

      logger.info(`[scraper-debug] Job ${id}: datePosted="${details.datePosted}", applicationUrl="${applicationResult.applicationUrl}"`);
      if (!applicationResult.applicationUrl) {
        logger.warn(`[application-url] ⚠️ NO APPLICATION URL FOUND for job ${id}`);
      }
      if (!details.description) {
        logger.warn(`Description was empty for job ${id}. The page structure may have changed or LinkedIn is blocking the request.`);
      }
      logger.info(`[job-details] Finished job details fetch for ${id}`);
      logger.info(`[linkedin] Job fetch completed successfully`);

      return {
        id,
        link,
        title: details.title,
        company: details.company,
        location: details.location,
        description: details.description,
        datePosted: details.datePosted,
        applicationUrl: applicationResult.applicationUrl
      };
    } catch (error: any) {
      logger.error(`Error fetching job details for ${link}: ${error.message}`);
      throw new Error(`Failed to fetch job details: ${error.message}`);
    } finally {
      this.lastOperationTime = Date.now();
      if (browser) {
        browser.disconnect();
      }
    }
  }
}