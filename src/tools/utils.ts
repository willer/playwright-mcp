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

import type * as playwright from 'playwright';
import type { ToolResult } from './tool';
import type { Context } from '../context';

async function waitForCompletion<R>(page: playwright.Page, callback: () => Promise<R>): Promise<R> {
  const requests = new Set<playwright.Request>();
  let frameNavigated = false;
  let waitCallback: () => void = () => {};
  const waitBarrier = new Promise<void>(f => { waitCallback = f; });

  const requestListener = (request: playwright.Request) => requests.add(request);
  const requestFinishedListener = (request: playwright.Request) => {
    requests.delete(request);
    if (!requests.size)
      waitCallback();
  };

  const frameNavigateListener = (frame: playwright.Frame) => {
    if (frame.parentFrame())
      return;
    frameNavigated = true;
    dispose();
    clearTimeout(timeout);
    void frame.waitForLoadState('load').then(() => {
      waitCallback();
    });
  };

  const onTimeout = () => {
    dispose();
    waitCallback();
  };

  page.on('request', requestListener);
  page.on('requestfinished', requestFinishedListener);
  page.on('framenavigated', frameNavigateListener);
  const timeout = setTimeout(onTimeout, 10000);

  const dispose = () => {
    page.off('request', requestListener);
    page.off('requestfinished', requestFinishedListener);
    page.off('framenavigated', frameNavigateListener);
    clearTimeout(timeout);
  };

  try {
    const result = await callback();
    if (!requests.size && !frameNavigated)
      waitCallback();
    await waitBarrier;
    await page.evaluate(() => new Promise(f => setTimeout(f, 1000)));
    return result;
  } finally {
    dispose();
  }
}

export async function runAndWait(context: Context, status: string, callback: (page: playwright.Page) => Promise<any>, snapshot: boolean = false, compact: boolean = false): Promise<ToolResult> {
  const page = context.existingPage();
  const dismissFileChooser = context.hasFileChooser();
  await waitForCompletion(page, () => callback(page));
  if (dismissFileChooser)
    context.clearFileChooser();
  const result: ToolResult = snapshot ? await captureAriaSnapshot(context, status, compact) : {
    content: [{ type: 'text', text: status }],
  };
  return result;
}

export async function captureAriaSnapshot(
  context: Context, 
  status: string = '', 
  compact: boolean = false,
  truncate: boolean = true,
  truncateLength: number = 5000
): Promise<ToolResult> {
  const page = context.existingPage();
  const lines = [];
  if (status)
    lines.push(`${status}`);
  lines.push(
      '',
      `- Page URL: ${page.url()}`,
      `- Page Title: ${await page.title()}`
  );
  if (context.hasFileChooser())
    lines.push(`- There is a file chooser visible that requires browser_choose_file to be called`);
  
  let snapshotContent = '';
  
  if (compact) {
    // In compact mode, we'll only include the essential interactive elements
    lines.push(
      `- Mode: Compact (showing only interactive elements)`,
      `- For complete page details, use browser_snapshot with compact=false`,
      '```yaml'
    );
    snapshotContent = await context.compactSnapshot();
  } else {
    // Normal detailed snapshot
    lines.push(
      `- Mode: Standard page details`,
      '```yaml'
    );
    snapshotContent = await context.allFramesSnapshot();
  }
  
  // Handle truncation if needed
  if (truncate && snapshotContent.length > truncateLength) {
    snapshotContent = snapshotContent.substring(0, truncateLength);
    snapshotContent += `\n\n# ... Content truncated to ${truncateLength} characters ...`;
    snapshotContent += `\n# Use browser_snapshot with truncate=false for full content, or compact=true to focus on interactive elements.`;
  }
  
  lines.push(snapshotContent, '```', '');
  
  // Add truncation status display
  if (truncate) {
    lines.push(`Note: Truncation is enabled. ${
      snapshotContent.length >= truncateLength ? 
      `Content was truncated to ${truncateLength} characters.` : 
      `Content was under the ${truncateLength} character limit and was not truncated.`
    }`);
  }
  
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  };
}

export function sanitizeForFilePath(s: string) {
  return s.replace(/[\x00-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7F]+/g, '-');
}

/**
 * Ensures a URL has a protocol prefix. If the URL doesn't start with http:// or https://, 
 * https:// is added.
 * @param url The URL to normalize
 * @returns The URL with a protocol prefix
 */
export function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }
  return url;
}

export async function createUserDataDir(): Promise<string> {
  // Import modules inside the function to avoid circular dependencies
  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');

  let cacheDirectory: string;
  if (process.platform === 'linux')
    cacheDirectory = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  else if (process.platform === 'darwin')
    cacheDirectory = path.join(os.homedir(), 'Library', 'Caches');
  else if (process.platform === 'win32')
    cacheDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  else
    throw new Error('Unsupported platform: ' + process.platform);

  const result = path.join(cacheDirectory, 'ms-playwright', 'mcp-chrome-profile');
  await fs.mkdir(result, { recursive: true });
  return result;
}
