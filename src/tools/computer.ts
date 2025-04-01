import { BrowserContext, Page } from 'playwright';
// Using Node.js Buffer for base64 operations

/**
 * PlaywrightComputer class that provides a bridge between the AI agent and the browser.
 * Implements actions specified in the CUA Interface specification.
 */
export class PlaywrightComputer {
  private context: BrowserContext;
  private page: Page | null;

  constructor(context: BrowserContext) {
    this.context = context;
    this.page = null;
  }

  /**
   * Initialize with an active page
   */
  async initialize(startUrl?: string): Promise<void> {
    // Use existing page or create a new one
    this.page = this.context.pages()[0] || await this.context.newPage();
    
    // Set up page events
    this.context.on('page', this.handleNewPage.bind(this));
    this.page.on('close', this.handlePageClose.bind(this));
    
    // Navigate to start URL if provided, otherwise go to a default page
    if (startUrl) {
      await this.navigate(startUrl);
    }
  }

  /**
   * Handle creation of a new page
   */
  private async handleNewPage(page: Page): Promise<void> {
    console.error('[DEBUG] New page created');
    this.page = page;
    page.on('close', this.handlePageClose.bind(this));
  }

  /**
   * Handle page closure
   */
  private async handlePageClose(page: Page): Promise<void> {
    console.error('[DEBUG] Page closed');
    if (this.page === page) {
      const pages = this.context.pages();
      if (pages.length > 0) {
        this.page = pages[pages.length - 1];
      } else {
        console.error('[WARN] All pages have been closed.');
        this.page = null;
      }
    }
  }

  /**
   * Take a screenshot of the current page
   * @returns Base64 encoded JPEG image
   */
  async screenshot(): Promise<string> {
    if (!this.page) {
      throw new Error('No active page');
    }
    const screenshotBuffer = await this.page.screenshot({ 
      type: 'jpeg',
      quality: 80,
      fullPage: false 
    });
    return Buffer.from(screenshotBuffer).toString('base64');
  }

  /**
   * Click at specific coordinates on the page
   */
  async click(x: number, y: number, button: string = 'left'): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    if (button === 'back') {
      await this.page.goBack();
    } else if (button === 'forward') {
      await this.page.goForward();
    } else {
      const buttonType = button === 'right' ? 'right' : 'left';
      await this.page.mouse.click(x, y, { button: buttonType as 'left' | 'right' | 'middle' });
    }
  }

  /**
   * Double-click at specific coordinates on the page
   */
  async doubleClick(x: number, y: number): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    await this.page.mouse.dblclick(x, y);
  }

  /**
   * Type text into the active element
   */
  async type(text: string): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    await this.page.keyboard.type(text);
  }

  /**
   * Press a key on the keyboard
   */
  async press(key: string): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    await this.page.keyboard.press(key);
  }

  /**
   * Wait for the specified number of milliseconds
   */
  async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Scroll the page from a point by a delta amount
   */
  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    await this.page.mouse.move(x, y);
    await this.page.evaluate(`window.scrollBy(${deltaX}, ${deltaY})`);
  }

  /**
   * Move the mouse to specific coordinates
   */
  async move(x: number, y: number): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    await this.page.mouse.move(x, y);
  }

  /**
   * Drag from one point to another
   */
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(endX, endY);
    await this.page.mouse.up();
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    
    try {
      // Check if the URL has a protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      await this.page.goto(url);
    } catch (error) {
      console.error(`Error navigating to ${url}:`, error);
      throw error;
    }
  }

  /**
   * Get the current URL
   */
  async getCurrentUrl(): Promise<string> {
    if (!this.page) {
      throw new Error('No active page');
    }
    return this.page.url();
  }

  /**
   * Get browser capabilities (viewport dimensions)
   */
  async getBrowserCapabilities(): Promise<{ width: number, height: number }> {
    if (!this.page) {
      throw new Error('No active page');
    }
    const viewport = this.page.viewportSize();
    if (!viewport) {
      return { width: 1024, height: 768 }; // Default values
    }
    return {
      width: viewport.width,
      height: viewport.height
    };
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
    }
  }
}