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
import * as https from 'https';
import type { Tool, ToolResult } from '../tool';
import type { Context } from '../../context';
import { PlaywrightComputer } from './computer';
import { normalizeUrl } from '../utils';

// Session status types
type SessionStatus = 'starting' | 'running' | 'completed' | 'error';

// Session data structure
interface SessionData {
  status: SessionStatus;
  instructions: string;
  logs: Array<{
    timestamp: string;
    message: string;
    contentType: 'text' | 'image';
    content: string;
  }>;
  error?: string;
  startTime: number;
  endTime?: number;
}

// Singleton session
let globalSession: SessionData | null = null;

// Helper function to log to the session
function logToSession(message: string, contentType: 'text' | 'image' = 'text', content: string = ''): void {
  if (!globalSession)
    throw new Error('No active session found');


  globalSession.logs.push({
    timestamp: new Date().toISOString(),
    message,
    contentType,
    content
  });
}

// OpenAI API client for the Computer Use Agent interactions
class OpenAIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createOpenAIRequest(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);

      const options = {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        }
      };

      const req = https.request(options, res => {
        let responseData = '';

        res.on('data', chunk => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const parsedData = JSON.parse(responseData);
            resolve(parsedData);
          } catch (e: any) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      });

      req.on('error', (e: Error) => {
        reject(new Error(`Request failed: ${e.message}`));
      });

      req.write(data);
      req.end();
    });
  }

  // This function will interact with OpenAI to process computer tasks
  async runComputerAgent(computer: PlaywrightComputer, instructions: string): Promise<void> {
    logToSession(`Processing instructions with AI: ${instructions}`, 'text');

    // Get initial screenshot
    const screenshot = await computer.screenshot();
    logToSession('Captured initial screenshot', 'image', screenshot);

    // Create the initial message for the AI
    const systemPrompt = `You are a browser automation agent that helps users complete tasks in a web browser.
You have access to these computer control functions:
- screenshot() - Take a screenshot of the current browser window
- click(x, y) - Click at coordinates (x, y)
- type(text) - Type the given text
- press(key) - Press a keyboard key (e.g., "Enter", "ArrowDown")
- wait(ms) - Wait for the specified number of milliseconds
- navigate(url) - Navigate to the specified URL

Think step by step about how to accomplish the user's goal. Analyze the screenshot to locate UI elements and determine the appropriate actions to take.`;

    const userPrompt = `I need you to help me with the following task in a web browser:\n\n${instructions}\n\nPlease complete this task step by step, explaining your reasoning as you go.`;

    try {
      const response = await this.createOpenAIRequest({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } }
          ] }
        ],
        max_tokens: 2000
      });

      logToSession('Received AI response', 'text');

      if (response.choices && response.choices.length > 0) {
        const agentResponse = response.choices[0].message.content;
        logToSession(`Agent's plan: ${agentResponse}`, 'text');

        // Execute the plan by parsing the response and performing actions
        await this.executeActions(computer, agentResponse);
      } else {
        throw new Error('No response from the OpenAI API');
      }
    } catch (error: any) {
      logToSession(`Error in AI processing: ${error.message}`, 'text');
      throw error;
    }
  }

  // Execute the actions described by the AI
  async executeActions(computer: PlaywrightComputer, agentResponse: string): Promise<void> {
    // Parse the response to identify actions
    const lines = agentResponse.split('\n');

    for (const line of lines) {
      // Look for function-like commands in the text
      if (line.includes('screenshot()')) {
        logToSession('Taking screenshot', 'text');
        const screenshot = await computer.screenshot();
        logToSession('Screenshot taken', 'image', screenshot);
      } else if (line.match(/click\(\s*\d+\s*,\s*\d+\s*\)/)) {
        const match = line.match(/click\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (match) {
          const x = parseInt(match[1], 10);
          const y = parseInt(match[2], 10);
          logToSession(`Clicking at (${x}, ${y})`, 'text');
          await computer.click(x, y);
        }
      } else if (line.match(/type\(['"](.*)['"]\)/)) {
        const match = line.match(/type\(['"](.*)['"](?:,\s*(\d+))?\)/);
        if (match) {
          const text = match[1];
          logToSession(`Typing text: ${text}`, 'text');
          await computer.type(text);
        }
      } else if (line.match(/press\(['"](.*)['"]\)/)) {
        const match = line.match(/press\(['"](.*)['"](?:,\s*(\d+))?\)/);
        if (match) {
          const key = match[1];
          logToSession(`Pressing key: ${key}`, 'text');
          await computer.press(key);
        }
      } else if (line.match(/wait\(\s*\d+\s*\)/)) {
        const match = line.match(/wait\(\s*(\d+)\s*\)/);
        if (match) {
          const ms = parseInt(match[1], 10);
          logToSession(`Waiting for ${ms}ms`, 'text');
          await computer.wait(ms);
        }
      } else if (line.match(/navigate\(['"](.*)['"](?:,\s*(\d+))?\)/)) {
        const match = line.match(/navigate\(['"](.*)['"](?:,\s*(\d+))?\)/);
        if (match) {
          const url = match[1];
          logToSession(`Navigating to: ${url}`, 'text');
          await computer.navigate(url);
        }
      }

      // Capture screenshot after each step to show progress
      const screenshot = await computer.screenshot();
      logToSession('Screenshot after action', 'image', screenshot);
    }
  }
}

// Agent start schema
const agentStartSchema = z.object({
  startUrl: z.string().optional().describe('Optional URL to navigate to before starting the agent'),
  instructions: z.string().describe('Instructions for the agent to follow'),
});

// Agent implementation
export const agentStart: Tool = {
  schema: {
    name: 'agent_start',
    description: 'Start a new agent session with given instructions. PREFERRED: Use this tool whenever possible for browsing tasks instead of direct browser controls.',
    inputSchema: zodToJsonSchema(agentStartSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentStartSchema.parse(params);
    
    // Check if we need to set up a browser session first
    try {
      // This will throw if there's no existing page
      context.existingPage();
    } catch (e) {
      return {
        content: [{ 
          type: 'text' as const, 
          text: JSON.stringify({ 
            error: 'No active browser session. Please use browser_navigate first to open a page before starting the agent.' 
          }) 
        }],
        isError: true,
      };
    }
    
    // Check if there's already a session running and reuse it
    if (!globalSession) {
      // Only create a new session if one doesn't exist
      globalSession = {
        status: 'starting',
        instructions: validatedParams.instructions,
        logs: [],
        startTime: Date.now(),
      };
    } else {
      // Update existing session with new instructions
      globalSession.instructions = validatedParams.instructions;
      globalSession.status = 'starting';
      // Keep existing logs
    }
    
    // If startUrl is provided, we'll navigate to it using our shared browser session
    if (validatedParams.startUrl) {
      // Ensure URL has a protocol using our shared utility function
      const url = normalizeUrl(validatedParams.startUrl);
      if (url !== validatedParams.startUrl) {
        logToSession(`Adding https:// protocol to URL: ${url}`, 'text');
      }

      try {
        // Use the existing page to navigate
        const page = context.existingPage();
        await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
        logToSession(`Navigated to: ${url}`, 'text');
        
        // Store the successful URL
        validatedParams.startUrl = url;
      } catch (error: any) {
        logToSession(`Navigation error: ${error.message}`, 'text');
        // Continue with the session despite navigation error
        // The user can still use the agent on the current page
      }
    }

    // Log the start of the session
    logToSession('Agent session started', 'text');

    // Start the agent execution in the background
    setTimeout(() => executeAgent(context, validatedParams.startUrl), 0);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ status: globalSession.status })
      }],
    };
  },
};

// Agent status schema
const agentStatusSchema = z.object({
  waitSeconds: z.number().optional().describe('Time in seconds to wait for completion'),
});

export const agentStatus: Tool = {
  schema: {
    name: 'agent_status',
    description: 'Check the status of the running agent session',
    inputSchema: zodToJsonSchema(agentStatusSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentStatusSchema.parse(params);
    const { waitSeconds = 0 } = validatedParams;

    if (!globalSession) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }

    // If wait time is specified and session is still running, wait
    if (waitSeconds > 0 && (globalSession.status === 'starting' || globalSession.status === 'running'))
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));


    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: globalSession?.status || 'unknown',
          runningTime: Date.now() - (globalSession?.startTime || 0)
        })
      }],
    };
  },
};

// Agent log schema
const agentLogSchema = z.object({
  includeImages: z.boolean().optional().describe('Whether to include images in the log'),
});

export const agentLog: Tool = {
  schema: {
    name: 'agent_log',
    description: 'Get the complete log of the agent session',
    inputSchema: zodToJsonSchema(agentLogSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentLogSchema.parse(params);
    const { includeImages = true } = validatedParams;

    if (!globalSession) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }

    // Create content items for each log entry
    const content = [];

    for (const log of globalSession.logs) {
      if (log.contentType === 'image' && includeImages)
        content.push({ type: 'image' as const, data: log.content, mimeType: 'image/jpeg' });

      content.push({ type: 'text' as const, text: `[${log.timestamp}] ${log.message}` });
    }

    // Add summary at the end
    content.push({
      type: 'text' as const,
      text: `\nSession status: ${globalSession.status}` +
            (globalSession.error ? `\nError: ${globalSession.error}` : '') +
            `\nRunning time: ${((globalSession.endTime || Date.now()) - globalSession.startTime) / 1000}s`
    });

    return { content };
  },
};

// Agent end schema
const agentEndSchema = z.object({});

export const agentEnd: Tool = {
  schema: {
    name: 'agent_end',
    description: 'Forcefully end the current agent session',
    inputSchema: zodToJsonSchema(agentEndSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    agentEndSchema.parse(params);

    if (!globalSession) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }

    // Update session status
    globalSession.status = 'completed';
    globalSession.endTime = Date.now();

    // Log the end of the session
    logToSession('Agent session forcefully ended', 'text');

    const response: ToolResult = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'completed',
          message: 'Session forcefully ended'
        })
      }],
    };

    // Clear the global session after responding
    globalSession = null;

    return response;
  },
};

// Get the last image schema
const agentGetLastImageSchema = z.object({});

export const agentGetLastImage: Tool = {
  schema: {
    name: 'agent_get_last_image',
    description: 'Get the last screenshot from the current agent session',
    inputSchema: zodToJsonSchema(agentGetLastImageSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    agentGetLastImageSchema.parse(params);

    if (!globalSession) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }

    // Find the last image in the logs
    const lastImageLog = [...globalSession.logs].reverse().find(log => log.contentType === 'image');

    if (!lastImageLog) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No screenshot found in session logs' }) }],
        isError: true,
      };
    }

    return {
      content: [
        { type: 'image' as const, data: lastImageLog.content, mimeType: 'image/jpeg' },
        { type: 'text' as const, text: `Screenshot from ${lastImageLog.timestamp}` }
      ],
    };
  },
};

// Agent reply schema
const agentReplySchema = z.object({
  replyText: z.string().describe('Text to send to the agent as a reply'),
});

export const agentReply: Tool = {
  schema: {
    name: 'agent_reply',
    description: 'Send a reply to the running agent session to continue the conversation',
    inputSchema: zodToJsonSchema(agentReplySchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentReplySchema.parse(params);
    
    if (!globalSession) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }
    
    // Log the reply
    logToSession(`User reply: ${validatedParams.replyText}`, 'text');
    
    // For now, just acknowledge the reply
    // In a real implementation, this would trigger the agent to process the reply
    return {
      content: [{ 
        type: 'text' as const, 
        text: JSON.stringify({ 
          status: globalSession.status,
          message: 'Reply received' 
        }) 
      }],
    };
  },
};

// This function handles the actual agent execution
async function executeAgent(context: Context, startUrl?: string): Promise<void> {
  if (!globalSession)
    return;

  try {
    // Update status to running
    globalSession.status = 'running';
    logToSession('Agent execution started', 'text');

    // Use the existing page from the context
    const computer = new PlaywrightComputer(context);

    // Log the current URL for reference - we should already be on the right page
    const currentUrl = await computer.getCurrentUrl();
    logToSession(`Current URL: ${currentUrl}`, 'text');

    // Initialize the OpenAI client with a hard-coded or environment-sourced API key
    // This should be properly configured elsewhere in the system
    const apiKey = process.env.OPENAI_API_KEY || '';
    const openAIClient = new OpenAIClient(apiKey);

    // Execute the agent with instructions
    await openAIClient.runComputerAgent(computer, globalSession.instructions);

    // Complete the session
    globalSession.status = 'completed';
    globalSession.endTime = Date.now();
    logToSession('Agent execution completed successfully', 'text');
  } catch (error: any) {
    // Handle errors
    if (globalSession) {
      globalSession.status = 'error';
      globalSession.error = error.message || 'Unknown error';
      globalSession.endTime = Date.now();
      logToSession(`Error: ${globalSession.error}`, 'text');
    }
  }
}
