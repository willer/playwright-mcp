/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Context } from '../../context';
import type * as playwright from 'playwright';

/**
 * PlaywrightComputer provides an interface for controlling a browser
 * through Playwright for AI-driven automation.
 */
export class PlaywrightComputer {
  private context: Context;
  private page: playwright.Page | null = null;
  
  constructor(context: Context) {
    this.context = context;
  }
  
  /**
   * Initializes the computer by creating a new page if one doesn't exist.
   */
  private async init(): Promise<playwright.Page> {
    if (!this.page) {
      this.page = await this.context.createPage();
    }
    return this.page;
  }
  
  /**
   * Takes a screenshot of the current page and returns it as a base64-encoded string.
   */
  async screenshot(): Promise<string> {
    const page = await this.init();
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 });
    return screenshot.toString('base64');
  }
  
  /**
   * Clicks at the specified coordinates on the page.
   */
  async click(x: number, y: number, button: string = 'left'): Promise<void> {
    const page = await this.init();
    await page.mouse.click(x, y, { button: button as 'left' | 'right' | 'middle' });
  }
  
  /**
   * Performs a double click at the specified coordinates.
   */
  async doubleClick(x: number, y: number): Promise<void> {
    const page = await this.init();
    await page.mouse.dblclick(x, y);
  }
  
  /**
   * Types the specified text into the page.
   */
  async type(text: string): Promise<void> {
    const page = await this.init();
    await page.keyboard.type(text);
  }
  
  /**
   * Presses the specified key.
   */
  async press(key: string): Promise<void> {
    const page = await this.init();
    await page.keyboard.press(key);
  }
  
  /**
   * Waits for the specified number of milliseconds.
   */
  async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Scrolls the page at the specified coordinates.
   */
  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    const page = await this.init();
    await page.mouse.move(x, y);
    await page.mouse.wheel(deltaX, deltaY);
  }
  
  /**
   * Moves the mouse to the specified coordinates.
   */
  async move(x: number, y: number): Promise<void> {
    const page = await this.init();
    await page.mouse.move(x, y);
  }
  
  /**
   * Performs a drag operation from start to end coordinates.
   */
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    const page = await this.init();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();
  }
  
  /**
   * Navigates to the specified URL.
   */
  async navigate(url: string): Promise<void> {
    const page = await this.init();
    await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
  }
  
  /**
   * Gets the current URL of the page.
   */
  async getCurrentUrl(): Promise<string> {
    const page = await this.init();
    return page.url();
  }
  
  /**
   * Closes the browser and cleans up resources.
   */
  async close(): Promise<void> {
    if (this.page) {
      // We don't actually close the page, as it's managed by the context
      this.page = null;
    }
  }
}