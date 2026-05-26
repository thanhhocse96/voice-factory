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
}
