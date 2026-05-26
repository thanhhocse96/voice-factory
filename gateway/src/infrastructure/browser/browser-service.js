export class BrowserService {
  constructor({ adapter }) {
    this.adapter = adapter;
  }

  async healthcheck() {
    if (!this.adapter) {
      return {
        status: 'unavailable',
        degraded: true,
        error: 'browser adapter not configured'
      };
    }

    try {
      return await this.adapter.healthcheck();
    } catch (error) {
      return {
        status: 'unavailable',
        degraded: true,
        error: error.message
      };
    }
  }
}
