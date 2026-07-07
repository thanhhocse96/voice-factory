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

  // Proxy for full connect (see adapter for TODO + playwright flag)
  async connect() {
    if (!this.adapter || typeof this.adapter.connect !== 'function') {
      throw new Error('adapter does not support connect');
    }
    return this.adapter.connect();
  }

  async withPage(fn) {
    if (!this.adapter || typeof this.adapter.withPage !== 'function') {
      throw new Error('adapter does not support withPage');
    }
    return this.adapter.withPage(fn);
  }
}
