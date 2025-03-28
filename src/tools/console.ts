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

export const console: Tool = {
  schema: {
    name: 'browser_console',
    description: 'View the page console messages',
    inputSchema: zodToJsonSchema(z.object({
      errorsOnly: z.boolean().optional().describe('Only show error messages')
    })),
  },

  handle: async (context, params) => {
    const messages = await context.console();
    const filteredMessages = params?.errorsOnly 
      ? messages.filter(message => message.type() === 'error')
      : messages;
    
    const log = filteredMessages.map(message => `[${message.type().toUpperCase()}] ${message.text()}`).join('\n');
    return {
      content: [{ type: 'text', text: log }],
    };
  },
};
