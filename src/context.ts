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
import fs from 'fs';
import os from 'os';

import * as playwright from 'playwright';
import yaml from 'yaml';

import { waitForCompletion } from './tools/utils';
import { ToolResult } from './tools/tool';

// Define internal browser name type to include our custom browsers
type BrowserName = 'chromium' | 'firefox' | 'webkit' | 'brave' | 'msedge';

// But expose only what Playwright actually supports
export type ContextOptions = {
  browserName?: BrowserName;
  userDataDir: string;
  launchOptions?: playwright.LaunchOptions;
  cdpEndpoint?: string;
  remoteEndpoint?: string;
};

type PageOrFrameLocator = playwright.Page | playwright.FrameLocator;

type RunOptions = {
  captureSnapshot?: boolean;
  waitForCompletion?: boolean;
  status?: string;
  noClearFileChooser?: boolean;
};

export class Context {
  readonly options: ContextOptions;
  private _browser: playwright.Browser | undefined;
  private _browserContext: playwright.BrowserContext | undefined;
  private _tabs: Tab[] = [];
  private _currentTab: Tab | undefined;

  constructor(options: ContextOptions) {
    this.options = options;
  }

  tabs(): Tab[] {
    return this._tabs;
  }

  currentTab(): Tab {
    if (!this._currentTab)
      throw new Error('Navigate to a location to create a tab');
    return this._currentTab;
  }

  async newTab(): Promise<Tab> {
    const browserContext = await this._ensureBrowserContext();
    const page = await browserContext.newPage();
    this._currentTab = this._tabs.find(t => t.page === page)!;
    return this._currentTab;
  }

  async selectTab(index: number) {
    this._currentTab = this._tabs[index - 1];
    await this._currentTab.page.bringToFront();
  }

  async ensureTab(): Promise<Tab> {
    const context = await this._ensureBrowserContext();
    if (!this._currentTab)
      await context.newPage();
    return this._currentTab!;
  }

  async listTabs(): Promise<string> {
    if (!this._tabs.length)
      return 'No tabs open';
    const lines: string[] = ['Open tabs:'];
    for (let i = 0; i < this._tabs.length; i++) {
      const tab = this._tabs[i];
      const title = await tab.page.title();
      const url = tab.page.url();
      const current = tab === this._currentTab ? ' (current)' : '';
      lines.push(`- ${i + 1}:${current} [${title}] (${url})`);
    }
    return lines.join('\n');
  }

  async closeTab(index: number | undefined) {
    const tab = index === undefined ? this.currentTab() : this._tabs[index - 1];
    await tab.page.close();
    return await this.listTabs();
  }

  private _onPageCreated(page: playwright.Page) {
    const tab = new Tab(this, page, tab => this._onPageClosed(tab));
    this._tabs.push(tab);
    if (!this._currentTab)
      this._currentTab = tab;
  }

  private _onPageClosed(tab: Tab) {
    const index = this._tabs.indexOf(tab);
    if (index === -1)
      return;
    this._tabs.splice(index, 1);

    if (this._currentTab === tab)
      this._currentTab = this._tabs[Math.min(index, this._tabs.length - 1)];
    const browser = this._browser;
    if (this._browserContext && !this._tabs.length) {
      void this._browserContext.close().then(() => browser?.close()).catch(() => {});
      this._browser = undefined;
      this._browserContext = undefined;
    }
  }

  async close() {
    if (!this._browserContext)
      return;
    await this._browserContext.close();
  }

  private async _ensureBrowserContext() {
    if (!this._browserContext) {
      const context = await this._createBrowserContext();
      this._browser = context.browser;
      this._browserContext = context.browserContext;
      for (const page of this._browserContext.pages())
        this._onPageCreated(page);
      this._browserContext.on('page', page => this._onPageCreated(page));
    }
    return this._browserContext;
  }

  private async _createBrowserContext(): Promise<{ browser?: playwright.Browser, browserContext: playwright.BrowserContext }> {
    if (this.options.remoteEndpoint) {
      const url = new URL(this.options.remoteEndpoint);
      if (this.options.browserName)
        url.searchParams.set('browser', this.options.browserName);
      if (this.options.launchOptions)
        url.searchParams.set('launch-options', JSON.stringify(this.options.launchOptions));
      const browser = await playwright[this.options.browserName ?? 'chromium'].connect(String(url));
      const browserContext = await browser.newContext();
      return { browser, browserContext };
    }

    if (this.options.cdpEndpoint) {
      const browser = await playwright.chromium.connectOverCDP(this.options.cdpEndpoint);
      const browserContext = browser.contexts()[0];
      return { browser, browserContext };
    }

    const browserContext = await this._launchPersistentContext();
    return { browserContext };
  }

  private async _launchPersistentContext(): Promise<playwright.BrowserContext> {
    try {
      const browserType = this.options.browserName ? playwright[this.options.browserName] : playwright.chromium;
      return await browserType.launchPersistentContext(this.options.userDataDir, this.options.launchOptions);
    } catch (error: any) {
      if (error.message.includes('Executable doesn\'t exist'))
        throw new Error(`Browser specified in your config is not installed. Either install it (likely) or change the config.`);
      throw error;
    }
  }
}

class Tab {
  readonly context: Context;
  readonly page: playwright.Page;
  private _console: playwright.ConsoleMessage[] = [];
  private _fileChooser: playwright.FileChooser | undefined;
  private _snapshot: PageSnapshot | undefined;
  private _onPageClose: (tab: Tab) => void;

  constructor(context: Context, page: playwright.Page, onPageClose: (tab: Tab) => void) {
    this.context = context;
    this.page = page;
    this._onPageClose = onPageClose;
    page.on('console', event => this._console.push(event));
    page.on('framenavigated', frame => {
      if (!frame.parentFrame())
        this._console.length = 0;
    });
    page.on('close', () => this._onClose());
    page.on('filechooser', chooser => this._fileChooser = chooser);
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(5000);
  }

  private _onClose() {
    this._fileChooser = undefined;
    this._console.length = 0;
    this._onPageClose(this);
  }

  async install(): Promise<string> {
    let channel = this.context.options.launchOptions?.channel ?? this.context.options.browserName ?? 'chrome';
    
    // For Brave browser, we need to use chromium since Playwright doesn't support Brave directly
    if (channel === 'brave') {
      channel = 'chromium';
    }
    
    // msedge is directly supported by Playwright's installer
    
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

  async navigate(url: string) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    // Cap load event to 5 seconds, the page is operational at this point.
    await this.page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
  }

  async run(callback: (tab: Tab) => Promise<void>, options?: RunOptions): Promise<ToolResult> {
    try {
      if (!options?.noClearFileChooser)
        this._fileChooser = undefined;
      if (options?.waitForCompletion)
        await waitForCompletion(this.page, () => callback(this));
      else
        await callback(this);
    } finally {
      if (options?.captureSnapshot)
        this._snapshot = await PageSnapshot.create(this.page);
    }
    const tabList = this.context.tabs().length > 1 ? await this.context.listTabs() + '\n\nCurrent tab:' + '\n' : '';
    const snapshot = this._snapshot?.text({ status: options?.status, hasFileChooser: !!this._fileChooser }) ?? options?.status ?? '';
    return {
      content: [{
        type: 'text',
        text: tabList + snapshot,
      }],
    };
  }

  async runAndWait(callback: (tab: Tab) => Promise<void>, options?: RunOptions): Promise<ToolResult> {
    return await this.run(callback, {
      waitForCompletion: true,
      ...options,
    });
  }

  async runAndWaitWithSnapshot(callback: (tab: Tab) => Promise<void>, options?: RunOptions): Promise<ToolResult> {
    return await this.run(callback, {
      captureSnapshot: true,
      waitForCompletion: true,
      ...options,
    });
  }

  lastSnapshot(): PageSnapshot {
    if (!this._snapshot)
      throw new Error('No snapshot available');
    return this._snapshot;
  }

  async console(): Promise<playwright.ConsoleMessage[]> {
    return this._console;
  }

  async submitFileChooser(paths: string[]) {
    if (!this._fileChooser)
      throw new Error('No file chooser visible');
    await this._fileChooser.setFiles(paths);
    this._fileChooser = undefined;
  }
}

class PageSnapshot {
  private _frameLocators: PageOrFrameLocator[] = [];
  private _text!: string;

  constructor() {
  }

  static async create(page: playwright.Page): Promise<PageSnapshot> {
    const snapshot = new PageSnapshot();
    await snapshot._build(page);
    return snapshot;
  }

  text(options?: { status?: string, hasFileChooser?: boolean }): string {
    const results: string[] = [];
    if (options?.status) {
      results.push(options.status);
      results.push('');
    }
    if (options?.hasFileChooser) {
      results.push('- There is a file chooser visible that requires browser_file_upload to be called');
      results.push('');
    }
    results.push(this._text);
    return results.join('\n');
  }

  private async _build(page: playwright.Page) {
    const yamlDocument = await this._snapshotFrame(page);
    const lines = [];
    lines.push(
        `- Page URL: ${page.url()}`,
        `- Page Title: ${await page.title()}`
    );
    lines.push(
        `- Page Snapshot`,
        '```yaml',
        yamlDocument.toString().trim(),
        '```',
        ''
    );
    this._text = lines.join('\n');
  }

  private async _snapshotFrame(frame: playwright.Page | playwright.FrameLocator) {
    const frameIndex = this._frameLocators.push(frame) - 1;
    const snapshotString = await frame.locator('body').ariaSnapshot({ ref: true });
    const snapshot = yaml.parseDocument(snapshotString);

    const visit = async (node: any): Promise<unknown> => {
      if (yaml.isPair(node)) {
        await Promise.all([
          visit(node.key).then(k => node.key = k),
          visit(node.value).then(v => node.value = v)
        ]);
      } else if (yaml.isSeq(node) || yaml.isMap(node)) {
        node.items = await Promise.all(node.items.map(visit));
      } else if (yaml.isScalar(node)) {
        if (typeof node.value === 'string') {
          const value = node.value;
          if (frameIndex > 0)
            node.value = value.replace('[ref=', `[ref=f${frameIndex}`);
          if (value.startsWith('iframe ')) {
            const ref = value.match(/\[ref=(.*)\]/)?.[1];
            if (ref) {
              try {
                const childSnapshot = await this._snapshotFrame(frame.frameLocator(`aria-ref=${ref}`));
                return snapshot.createPair(node.value, childSnapshot);
              } catch (error) {
                return snapshot.createPair(node.value, '<could not take iframe snapshot>');
              }
            }
          }
        }
      }

      return node;
    };
    await visit(snapshot.contents);
    return snapshot;
  }
  
  async compactSnapshot() {
    const page = this.existingPage();
    
    // Find the most important interactive elements to include in compact mode
    const interactiveSelectors = [
      'a[href]',                // Links
      'button',                 // Buttons
      'input',                  // Input fields
      'select',                 // Dropdowns
      'textarea',               // Text areas
      '[role="button"]',        // ARIA buttons
      '[role="link"]',          // ARIA links
      '[role="tab"]',           // ARIA tabs
      '[role="menuitem"]',      // ARIA menu items
      '[role="checkbox"]',      // ARIA checkboxes
      '[role="radio"]'          // ARIA radio buttons
    ];
    
    // Create a combined selector that matches any interactive element
    const combinedSelector = interactiveSelectors.join(',');
    
    try {
      // Collect all visible interactive elements
      const interactiveElements = await page.locator(combinedSelector).filter({ visible: true }).all();
      const visibleFrames = await page.locator('iframe').filter({ visible: true }).all();
      this._lastSnapshotFrames = visibleFrames.map(frame => frame.contentFrame());
      
      // Take snapshots of just the interactive elements
      const mainSnapshot = await Promise.all(
        interactiveElements.map(async (element) => {
          try {
            // Get a snapshot of just this element
            const snapshot = await element.ariaSnapshot({ ref: true });
            return snapshot;
          } catch (e) {
            // Skip elements that can't be snapshot
            return '';
          }
        })
      );
      
      // Include iframe interactive elements too (simplified)
      const frameSnapshots = await Promise.all(
        this._lastSnapshotFrames.map(async (frame, index) => {
          try {
            // Only get interactive elements within frame
            const frameElements = await frame.locator(combinedSelector).filter({ visible: true }).all();
            if (frameElements.length === 0) return '';
            
            const snapshots = await Promise.all(
              frameElements.map(element => element.ariaSnapshot({ ref: true }))
            );
            
            const args = [];
            // Use locator attributes directly since owner() doesn't exist on Page | FrameLocator
            // This is a safer approach that works with both Page and FrameLocator types
            try {
              const frameElement = page.locator('iframe').nth(index);
              const src = await frameElement.getAttribute('src');
              if (src) args.push(`src=${src}`);
            } catch (e) {
              // Ignore attribute errors
            }
            
            return `\n# iframe ${args.join(' ')}\n` + 
              snapshots.join('\n').replaceAll('[ref=', `[ref=f${index}`);
          } catch (e) {
            return '';
          }
        })
      );
      
      // Create a compact description of the page
      const pageInfo = [
        `page: ${await page.title()}`,
        `url: ${page.url()}`,
        `interactive_elements: ${interactiveElements.length}`,
        `frames: ${visibleFrames.length}`,
        '',
        '# Interactive Elements:'
      ].join('\n');
      
      // Combine all snapshots
      return pageInfo + '\n' + 
        mainSnapshot.filter(Boolean).join('\n') + '\n' + 
        frameSnapshots.filter(Boolean).join('\n');
      
    } catch (error) {
      console.error('Error creating compact snapshot:', error);
      // Fallback to just basic page info if something goes wrong
      return `page: ${await page.title()}\nurl: ${page.url()}\nerror: Could not create interactive elements snapshot`;
    }
  }

  refLocator(ref: string): playwright.Locator {
    let frame = this._frameLocators[0];
    const match = ref.match(/^f(\d+)(.*)/);
    if (match) {
      const frameIndex = parseInt(match[1], 10);
      frame = this._frameLocators[frameIndex];
      ref = match[2];
    }

    if (!frame)
      throw new Error(`Frame does not exist. Provide ref from the most current snapshot.`);

    return frame.locator(`aria-ref=${ref}`);
  }
}
