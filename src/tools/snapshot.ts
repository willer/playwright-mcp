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
import type { ImageContent, TextContent } from '@modelcontextprotocol/sdk/types';

const snapshotSchema = z.object({
  includeScreenshot: z.boolean().optional().describe('Include a screenshot along with the accessibility snapshot'),
});

export const snapshot: Tool = {
  schema: {
    name: 'browser_snapshot',
    description: 'Capture accessibility snapshot of the current page, optionally with screenshot',
    inputSchema: zodToJsonSchema(snapshotSchema),
  },

  handle: async (context, params) => {
    const validatedParams = snapshotSchema.parse(params);
    return await captureAriaSnapshot(context, '', validatedParams.includeScreenshot);
  },
};

const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  includeScreenshot: z.boolean().optional().describe('Include a screenshot along with the accessibility snapshot'),
});

export const click: Tool = {
  schema: {
    name: 'browser_click',
    description: 'Perform click on a web page',
    inputSchema: zodToJsonSchema(elementSchema),
  },

  handle: async (context, params) => {
    const validatedParams = elementSchema.parse(params);
    return runAndWait(context, `"${validatedParams.element}" clicked`, () => context.refLocator(validatedParams.ref).click(), true, validatedParams.includeScreenshot);
  },
};

const dragSchema = z.object({
  startElement: z.string().describe('Human-readable source element description used to obtain the permission to interact with the element'),
  startRef: z.string().describe('Exact source element reference from the page snapshot'),
  endElement: z.string().describe('Human-readable target element description used to obtain the permission to interact with the element'),
  endRef: z.string().describe('Exact target element reference from the page snapshot'),
  includeScreenshot: z.boolean().optional().describe('Include a screenshot along with the accessibility snapshot'),
});

export const drag: Tool = {
  schema: {
    name: 'browser_drag',
    description: 'Perform drag and drop between two elements',
    inputSchema: zodToJsonSchema(dragSchema),
  },

  handle: async (context, params) => {
    const validatedParams = dragSchema.parse(params);
    return runAndWait(context, `Dragged "${validatedParams.startElement}" to "${validatedParams.endElement}"`, async () => {
      const startLocator = context.refLocator(validatedParams.startRef);
      const endLocator = context.refLocator(validatedParams.endRef);
      await startLocator.dragTo(endLocator);
    }, true, validatedParams.includeScreenshot);
  },
};

export const hover: Tool = {
  schema: {
    name: 'browser_hover',
    description: 'Hover over element on page',
    inputSchema: zodToJsonSchema(elementSchema),
  },

  handle: async (context, params) => {
    const validatedParams = elementSchema.parse(params);
    return runAndWait(context, `Hovered over "${validatedParams.element}"`, () => context.refLocator(validatedParams.ref).hover(), true, validatedParams.includeScreenshot);
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
    const validatedParams = typeSchema.parse(params);
    return await runAndWait(context, `Typed "${validatedParams.text}" into "${validatedParams.element}"`, async () => {
      const locator = context.refLocator(validatedParams.ref);
      await locator.fill(validatedParams.text);
      if (validatedParams.submit)
        await locator.press('Enter');
    }, true, validatedParams.includeScreenshot);
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
    const validatedParams = selectOptionSchema.parse(params);
    return await runAndWait(context, `Selected option in "${validatedParams.element}"`, async () => {
      const locator = context.refLocator(validatedParams.ref);
      await locator.selectOption(validatedParams.values);
    }, true, validatedParams.includeScreenshot);
  },
};