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
import zodToJsonSchema from 'zod-to-json-schema';

import { captureAriaSnapshot, runAndWait } from './utils';

import type * as playwright from 'playwright';
import type { Tool } from './tool';

const snapshotSchema = z.object({
  truncate: z.boolean().optional().default(true).describe('Whether to limit the length of the snapshot (defaults to true, saves tokens)'),
  truncate_length: z.number().optional().default(5000).describe('Maximum length of the snapshot when truncate=true (defaults to 5000)'),
  compact: z.boolean().optional().default(false).describe('Whether to show only interactive elements (defaults to false). Set to true to focus only on actionable items.')
});

export const snapshot: Tool = {
  schema: {
    name: 'browser_snapshot',
    description: 'Capture accessibility snapshot of the current page. By default returns normal page details with truncation to save tokens. Use truncate=false for full details or compact=true to focus only on interactive elements.',
    inputSchema: zodToJsonSchema(snapshotSchema),
  },

  handle: async (context, params) => {
    const validatedParams = snapshotSchema.parse(params);
    return await captureAriaSnapshot(
      context, 
      '', 
      validatedParams.compact,
      validatedParams.truncate,
      validatedParams.truncate_length
    );
  },
};

const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
});

export const click: Tool = {
  schema: {
    name: 'browser_click',
    description: 'Perform click on a web page',
    inputSchema: zodToJsonSchema(elementSchema),
  },

  handle: async (context, params) => {
    try {
      const validatedParams = elementSchema.parse(params);
      
      // First, verify that the ref actually exists before attempting to click
      const locator = context.refLocator(validatedParams.ref);
      const count = await locator.count();
      
      if (count === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `Error: Element "${validatedParams.element}" (ref: ${validatedParams.ref}) not found on page. The page may have changed since the last snapshot. Please use browser_snapshot to refresh the page data.` 
          }],
          isError: true
        };
      }
      
      return runAndWait(context, `"${validatedParams.element}" clicked`, () => locator.click(), true);
    } catch (error: any) {
      console.error(`Error in browser_click: ${error}`);
      return {
        content: [{ 
          type: 'text', 
          text: `Error clicking element: ${error.message || String(error)}. Try using browser_snapshot to refresh the page data.` 
        }],
        isError: true
      };
    }
  },
};

const dragSchema = z.object({
  startElement: z.string().describe('Human-readable source element description used to obtain the permission to interact with the element'),
  startRef: z.string().describe('Exact source element reference from the page snapshot'),
  endElement: z.string().describe('Human-readable target element description used to obtain the permission to interact with the element'),
  endRef: z.string().describe('Exact target element reference from the page snapshot'),
});

export const drag: Tool = {
  schema: {
    name: 'browser_drag',
    description: 'Perform drag and drop between two elements',
    inputSchema: zodToJsonSchema(dragSchema),
  },

  handle: async (context, params) => {
    try {
      const validatedParams = dragSchema.parse(params);
      
      // First, verify that both elements exist before attempting to drag
      const startLocator = context.refLocator(validatedParams.startRef);
      const endLocator = context.refLocator(validatedParams.endRef);
      
      const startCount = await startLocator.count();
      const endCount = await endLocator.count();
      
      if (startCount === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `Error: Source element "${validatedParams.startElement}" (ref: ${validatedParams.startRef}) not found on page. The page may have changed since the last snapshot. Please use browser_snapshot to refresh the page data.` 
          }],
          isError: true
        };
      }
      
      if (endCount === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `Error: Target element "${validatedParams.endElement}" (ref: ${validatedParams.endRef}) not found on page. The page may have changed since the last snapshot. Please use browser_snapshot to refresh the page data.` 
          }],
          isError: true
        };
      }
      
      return runAndWait(context, `Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`, async () => {
        await startLocator.dragTo(endLocator);
      }, true);
    } catch (error: any) {
      console.error(`Error in browser_drag: ${error}`);
      return {
        content: [{ 
          type: 'text', 
          text: `Error performing drag and drop: ${error.message || String(error)}. The elements might not be draggable or the page may have changed. Try using browser_snapshot to refresh the page data.` 
        }],
        isError: true
      };
    }
  },
};

export const hover: Tool = {
  schema: {
    name: 'browser_hover',
    description: 'Hover over element on page',
    inputSchema: zodToJsonSchema(elementSchema),
  },

  handle: async (context, params) => {
    try {
      const validatedParams = elementSchema.parse(params);
      
      // First, verify that the ref actually exists before attempting to hover
      const locator = context.refLocator(validatedParams.ref);
      const count = await locator.count();
      
      if (count === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `Error: Element "${validatedParams.element}" (ref: ${validatedParams.ref}) not found on page. The page may have changed since the last snapshot. Please use browser_snapshot to refresh the page data.` 
          }],
          isError: true
        };
      }
      
      return runAndWait(context, `Hovered over "${validatedParams.element}"`, () => locator.hover(), true);
    } catch (error: any) {
      console.error(`Error in browser_hover: ${error}`);
      return {
        content: [{ 
          type: 'text', 
          text: `Error hovering over element: ${error.message || String(error)}. Try using browser_snapshot to refresh the page data.` 
        }],
        isError: true
      };
    }
  },
};

const typeSchema = elementSchema.extend({
  text: z.string().describe('Text to type into the element'),
  submit: z.boolean().describe('Whether to submit entered text (press Enter after)'),
});

export const type: Tool = {
  schema: {
    name: 'browser_type',
    description: 'Type text into editable element',
    inputSchema: zodToJsonSchema(typeSchema),
  },

  handle: async (context, params) => {
    try {
      const validatedParams = typeSchema.parse(params);
      
      // First, verify that the ref actually exists before attempting to type
      const locator = context.refLocator(validatedParams.ref);
      const count = await locator.count();
      
      if (count === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `Error: Element "${validatedParams.element}" (ref: ${validatedParams.ref}) not found on page. The page may have changed since the last snapshot. Please use browser_snapshot to refresh the page data.` 
          }],
          isError: true
        };
      }
      
      return await runAndWait(context, `Typed "${validatedParams.text}" into "${validatedParams.element}"`, async () => {
        await locator.fill(validatedParams.text);
        if (validatedParams.submit)
          await locator.press('Enter');
      }, true);
    } catch (error: any) {
      console.error(`Error in browser_type: ${error}`);
      return {
        content: [{ 
          type: 'text', 
          text: `Error typing text: ${error.message || String(error)}. The element might not be editable or the page may have changed. Try using browser_snapshot to refresh the page data.` 
        }],
        isError: true
      };
    }
  },
};

const selectOptionSchema = elementSchema.extend({
  values: z.array(z.string()).describe('Array of values to select in the dropdown. This can be a single value or multiple values.'),
});

export const selectOption: Tool = {
  schema: {
    name: 'browser_select_option',
    description: 'Select an option in a dropdown',
    inputSchema: zodToJsonSchema(selectOptionSchema),
  },

  handle: async (context, params) => {
    try {
      const validatedParams = selectOptionSchema.parse(params);
      
      // First, verify that the ref actually exists before attempting to select
      const locator = context.refLocator(validatedParams.ref);
      const count = await locator.count();
      
      if (count === 0) {
        return {
          content: [{ 
            type: 'text', 
            text: `Error: Dropdown "${validatedParams.element}" (ref: ${validatedParams.ref}) not found on page. The page may have changed since the last snapshot. Please use browser_snapshot to refresh the page data.` 
          }],
          isError: true
        };
      }
      
      return await runAndWait(context, `Selected option in "${validatedParams.element}"`, async () => {
        await locator.selectOption(validatedParams.values);
      }, true);
    } catch (error: any) {
      console.error(`Error in browser_select_option: ${error}`);
      return {
        content: [{ 
          type: 'text', 
          text: `Error selecting option: ${error.message || String(error)}. The element might not be a valid dropdown or the options may not exist. Try using browser_snapshot to refresh the page data.` 
        }],
        isError: true
      };
    }
  },
};

const screenshotSchema = z.object({
  raw: z.boolean().optional().describe('Whether to return without compression (in PNG format). Default is false, which returns a JPEG image.'),
});

export const screenshot: Tool = {
  schema: {
    name: 'browser_take_screenshot',
    description: `Take a screenshot of the current page. EXPENSIVE: Use only when verifying layouts or as a last resort when other approaches fail. Costs many tokens due to image size. Use browser_snapshot for actions, not this.`,
    inputSchema: zodToJsonSchema(screenshotSchema),
  },

  handle: async (context, params) => {
    const validatedParams = screenshotSchema.parse(params);
    const page = context.existingPage();
    const options: playwright.PageScreenshotOptions = validatedParams.raw ? { type: 'png', scale: 'css' } : { type: 'jpeg', quality: 50, scale: 'css' };
    const screenshot = await page.screenshot(options);
    return {
      content: [{ type: 'image', data: screenshot.toString('base64'), mimeType: validatedParams.raw ? 'image/png' : 'image/jpeg' }],
    };
  },
};
