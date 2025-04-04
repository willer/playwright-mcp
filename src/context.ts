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

export class Context {
  private _options: ContextOptions;
  private _browser: playwright.Browser | undefined;
  private _page: playwright.Page | undefined;
  private _console: playwright.ConsoleMessage[] = [];
  private _createPagePromise: Promise<playwright.Page> | undefined;
  private _fileChooser: playwright.FileChooser | undefined;
  private _lastSnapshotFrames: (playwright.Page | playwright.FrameLocator)[] = [];

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
    let channel = this._options.launchOptions?.channel ?? this._options.browserName ?? 'chrome';
    
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
      
      // Map our browser names to ones Playwright can use
      let browserToUse: 'chromium' | 'firefox' | 'webkit' = 'chromium';
      
      // Map browser names to Playwright-supported ones
      if (this._options.browserName) {
        if (this._options.browserName === 'firefox' || this._options.browserName === 'webkit') {
          browserToUse = this._options.browserName;
        } else if (this._options.browserName === 'brave' || this._options.browserName === 'msedge') {
          // Both Brave and Edge are Chromium-based
          browserToUse = 'chromium';
        }
      }
      
      url.searchParams.set('browser', browserToUse);
      
      let launchOptions = this._options.launchOptions ? {...this._options.launchOptions} : {};
      
      // If we're using Brave, set the executablePath
      if (this._options.browserName === 'brave') {
        const platform = process.platform;
        
        if (platform === 'darwin') {
          // macOS
          const arm64Path = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
          const x64Path = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
          launchOptions.executablePath = fs.existsSync(arm64Path) ? arm64Path : x64Path;
        } else if (platform === 'win32') {
          // Windows
          launchOptions.executablePath = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
        } else if (platform === 'linux') {
          // Linux
          launchOptions.executablePath = '/usr/bin/brave-browser';
        }
      }
      
      if (Object.keys(launchOptions).length > 0) {
        url.searchParams.set('launch-options', JSON.stringify(launchOptions));
      }
      
      const browser = await playwright[browserToUse].connect(String(url));
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
      // Map to Playwright-supported browser types
      let browserToUse: 'chromium' | 'firefox' | 'webkit' = 'chromium';
      
      if (this._options.browserName) {
        if (this._options.browserName === 'firefox' || this._options.browserName === 'webkit') {
          browserToUse = this._options.browserName;
        }
        // Both Brave and Edge use Chromium underneath
      }
      
      // Get the appropriate Playwright browser type
      const browserType = playwright[browserToUse];

      // Determine the profile directory to use
      let userDataDir = this._options.userDataDir;
      
      // For Brave, we'll use a special approach - let Brave manage its own profile
      if (this._options.browserName === 'brave') {
        // Create an empty directory for Playwright's requirements, but Brave will ignore it
        // and use its own default profile directory
        const tempDir = path.join(os.tmpdir(), `brave-empty-profile-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });
        userDataDir = tempDir;
        console.error(`For Brave: Using placeholder directory ${tempDir}, but Brave will use its default profile`);
      } else {
        // For other browsers, set up a specific profile with permissions
        userDataDir = this._options.userDataDir.endsWith('-profile') 
          ? this._options.userDataDir.replace('-profile', `-${this._options.browserName || 'chrome'}-allowed-profile`) 
          : `${this._options.userDataDir}-allowed`;
          
        // Make sure this directory exists
        if (!fs.existsSync(userDataDir)) {
          fs.mkdirSync(userDataDir, { recursive: true });
        }
      }
      
      // Set browser-specific executable paths if needed
      let executablePath = this._options.launchOptions?.executablePath;
      if (this._options.browserName === 'brave') {
        // Default Brave paths based on platform
        const platform = process.platform;
        if (platform === 'darwin') {
          // macOS
          const arm64Path = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
          const x64Path = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
          executablePath = fs.existsSync(arm64Path) ? arm64Path : x64Path;
        } else if (platform === 'win32') {
          // Windows
          executablePath = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
        } else if (platform === 'linux') {
          // Linux
          executablePath = '/usr/bin/brave-browser';
        }
      }
      // msedge is handled automatically by Playwright
      
      const launchOptions = {
        ...this._options.launchOptions,
        executablePath,
        // Control all arguments explicitly
        ignoreDefaultArgs: true,
        args: [
          ...(this._options.launchOptions?.args || []),
          // Add back only the default arguments that are safe and necessary
          '--disable-field-trial-config',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--no-default-browser-check',
          '--disable-default-apps',
          '--disable-dev-shm-usage',
          '--allow-pre-commit-input',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--force-color-profile=srgb',
          '--metrics-recording-only',
          '--no-first-run',
          '--password-store=basic',
          '--use-mock-keychain',
          '--no-service-autorun',
          '--export-tagged-pdf',
          '--disable-search-engine-choice-screen',
          '--unsafely-disable-devtools-self-xss-warnings',
          
          // Extensions-specific flags
          '--enable-extensions',
          '--no-sandbox',
          // This flag helps with Chrome automation
          '--enable-automation',
          // Completely disable extension restrictions
          '--disable-extensions-http-throttling',
          // Disable extension security features that might prevent installation
          '--disable-extensions-file-access-check',
          // Allow external extensions installation
          '--enable-easy-off-store-extension-install',
          // Additional flags for extension support
          '--allow-outdated-plugins',
          // Disable extension security policies
          '--disable-extension-security-policy',
          // Add service worker bypass to help with login
          '--enable-features=ServiceWorkerBypassFetchHandler',
          // Essential for Playwright to communicate with the browser
          '--remote-debugging-pipe',
        ],
        handleSIGINT: true,  // Ensure browser process is properly cleaned up on SIGINT
        handleSIGTERM: true, // Ensure browser process is properly cleaned up on SIGTERM
        handleSIGHUP: true,  // Ensure browser process is properly cleaned up on SIGHUP
      };

      // Handle custom flags for Brave
      const isBrave = (launchOptions as any).isBrave === true || this._options.browserName === 'brave';
      
      // Special handling for Brave - we want minimal arguments
      if (isBrave) {
        console.error('Using Brave-specific launch configuration - minimal arguments');
        
        // For Brave, we'll use ignoreAllDefaultArgs: true (already set above)
        // and provide only the minimal set of args needed
        
        // Filter out any problematic args that might interfere with extensions
        if (launchOptions.args) {
          launchOptions.args = launchOptions.args.filter(arg => 
            !arg.startsWith('--disable-extensions') &&
            !arg.startsWith('--disable-component-extensions-with-background-pages')
          );
          
          // Make sure --enable-extensions is included
          if (!launchOptions.args.includes('--enable-extensions')) {
            launchOptions.args.push('--enable-extensions');
          }
        }
        
        // Clean up the launchOptions to avoid confusing Playwright
        if ((launchOptions as any).isBrave) {
          delete (launchOptions as any).isBrave;
        }
        
        console.error('Final Brave launch options:');
        console.error('ignoreDefaultArgs:', launchOptions.ignoreDefaultArgs);
        console.error('args:', launchOptions.args);
      } else if (launchOptions.args) {
        // For non-Brave browsers, filter out any user-data-dir flags as Playwright adds them
        launchOptions.args = launchOptions.args.filter(arg =>
          !arg.startsWith('--user-data-dir=') &&
          !arg.startsWith('--user-data-dir-name=')
        );
      }

      // Debug info - show what we're about to launch
      console.error('----------------------------------------');
      console.error('Launching browser with these parameters:');
      console.error(`Browser type: ${browserToUse}`);
      console.error(`Browser actual: ${this._options.browserName}`);
      console.error(`User data dir: ${userDataDir}`);
      console.error('Launch options:', JSON.stringify(launchOptions, null, 2));
      console.error('----------------------------------------');
      
      // Launch the browser with persistent context - use our custom user data dir
      return await browserType.launchPersistentContext(userDataDir, launchOptions);
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
    this._lastSnapshotFrames = [];
    const yaml = await this._allFramesSnapshot(this.existingPage());
    return yaml.toString().trim();
  }

  private async _allFramesSnapshot(frame: playwright.Page | playwright.FrameLocator): Promise<yaml.Document> {
    const frameIndex = this._lastSnapshotFrames.push(frame) - 1;
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
                const childSnapshot = await this._allFramesSnapshot(frame.frameLocator(`aria-ref=${ref}`));
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
    let frame = this._lastSnapshotFrames[0];
    const match = ref.match(/^f(\d+)(.*)/);
    if (match) {
      const frameIndex = parseInt(match[1], 10);
      frame = this._lastSnapshotFrames[frameIndex];
      ref = match[2];
    }

    if (!frame)
      throw new Error(`Frame does not exist. Provide ref from the most current snapshot.`);

    return frame.locator(`aria-ref=${ref}`);
  }
}
