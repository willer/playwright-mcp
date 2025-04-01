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
  async click(x: number | string, y: number | string, button: string = 'left'): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    
    // Convert coordinates to numbers if they're strings
    const xCoord = typeof x === 'string' ? parseInt(x, 10) : x;
    const yCoord = typeof y === 'string' ? parseInt(y, 10) : y;
    
    // Check if conversions were successful
    if (isNaN(xCoord) || isNaN(yCoord)) {
      throw new Error(`Invalid coordinates: x=${x}, y=${y}`);
    }
    
    if (button === 'back') {
      await this.page.goBack();
    } else if (button === 'forward') {
      await this.page.goForward();
    } else {
      const buttonType = button === 'right' ? 'right' : 'left';
      await this.page.mouse.click(xCoord, yCoord, { button: buttonType as 'left' | 'right' | 'middle' });
    }
  }

  /**
   * Double-click at specific coordinates on the page
   */
  async doubleClick(x: number | string, y: number | string): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    
    // Convert coordinates to numbers if they're strings
    const xCoord = typeof x === 'string' ? parseInt(x, 10) : x;
    const yCoord = typeof y === 'string' ? parseInt(y, 10) : y;
    
    // Check if conversions were successful
    if (isNaN(xCoord) || isNaN(yCoord)) {
      throw new Error(`Invalid coordinates: x=${x}, y=${y}`);
    }
    
    await this.page.mouse.dblclick(xCoord, yCoord);
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
  async wait(ms: number | string): Promise<void> {
    // Convert ms to number if it's a string
    const milliseconds = typeof ms === 'string' ? parseInt(ms, 10) : ms;
    
    // Check if conversion was successful
    if (isNaN(milliseconds)) {
      throw new Error(`Invalid wait time: ${ms}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  /**
   * Scroll the page from a point by a delta amount
   */
  async scroll(x: number | string, y: number | string, deltaX: number | string, deltaY: number | string): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    
    // Convert coordinates to numbers if they're strings
    const xCoord = typeof x === 'string' ? parseInt(x, 10) : x;
    const yCoord = typeof y === 'string' ? parseInt(y, 10) : y;
    const dX = typeof deltaX === 'string' ? parseInt(deltaX, 10) : deltaX;
    const dY = typeof deltaY === 'string' ? parseInt(deltaY, 10) : deltaY;
    
    // Check if conversions were successful
    if (isNaN(xCoord) || isNaN(yCoord) || isNaN(dX) || isNaN(dY)) {
      throw new Error(`Invalid coordinates or delta: x=${x}, y=${y}, deltaX=${deltaX}, deltaY=${deltaY}`);
    }
    
    await this.page.mouse.move(xCoord, yCoord);
    await this.page.evaluate(`window.scrollBy(${dX}, ${dY})`);
  }

  /**
   * Move the mouse to specific coordinates
   */
  async move(x: number | string, y: number | string): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    
    // Convert coordinates to numbers if they're strings
    const xCoord = typeof x === 'string' ? parseInt(x, 10) : x;
    const yCoord = typeof y === 'string' ? parseInt(y, 10) : y;
    
    // Check if conversions were successful
    if (isNaN(xCoord) || isNaN(yCoord)) {
      throw new Error(`Invalid coordinates: x=${x}, y=${y}`);
    }
    
    await this.page.mouse.move(xCoord, yCoord);
  }

  /**
   * Drag from one point to another
   */
  async drag(startX: number | string, startY: number | string, endX: number | string, endY: number | string): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }
    
    // Convert coordinates to numbers if they're strings
    const sX = typeof startX === 'string' ? parseInt(startX, 10) : startX;
    const sY = typeof startY === 'string' ? parseInt(startY, 10) : startY;
    const eX = typeof endX === 'string' ? parseInt(endX, 10) : endX;
    const eY = typeof endY === 'string' ? parseInt(endY, 10) : endY;
    
    // Check if conversions were successful
    if (isNaN(sX) || isNaN(sY) || isNaN(eX) || isNaN(eY)) {
      throw new Error(`Invalid coordinates: startX=${startX}, startY=${startY}, endX=${endX}, endY=${endY}`);
    }
    
    await this.page.mouse.move(sX, sY);
    await this.page.mouse.down();
    await this.page.mouse.move(eX, eY);
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
   * Get the browser context
   */
  getBrowserContext(): BrowserContext | null {
    return this.context;
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