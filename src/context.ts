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

import { fork } from 'child_process';
import path from 'path';

import * as playwright from 'playwright';

export type ContextOptions = {
  browserName?: 'chromium' | 'firefox' | 'webkit';
  userDataDir: string;
  launchOptions?: playwright.LaunchOptions;
  cdpEndpoint?: string;
  remoteEndpoint?: string;
};

export class Context {
  private _options: ContextOptions;
  private _browser: playwright.Browser | undefined;
  private _page: playwright.Page | undefined;
  private _console: playwright.ConsoleMessage[] = [];
  private _createPagePromise: Promise<playwright.Page> | undefined;
  private _fileChooser: playwright.FileChooser | undefined;
  private _lastSnapshotFrames: playwright.FrameLocator[] = [];

  constructor(options: ContextOptions) {
    this._options = options;
  }

  async createPage(): Promise<playwright.Page> {
    if (this._createPagePromise)
      return this._createPagePromise;
    this._createPagePromise = (async () => {
      const { browser, page } = await this._createPage();
      page.on('console', event => this._console.push(event));
      page.on('framenavigated', frame => {
        if (!frame.parentFrame())
          this._console.length = 0;
      });
      page.on('close', () => this._onPageClose());
      page.on('filechooser', chooser => this._fileChooser = chooser);
      page.setDefaultNavigationTimeout(60000);
      page.setDefaultTimeout(5000);
      this._page = page;
      this._browser = browser;
      return page;
    })();
    return this._createPagePromise;
  }

  private _onPageClose() {
    const browser = this._browser;
    const page = this._page;
    void page?.context()?.close().then(() => browser?.close()).catch(() => {});

    this._createPagePromise = undefined;
    this._browser = undefined;
    this._page = undefined;
    this._fileChooser = undefined;
    this._console.length = 0;
  }

  async install(): Promise<string> {
    const channel = this._options.launchOptions?.channel ?? this._options.browserName ?? 'chrome';
    const cli = path.join(require.resolve('playwright/package.json'), '..', 'cli.js');
    const child = fork(cli, ['install', channel], {
      stdio: 'pipe',
    });
    const output: string[] = [];
    child.stdout?.on('data', data => output.push(data.toString()));
    child.stderr?.on('data', data => output.push(data.toString()));
    return new Promise((resolve, reject) => {
      child.on('close', code => {
        if (code === 0)
          resolve(channel);
        else
          reject(new Error(`Failed to install browser: ${output.join('')}`));
      });
    });
  }

  existingPage(): playwright.Page {
    if (!this._page)
      throw new Error('Navigate to a location to create a page');
    return this._page;
  }

  async console(): Promise<playwright.ConsoleMessage[]> {
    return this._console;
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
    if (this._options.remoteEndpoint) {
      const url = new URL(this._options.remoteEndpoint);
      if (this._options.browserName)
        url.searchParams.set('browser', this._options.browserName);
      if (this._options.launchOptions)
        url.searchParams.set('launch-options', JSON.stringify(this._options.launchOptions));
      const browser = await playwright[this._options.browserName ?? 'chromium'].connect(String(url));
      const page = await browser.newPage();
      return { browser, page };
    }

    if (this._options.cdpEndpoint) {
      const browser = await playwright.chromium.connectOverCDP(this._options.cdpEndpoint);
      const browserContext = browser.contexts()[0];
      let [page] = browserContext.pages();
      if (!page)
        page = await browserContext.newPage();
      return { browser, page };
    }

    const context = await this._launchPersistentContext();
    const [page] = context.pages();
    return { page };
  }

  private async _launchPersistentContext(): Promise<playwright.BrowserContext> {
    try {
      const browserType = this._options.browserName ? playwright[this._options.browserName] : playwright.chromium;

      // Set additional options for better reliability with persistent contexts
      const launchOptions = {
        ...this._options.launchOptions,
        args: [
          ...(this._options.launchOptions?.args || []),
          '--no-sandbox',
          // Completely disable background networking
          '--disable-background-networking',
          // Disable various background services
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          // Disable component updates to prevent background processes
          '--disable-component-update',
          // Disable various extensions and features that could cause conflicts
          '--disable-extensions',
          '--disable-features=TranslateUI',
          // Disable first-run dialogs, welcome pages, etc.
          '--no-first-run',
        ],
        handleSIGINT: true,  // Ensure browser process is properly cleaned up on SIGINT
        handleSIGTERM: true, // Ensure browser process is properly cleaned up on SIGTERM
        handleSIGHUP: true,  // Ensure browser process is properly cleaned up on SIGHUP
      };

      // Playwright automatically adds the --user-data-dir argument,
      // so we filter out any user-data-dir flags if they exist to prevent duplicates
      if (launchOptions.args) {
        launchOptions.args = launchOptions.args.filter(arg =>
          !arg.startsWith('--user-data-dir=') &&
          !arg.startsWith('--user-data-dir-name=')
        );
      }

      // Launch the browser with persistent context
      return await browserType.launchPersistentContext(this._options.userDataDir, launchOptions);
    } catch (error: any) {
      if (error.message.includes('Executable doesn\'t exist'))
        throw new Error(`Browser specified in your config is not installed. Either install it (likely) or change the config.`);
      if (error.message.includes('Target page, context or browser has been closed')) {
        console.error('Persistent context issue detected. This may be due to a stale browser process.');
        console.error('Error details:', error.message);
        throw new Error('Browser launch failed. Try removing the profile directory at: ' + this._options.userDataDir);
      }
      console.error('Failed to launch browser:', error);
      throw error;
    }
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
