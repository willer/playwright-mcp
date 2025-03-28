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

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { Tool } from './tool';

const newTabSchema = z.object({
  url: z.string().optional().describe('Optional URL to navigate to in the new tab'),
  headless: z.boolean().optional().describe('Run in headless mode (no browser UI)'),
});

export const newTab: Tool = {
  schema: {
    name: 'browser_new_tab',
    description: 'Open a new browser tab',
    inputSchema: zodToJsonSchema(newTabSchema),
  },

  handle: async (context, params) => {
    const validatedParams = newTabSchema.parse(params);

    // Create a new page in the same browser context
    const newPage = await context.createNewTab(validatedParams.headless);

    // If URL is provided, navigate to it
    if (validatedParams.url) {
      await newPage.goto(validatedParams.url, { waitUntil: 'domcontentloaded' });
      // Cap load event to 5 seconds, the page is operational at this point.
      await newPage.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    }

    return {
      content: [{
        type: 'text' as const,
        text: `New tab opened${validatedParams.url ? ` and navigated to ${validatedParams.url}` : ''}`,
      }],
    };
  },
};

const listTabsSchema = z.object({});

export const listTabs: Tool = {
  schema: {
    name: 'browser_list_tabs',
    description: 'List all open browser tabs',
    inputSchema: zodToJsonSchema(listTabsSchema),
  },

  handle: async context => {
    const tabs = await context.getAllTabs();

    let tabInfo = 'Browser Tabs:\n\n';

    if (tabs.length === 0) {
      tabInfo += 'No tabs open.';
    } else {
      tabInfo += tabs.map((tab, index) => {
        const isActive = tab.isActive ? '* ' : '  ';
        return `${isActive}[${index}] Title: ${tab.title} | URL: ${tab.url}`;
      }).join('\n');

      tabInfo += '\n\n* Current active tab';
    }

    return {
      content: [{
        type: 'text' as const,
        text: tabInfo,
      }],
    };
  },
};

const switchTabSchema = z.object({
  index: z.number().int().min(0).describe('Index of the tab to switch to (from browser_list_tabs)'),
});

export const switchTab: Tool = {
  schema: {
    name: 'browser_switch_tab',
    description: 'Switch to a different browser tab',
    inputSchema: zodToJsonSchema(switchTabSchema),
  },

  handle: async (context, params) => {
    const validatedParams = switchTabSchema.parse(params);

    // Switch to the specified tab
    try {
      const tab = await context.switchToTab(validatedParams.index);
      return {
        content: [{
          type: 'text' as const,
          text: `Switched to tab [${validatedParams.index}]: ${tab.title}`,
        }],
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text' as const,
          text: `Failed to switch to tab ${validatedParams.index}: ${errorMessage}`,
        }],
        isError: true,
      };
    }
  },
};

const closeTabSchema = z.object({
  index: z.number().int().min(0).optional().describe('Index of the tab to close (from browser_list_tabs). If not provided, closes the current tab.'),
  all: z.boolean().optional().describe('If true, closes all tabs except the first one'),
});

export const closeTab: Tool = {
  schema: {
    name: 'browser_close_tab',
    description: 'Close a browser tab',
    inputSchema: zodToJsonSchema(closeTabSchema),
  },

  handle: async (context, params) => {
    const validatedParams = closeTabSchema.parse(params);

    if (validatedParams.all) {
      // Close all tabs except the first one and switch to it
      await context.closeAllTabsExceptFirst();
      return {
        content: [{
          type: 'text' as const,
          text: 'All tabs closed except the first one',
        }],
      };
    }

    if (validatedParams.index !== undefined) {
      // Close the specified tab
      try {
        await context.closeTabByIndex(validatedParams.index);
        return {
          content: [{
            type: 'text' as const,
            text: `Tab [${validatedParams.index}] closed`,
          }],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to close tab ${validatedParams.index}: ${errorMessage}`,
          }],
          isError: true,
        };
      }
    } else {
      // Close the current tab
      await context.closeCurrentTab();
      return {
        content: [{
          type: 'text' as const,
          text: 'Current tab closed',
        }],
      };
    }
  },
};
