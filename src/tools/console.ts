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

import type { TextContent } from '@modelcontextprotocol/sdk/types';
import type { Tool } from './tool';

const consoleSchema = z.object({
  clear: z.boolean().optional().describe('Clear the console after reading'),
});

export const consoleMessages: Tool = {
  schema: {
    name: 'browser_console',
    description: 'Get browser console messages',
    inputSchema: zodToJsonSchema(consoleSchema),
  },

  handle: async (context, params) => {
    const validatedParams = consoleSchema.parse(params);
    const messages = await context.console();
    
    // Format messages for better readability
    let consoleText = 'Console Messages:\n';
    
    if (messages.length === 0) {
      consoleText += '[No console messages]';
    } else {
      consoleText += messages.map((message, index) => {
        const timestamp = new Date().toISOString();
        const type = message.type().toUpperCase();
        const text = message.text();
        const location = message.location().url ? ` (${message.location().url}:${message.location().lineNumber})` : '';
        
        return `[${index + 1}] [${timestamp}] [${type}]${location}: ${text}`;
      }).join('\n');
    }
    
    const content: TextContent[] = [{
      type: 'text' as const,
      text: consoleText,
    }];
    
    // Optionally clear the console
    if (validatedParams.clear) {
      await context.clearConsole();
    }
    
    return { content };
  },
};