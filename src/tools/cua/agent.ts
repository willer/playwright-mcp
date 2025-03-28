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
import { v4 as uuidv4 } from 'uuid';
import type { Tool, ToolResult } from '../tool';
import type { Context } from '../../context';
import { PlaywrightComputer } from './computer';

// Session status types
type SessionStatus = 'starting' | 'running' | 'completed' | 'error';

// Session data structure
interface SessionData {
  id: string;
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
  computer?: PlaywrightComputer;
}

// In-memory storage for sessions
const sessions = new Map<string, SessionData>();

// Helper function to log to a session
function logToSession(sessionId: string, message: string, contentType: 'text' | 'image' = 'text', content: string = ''): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  session.logs.push({
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
      
      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
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
  async runComputerAgent(sessionId: string, computer: PlaywrightComputer, instructions: string): Promise<void> {
    logToSession(sessionId, `Processing instructions with AI: ${instructions}`, 'text');
    
    // Get initial screenshot
    const screenshot = await computer.screenshot();
    logToSession(sessionId, 'Captured initial screenshot', 'image', screenshot);
    
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
          ]}
        ],
        max_tokens: 2000
      });
      
      logToSession(sessionId, 'Received AI response', 'text');
      
      if (response.choices && response.choices.length > 0) {
        const agentResponse = response.choices[0].message.content;
        logToSession(sessionId, `Agent's plan: ${agentResponse}`, 'text');
        
        // Execute the plan by parsing the response and performing actions
        await this.executeActions(sessionId, computer, agentResponse);
      } else {
        throw new Error('No response from the OpenAI API');
      }
    } catch (error: any) {
      logToSession(sessionId, `Error in AI processing: ${error.message}`, 'text');
      throw error;
    }
  }
  
  // Execute the actions described by the AI
  async executeActions(sessionId: string, computer: PlaywrightComputer, agentResponse: string): Promise<void> {
    // Parse the response to identify actions
    const lines = agentResponse.split('\n');
    
    for (const line of lines) {
      // Look for function-like commands in the text
      if (line.includes('screenshot()')) {
        logToSession(sessionId, 'Taking screenshot', 'text');
        const screenshot = await computer.screenshot();
        logToSession(sessionId, 'Screenshot taken', 'image', screenshot);
      } else if (line.match(/click\(\s*\d+\s*,\s*\d+\s*\)/)) {
        const match = line.match(/click\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (match) {
          const x = parseInt(match[1]);
          const y = parseInt(match[2]);
          logToSession(sessionId, `Clicking at (${x}, ${y})`, 'text');
          await computer.click(x, y);
        }
      } else if (line.match(/type\(['"](.*)['"]\)/)) {
        const match = line.match(/type\(['"](.*)['"](?:,\s*(\d+))?\)/);
        if (match) {
          const text = match[1];
          logToSession(sessionId, `Typing text: ${text}`, 'text');
          await computer.type(text);
        }
      } else if (line.match(/press\(['"](.*)['"]\)/)) {
        const match = line.match(/press\(['"](.*)['"](?:,\s*(\d+))?\)/);
        if (match) {
          const key = match[1];
          logToSession(sessionId, `Pressing key: ${key}`, 'text');
          await computer.press(key);
        }
      } else if (line.match(/wait\(\s*\d+\s*\)/)) {
        const match = line.match(/wait\(\s*(\d+)\s*\)/);
        if (match) {
          const ms = parseInt(match[1]);
          logToSession(sessionId, `Waiting for ${ms}ms`, 'text');
          await computer.wait(ms);
        }
      } else if (line.match(/navigate\(['"](.*)['"](?:,\s*(\d+))?\)/)) {
        const match = line.match(/navigate\(['"](.*)['"](?:,\s*(\d+))?\)/);
        if (match) {
          const url = match[1];
          logToSession(sessionId, `Navigating to: ${url}`, 'text');
          await computer.navigate(url);
        }
      }
      
      // Capture screenshot after each step to show progress
      const screenshot = await computer.screenshot();
      logToSession(sessionId, 'Screenshot after action', 'image', screenshot);
    }
  }
}

// Agent start schema
const agentStartSchema = z.object({
  instructions: z.string().describe('Instructions for the agent to follow'),
  apiKey: z.string().describe('OpenAI API key for the agent'),
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
    
    // Create a new session
    const sessionId = uuidv4();
    const session: SessionData = {
      id: sessionId,
      status: 'starting',
      instructions: validatedParams.instructions,
      logs: [],
      startTime: Date.now(),
    };
    
    sessions.set(sessionId, session);
    
    // Log the start of the session
    logToSession(sessionId, 'Agent session started', 'text');
    
    // Start the agent execution in the background
    setTimeout(() => executeAgent(context, sessionId, validatedParams.apiKey), 0);
    
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({ sessionId, status: session.status }) 
      }],
    };
  },
};

// Agent status schema
const agentStatusSchema = z.object({
  sessionId: z.string().describe('Session ID returned from agent_start'),
  waitSeconds: z.number().optional().describe('Time in seconds to wait for completion'),
});

export const agentStatus: Tool = {
  schema: {
    name: 'agent_status',
    description: 'Check the status of a running agent session',
    inputSchema: zodToJsonSchema(agentStatusSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentStatusSchema.parse(params);
    const { sessionId, waitSeconds = 0 } = validatedParams;
    
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }],
        isError: true,
      };
    }
    
    // If wait time is specified and session is still running, wait
    if (waitSeconds > 0 && (session.status === 'starting' || session.status === 'running')) {
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
    }
    
    // Get the updated session status after waiting
    const updatedSession = sessions.get(sessionId);
    
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({ 
          sessionId, 
          status: updatedSession?.status || 'unknown',
          runningTime: Date.now() - (updatedSession?.startTime || 0)
        }) 
      }],
    };
  },
};

// Agent log schema
const agentLogSchema = z.object({
  sessionId: z.string().describe('Session ID returned from agent_start'),
  includeImages: z.boolean().optional().describe('Whether to include images in the log'),
});

export const agentLog: Tool = {
  schema: {
    name: 'agent_log',
    description: 'Get the complete log of an agent session',
    inputSchema: zodToJsonSchema(agentLogSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentLogSchema.parse(params);
    const { sessionId, includeImages = true } = validatedParams;
    
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }],
        isError: true,
      };
    }
    
    // Create content items for each log entry
    const content = [];
    
    for (const log of session.logs) {
      if (log.contentType === 'image' && includeImages) {
        content.push({ type: 'image' as const, data: log.content, mimeType: 'image/jpeg' });
      }
      content.push({ type: 'text' as const, text: `[${log.timestamp}] ${log.message}` });
    }
    
    // Add summary at the end
    content.push({ 
      type: 'text' as const, 
      text: `\nSession status: ${session.status}` + 
            (session.error ? `\nError: ${session.error}` : '') +
            `\nRunning time: ${((session.endTime || Date.now()) - session.startTime) / 1000}s`
    });
    
    return { content };
  },
};

// Agent end schema
const agentEndSchema = z.object({
  sessionId: z.string().describe('Session ID returned from agent_start'),
});

export const agentEnd: Tool = {
  schema: {
    name: 'agent_end',
    description: 'Forcefully end an agent session',
    inputSchema: zodToJsonSchema(agentEndSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentEndSchema.parse(params);
    const { sessionId } = validatedParams;
    
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }],
        isError: true,
      };
    }
    
    // Clean up resources
    if (session.computer) {
      await session.computer.close();
    }
    
    // Update session status
    session.status = 'completed';
    session.endTime = Date.now();
    
    // Log the end of the session
    logToSession(sessionId, 'Agent session forcefully ended', 'text');
    
    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify({ 
          sessionId, 
          status: 'completed', 
          message: 'Session forcefully ended' 
        }) 
      }],
    };
  },
};

// This function handles the actual agent execution
async function executeAgent(context: Context, sessionId: string, apiKey: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  try {
    // Update status to running
    session.status = 'running';
    logToSession(sessionId, 'Agent execution started', 'text');
    
    // Create a computer instance
    const computer = new PlaywrightComputer(context);
    session.computer = computer;
    
    // Initialize the OpenAI client
    const openAIClient = new OpenAIClient(apiKey);
    
    // Execute the agent with instructions
    await openAIClient.runComputerAgent(sessionId, computer, session.instructions);
    
    // Complete the session
    session.status = 'completed';
    session.endTime = Date.now();
    logToSession(sessionId, 'Agent execution completed successfully', 'text');
  } catch (error: any) {
    // Handle errors
    session.status = 'error';
    session.error = error.message || 'Unknown error';
    session.endTime = Date.now();
    logToSession(sessionId, `Error: ${session.error}`, 'text');
  }
}