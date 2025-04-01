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
import { normalizeUrl } from '../utils';

/**
 * PlaywrightComputer provides an interface for controlling a browser
 * through Playwright for AI-driven automation.
 *
 * This class uses the page from the context, ensuring it shares the
 * same browser session as the browser_* tools.
 */
export class PlaywrightComputer {
  private context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  /**
   * Gets the existing page from the context.
   * This must return the same page as used by browser_* functions.
   */
  async getPage(): Promise<playwright.Page> {
    // Always use the existing page - if there's no existing page,
    // something is wrong with the session setup
    return this.context.existingPage();
  }

  /**
   * Takes a screenshot of the current page and returns it as a base64-encoded string.
   */
  async screenshot(): Promise<string> {
    const page = await this.getPage();
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 });
    return screenshot.toString('base64');
  }

  /**
   * Clicks at the specified coordinates on the page.
   */
  async click(x: number, y: number, button: string = 'left'): Promise<void> {
    const page = await this.getPage();
    await page.mouse.click(x, y, { button: button as 'left' | 'right' | 'middle' });
  }

  /**
   * Performs a double click at the specified coordinates.
   */
  async doubleClick(x: number, y: number): Promise<void> {
    const page = await this.getPage();
    await page.mouse.dblclick(x, y);
  }

  /**
   * Types the specified text into the page.
   */
  async type(text: string): Promise<void> {
    const page = await this.getPage();
    await page.keyboard.type(text);
  }

  /**
   * Presses the specified key.
   */
  async press(key: string): Promise<void> {
    const page = await this.getPage();
    
    // Map CUA key names to Playwright key names
    const keyMap: Record<string, string> = {
      'BACKSPACE': 'Backspace',
      'CTRL': 'Control',
      'COMMAND': 'Meta',
      'CMD': 'Meta',
      'ALT': 'Alt',
      'SHIFT': 'Shift',
      'ENTER': 'Enter',
      'TAB': 'Tab',
      'ESCAPE': 'Escape',
      'ESC': 'Escape',
      'ARROWUP': 'ArrowUp',
      'ARROWDOWN': 'ArrowDown',
      'ARROWLEFT': 'ArrowLeft',
      'ARROWRIGHT': 'ArrowRight',
      'DELETE': 'Delete',
      'END': 'End',
      'HOME': 'Home',
      'INSERT': 'Insert',
      'PAGEDOWN': 'PageDown',
      'PAGEUP': 'PageUp',
      'CAPSLOCK': 'CapsLock',
      'SPACE': ' ',
      'SUPER': 'Meta'
    };
    
    // Normalize the key name (convert to uppercase for case-insensitive matching)
    const normalizedKey = key.toUpperCase();
    const mappedKey = keyMap[normalizedKey] || key;
    
    console.error(`Pressing key: "${key}" (mapped to "${mappedKey}")`);
    await page.keyboard.press(mappedKey);
  }

  /**
   * Waits for the specified number of milliseconds.
   * If no time is specified, defaults to 1000ms (1 second).
   */
  async wait(ms: number = 1000): Promise<void> {
    // Cap wait time at 5 seconds to prevent excessive waiting
    const waitTime = Math.min(ms || 1000, 5000);
    console.error(`Waiting for ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  /**
   * Scrolls the page at the specified coordinates.
   */
  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    const page = await this.getPage();
    await page.mouse.move(x, y);
    await page.mouse.wheel(deltaX, deltaY);
  }

  /**
   * Moves the mouse to the specified coordinates.
   */
  async move(x: number, y: number): Promise<void> {
    const page = await this.getPage();
    await page.mouse.move(x, y);
  }

  /**
   * Performs a drag operation from start to end coordinates.
   */
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    const page = await this.getPage();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();
  }

  /**
   * Navigates to the specified URL.
   */
  async navigate(url: string): Promise<void> {
    const page = await this.getPage();
    const normalizedUrl = normalizeUrl(url);
    await page.goto(normalizedUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
  }

  /**
   * Gets the current URL of the page.
   */
  async getCurrentUrl(): Promise<string> {
    const page = await this.getPage();
    return page.url();
  }

  /**
   * No-op close function since we're not managing the page lifecycle anymore.
   * The context will handle closing the page when appropriate.
   */
  async close(): Promise<void> {
    // No-op, as the page is managed by the context
  }

  /**
   * Gets the dimensions of the page viewport.
   * Required for CUA implementation.
   */
  getDimensions(): { width: number; height: number } {
    return { width: 1024, height: 768 }; // Default dimensions
  }
}
