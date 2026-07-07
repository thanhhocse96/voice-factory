export class PlaywrightCdpAdapter {
  constructor({ cdpUrl, timeoutMs = 800, fetchImpl = fetch }) {
    this.cdpUrl = cdpUrl;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async healthcheck() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.cdpUrl}/json/version`, {
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          status: 'unavailable',
          degraded: true,
          url: this.cdpUrl,
          error: `CDP version endpoint returned ${response.status}`
        };
      }

      const data = await response.json();
      return {
        status: 'available',
        degraded: false,
        url: this.cdpUrl,
        browser: data.Browser || data.browser || 'unknown',
        protocolVersion: data['Protocol-Version'] || data.protocolVersion || 'unknown'
      };
    } catch (error) {
      return {
        status: 'unavailable',
        degraded: true,
        url: this.cdpUrl,
        error: error.name === 'AbortError' ? 'CDP healthcheck timed out' : error.message
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // === For "kết nối vào" (full page automation for Vbee preview) - Phase C ===
  // M2 is health only (per BROWSER_SERVICE.md and design). Full connect below.
  // Requires: npm install playwright (confirm/ask human before per AGENTS.md + module TODO)
  // Then use: const { chromium } = await import('playwright');
  // this.browser = await chromium.connectOverCDP(this.cdpUrl);
  // const context = this.browser.contexts()[0] || await this.browser.newContext();
  // const page = context.pages()[0] || await context.newPage();

  async connect() {
    if (this.browser) return this.browser;
    // Dynamic import to avoid hard dep until installed
    const { chromium } = await import('playwright').catch(() => {
      throw new Error('playwright not installed. Run: npm install (in project root). See M2_004/M2_005 for plan and playwright flag.');
    });
    this.browser = await chromium.connectOverCDP(this.cdpUrl);
    return this.browser;
  }

  async withPage(fn) {
    const browser = await this.connect();
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    try {
      return await fn(page);
    } finally {
      // Do not close page/context here for reuse in preview flows; caller manages if needed
    }
  }
}
