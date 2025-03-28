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

import * as playwright from 'playwright';

export class Context {
  private _userDataDir: string;
  private _launchOptions: playwright.LaunchOptions | undefined;
  private _browser: playwright.Browser | undefined;
  private _page: playwright.Page | undefined;
  private _console: playwright.ConsoleMessage[] = [];
  private _createPagePromise: Promise<playwright.Page> | undefined;
  private _fileChooser: playwright.FileChooser | undefined;
  private _lastSnapshotFrames: playwright.FrameLocator[] = [];
  private _pages: Map<number, playwright.Page> = new Map();
  private _activePageIndex: number = 0;

  constructor(userDataDir: string, launchOptions?: playwright.LaunchOptions) {
    this._userDataDir = userDataDir;
    this._launchOptions = launchOptions;
  }

  async createPage(options?: { headless?: boolean }): Promise<playwright.Page> {
    if (this._createPagePromise)
      return this._createPagePromise;

    // If headless option is specified, override the launch options temporarily
    let originalHeadless: boolean | undefined;
    if (options?.headless !== undefined && this._launchOptions) {
      originalHeadless = this._launchOptions.headless;
      this._launchOptions.headless = options.headless;
    }

    this._createPagePromise = (async () => {
      const { browser, page } = await this._createPage();
      this._setupPageEventListeners(page);

      // Store as the first page
      this._pages.clear();
      this._pages.set(0, page);
      this._activePageIndex = 0;

      this._page = page;
      this._browser = browser;
      return page;
    })();

    // Restore original headless setting
    if (options?.headless !== undefined && this._launchOptions && originalHeadless !== undefined)
      this._launchOptions.headless = originalHeadless;


    return this._createPagePromise;
  }

  private _setupPageEventListeners(page: playwright.Page): void {
    page.on('console', event => this._console.push(event));
    page.on('framenavigated', frame => {
      if (!frame.parentFrame())
        this._console.length = 0;
    });
    page.on('close', () => this._onPageClose(page));
    page.on('filechooser', chooser => this._fileChooser = chooser);
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(5000);
  }

  private _onPageClose(closedPage?: playwright.Page) {
    // If a specific page was closed, remove it from the page map
    if (closedPage) {
      // Find the index of the closed page
      let closedIndex = -1;
      for (const [index, page] of this._pages.entries()) {
        if (page === closedPage) {
          closedIndex = index;
          break;
        }
      }

      // If found, remove it
      if (closedIndex >= 0) {
        this._pages.delete(closedIndex);

        // If it was the active page, switch to another page if available
        if (this._activePageIndex === closedIndex) {
          if (this._pages.size > 0) {
            // Get the first available page and make it active
            const firstEntry = Array.from(this._pages.entries())[0];
            this._activePageIndex = firstEntry[0];
            this._page = firstEntry[1];
          } else {
            // No pages left, reset page-related state
            this._activePageIndex = 0;
            this._page = undefined;
            this._fileChooser = undefined;

            // Also reset browser if this was the last page
            const browser = this._browser;
            void browser?.close().catch(() => {});
            this._createPagePromise = undefined;
            this._browser = undefined;
          }
        }
      }
    } else {
      // This is the old behavior (closing everything)
      const browser = this._browser;
      const page = this._page;
      void page?.context()?.close().then(() => browser?.close()).catch(() => {});

      this._createPagePromise = undefined;
      this._browser = undefined;
      this._page = undefined;
      this._fileChooser = undefined;
      this._pages.clear();
      this._activePageIndex = 0;
    }

    this._console.length = 0;
  }

  existingPage(): playwright.Page {
    if (!this._page)
      throw new Error('Navigate to a location to create a page');
    return this._page;
  }

  // Tab management methods

  /**
   * Creates a new browser tab
   */
  async createNewTab(headless?: boolean): Promise<playwright.Page> {
    if (!this._browser) {
      // If we don't have a browser yet, create the first page
      return this.createPage({ headless });
    }

    // Get the browser context from the current page
    const context = this._page!.context();

    // Create a new page in the same context
    const newPage = await context.newPage();
    this._setupPageEventListeners(newPage);

    // Find the next available index
    let newIndex = 0;
    while (this._pages.has(newIndex))
      newIndex++;


    // Store the new page
    this._pages.set(newIndex, newPage);

    // Make it the active page
    this._activePageIndex = newIndex;
    this._page = newPage;

    return newPage;
  }

  /**
   * Gets information about all open tabs
   */
  async getAllTabs(): Promise<Array<{ index: number, title: string, url: string, isActive: boolean }>> {
    const result: Array<{ index: number, title: string, url: string, isActive: boolean }> = [];

    // If we don't have a browser yet, return an empty array
    if (!this._browser)
      return result;


    // Collect information about all pages
    for (const [index, page] of this._pages.entries()) {
      try {
        const title = await page.title();
        const url = page.url();
        const isActive = index === this._activePageIndex;

        result.push({ index, title, url, isActive });
      } catch (e) {
        // Skip pages that may have been closed
        continue;
      }
    }

    return result;
  }

  /**
   * Switches to a tab by its index
   */
  async switchToTab(index: number): Promise<{ title: string, url: string }> {
    const page = this._pages.get(index);

    if (!page)
      throw new Error(`Tab with index ${index} not found`);


    // Make it the active page
    this._activePageIndex = index;
    this._page = page;

    // Return information about the tab
    const title = await page.title();
    const url = page.url();

    return { title, url };
  }

  /**
   * Closes a tab by its index
   */
  async closeTabByIndex(index: number): Promise<void> {
    const page = this._pages.get(index);

    if (!page)
      throw new Error(`Tab with index ${index} not found`);


    // Close the page
    await page.close();
  }

  /**
   * Closes the current tab
   */
  async closeCurrentTab(): Promise<void> {
    if (!this._page)
      throw new Error('No active page to close');


    // Close the current page
    await this._page.close();
  }

  /**
   * Closes all tabs except the first one and switches to it
   */
  async closeAllTabsExceptFirst(): Promise<void> {
    if (this._pages.size <= 1)
      return; // Nothing to do


    // Get all page indices except the smallest one
    const indices = Array.from(this._pages.keys()).sort((a, b) => a - b);
    const firstIndex = indices[0];
    const otherIndices = indices.slice(1);

    // Close all other pages
    for (const index of otherIndices) {
      const page = this._pages.get(index);
      if (page)
        await page.close();

    }

    // Switch to the first page
    await this.switchToTab(firstIndex);
  }

  async console(): Promise<playwright.ConsoleMessage[]> {
    return this._console;
  }

  async clearConsole(): Promise<void> {
    this._console.length = 0;
  }

  async close() {
    if (!this._page)
      return;
    await this._page.close();
  }

  async submitFileChooser(paths: string[]) {
    if (!this._fileChooser)
      throw new Error('No file chooser visible');
    await this._fileChooser.setFiles(paths);
    this._fileChooser = undefined;
  }

  hasFileChooser() {
    return !!this._fileChooser;
  }

  clearFileChooser() {
    this._fileChooser = undefined;
  }

  private async _createPage(): Promise<{ browser?: playwright.Browser, page: playwright.Page }> {
    if (process.env.PLAYWRIGHT_WS_ENDPOINT) {
      const url = new URL(process.env.PLAYWRIGHT_WS_ENDPOINT);
      if (this._launchOptions)
        url.searchParams.set('launch-options', JSON.stringify(this._launchOptions));
      const browser = await playwright.chromium.connect(String(url));
      const page = await browser.newPage();
      return { browser, page };
    }

    const context = await playwright.chromium.launchPersistentContext(this._userDataDir, this._launchOptions);
    const [page] = context.pages();
    return { page };
  }

  async allFramesSnapshot() {
    const page = this.existingPage();
    const visibleFrames = await page.locator('iframe').filter({ visible: true }).all();
    this._lastSnapshotFrames = visibleFrames.map(frame => frame.contentFrame());

    const snapshots = await Promise.all([
      page.locator('html').ariaSnapshot({ ref: true }),
      ...this._lastSnapshotFrames.map(async (frame, index) => {
        const snapshot = await frame.locator('html').ariaSnapshot({ ref: true });
        const args = [];
        const src = await frame.owner().getAttribute('src');
        if (src)
          args.push(`src=${src}`);
        const name = await frame.owner().getAttribute('name');
        if (name)
          args.push(`name=${name}`);
        return `\n# iframe ${args.join(' ')}\n` + snapshot.replaceAll('[ref=', `[ref=f${index}`);
      })
    ]);

    return snapshots.join('\n');
  }

  refLocator(ref: string): playwright.Locator {
    const page = this.existingPage();
    let frame: playwright.Frame | playwright.FrameLocator = page.mainFrame();
    const match = ref.match(/^f(\d+)(.*)/);
    if (match) {
      const frameIndex = parseInt(match[1], 10);
      if (!this._lastSnapshotFrames[frameIndex])
        throw new Error(`Frame does not exist. Provide ref from the most current snapshot.`);
      frame = this._lastSnapshotFrames[frameIndex];
      ref = match[2];
    }

    return frame.locator(`aria-ref=${ref}`);
  }
}
