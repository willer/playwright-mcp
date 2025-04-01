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

// Import constants for blocked domains from a common file
import { BLOCKED_DOMAINS } from '../blocked-domains';

// CUA session types and interfaces
interface CUAMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CUAComputerCall {
  type: 'computer_call';
  call_id: string;
  action: {
    type: string;
    [key: string]: any;
  };
  pending_safety_checks?: Array<{ message: string }>;
}

interface CUAComputerCallOutput {
  type: 'computer_call_output';
  call_id: string;
  acknowledged_safety_checks?: Array<{ message: string }>;
  output: {
    type: 'input_image';
    image_url: string;
    current_url?: string;
  };
}

interface CUAMessageItem {
  type: 'message';
  content: [{
    type: 'text';
    text: string;
  }];
}

type CUAItem = CUAMessage | CUAComputerCall | CUAComputerCallOutput | CUAMessageItem;

interface CUAResponse {
  output: CUAItem[];
}

// Session data structure
interface SessionData {
  items: CUAItem[];
  status: 'starting' | 'running' | 'completed' | 'error';
  images: string[]; // Base64 encoded screenshots
  logs: string[]; // Text logs for debugging
  error?: string;
  startTime: number;
  endTime?: number;
  runningTime?: number;
}

// Map of session IDs to sessions
const sessions: Map<string, SessionData> = new Map();

// Generate a unique session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// Check if a URL is blocklisted
function checkBlocklistedUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname || '';
    return BLOCKED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch (error) {
    return false;
  }
}

// OpenAI API client for the Computer Use Agent interactions
class OpenAIClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // Create a response using the OpenAI API's CUA model
  async createCUAResponse(input: CUAItem[], tools: any[]): Promise<CUAResponse> {
    // Define the OpenAI API endpoint for CUA
    const apiUrl = 'https://api.openai.com/v1/responses';
    
    // Prepare the request data
    const requestData = {
      model: 'computer-use-preview',
      input,
      tools,
      truncation: 'auto'
    };

    // Make the API request
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(requestData);

      const options = {
        hostname: 'api.openai.com',
        path: '/v1/responses',
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
            
            // Log the response for debugging
            console.error(`CUA API response status code: ${res.statusCode}`);
            
            // Error handling for different response types
            if (res.statusCode !== 200) {
              console.error(`API Error: ${JSON.stringify(parsedData)}`);
              reject(new Error(`API Error (${res.statusCode}): ${parsedData.error?.message || 'Unknown error'}`));
              return;
            }
            
            if (!parsedData.output) {
              console.error(`No output from model: ${JSON.stringify(parsedData)}`);
              reject(new Error(`No output from model: ${JSON.stringify(parsedData)}`));
              return;
            }
            
            resolve(parsedData);
          } catch (e: any) {
            console.error(`Failed to parse response: ${e.message}, raw response: ${responseData.substring(0, 200)}...`);
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
}

// Handle a computer call from the CUA
async function handleComputerCall(
  item: CUAComputerCall, 
  computer: PlaywrightComputer, 
  session: SessionData
): Promise<CUAComputerCallOutput[]> {
  const action = item.action;
  const actionType = action.type;
  
  // Log the action for debugging
  console.error(`Processing CUA action: ${actionType}(${JSON.stringify(action)})`);
  session.logs.push(`Processing action: ${actionType}(${JSON.stringify(action)})`);
  
  // Check for any pending safety checks
  const pendingChecks = item.pending_safety_checks || [];
  
  // Execute the requested computer action
  try {
    switch (actionType) {
      case 'click':
        await computer.click(action.x, action.y, action.button || 'left');
        break;
      case 'double_click':
        await computer.doubleClick(action.x, action.y);
        break;
      case 'type':
        await computer.type(action.text);
        break;
      case 'keypress':
        if (Array.isArray(action.keys)) {
          console.error(`Processing keypress with keys: ${JSON.stringify(action.keys)}`);
          
          // Handle keypress with multiple keys (keyboard shortcuts)
          const page = await computer.getPage();
          
          // Press all keys down in sequence
          for (const key of action.keys) {
            console.error(`Pressing down: ${key}`);
            await page.keyboard.down(key);
          }
          
          // Release keys in reverse order
          for (let i = action.keys.length - 1; i >= 0; i--) {
            console.error(`Releasing: ${action.keys[i]}`);
            await page.keyboard.up(action.keys[i]);
          }
        } else if (action.key) {
          // Handle single key
          await computer.press(action.key);
        }
        break;
      case 'press':
        await computer.press(action.key);
        break;
      case 'wait':
        await computer.wait(action.ms);
        break;
      case 'navigate':
      case 'goto':
        await computer.navigate(action.url);
        break;
      case 'move':
        await computer.move(action.x, action.y);
        break;
      case 'scroll':
        // Not directly implemented, but could map to page.mouse.wheel
        break;
      // Could add more actions as needed
    }
  } catch (error: any) {
    session.logs.push(`Error executing action: ${error.message}`);
    console.error(`Error executing CUA action: ${error.message}`);
  }
  
  // Take a screenshot after the action
  const screenshot = await computer.screenshot();
  session.images.push(screenshot);
  
  // Get the current URL for safety checking
  const currentUrl = await computer.getCurrentUrl();
  
  // Check URL against blocklist
  try {
    if (checkBlocklistedUrl(currentUrl)) {
      console.error(`Warning: Blocked URL detected: ${currentUrl}`);
      session.logs.push(`Warning: Blocked URL detected: ${currentUrl}`);
    }
  } catch (error) {
    // URL parsing error, continue
  }
  
  // Return the computer call output
  return [{
    type: 'computer_call_output',
    call_id: item.call_id,
    acknowledged_safety_checks: pendingChecks,
    output: {
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${screenshot}`,
      current_url: currentUrl
    }
  }];
}

// Process items from a CUA response
async function processCUAItems(
  items: CUAItem[], 
  computer: PlaywrightComputer,
  session: SessionData
): Promise<CUAItem[]> {
  const newItems: CUAItem[] = [];
  
  for (const item of items) {
    // Add the item to the session
    session.items.push(item);
    
    // Handle message items
    if ('type' in item && item.type === 'message') {
      console.error(`CUA message: ${JSON.stringify(item.content)}`);
      session.logs.push(`CUA message: ${JSON.stringify(item.content)}`);
    }
    
    // Handle computer call items
    if ('type' in item && item.type === 'computer_call') {
      const callOutputs = await handleComputerCall(item, computer, session);
      session.items.push(...callOutputs);
      newItems.push(...callOutputs);
    }
  }
  
  return newItems;
}

// Run the CUA conversation loop
async function runCUALoop(
  sessionId: string, 
  computer: PlaywrightComputer, 
  apiKey: string
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  try {
    // Set session status to running
    session.status = 'running';
    
    // Get initial screenshot
    const screenshot = await computer.screenshot();
    session.images.push(screenshot);
    
    // Get display dimensions from the computer
    const dimensions = computer.getDimensions();
    
    // Define tools - CUA requires a computer-preview tool
    const tools = [{
      type: 'computer-preview',
      display_width: dimensions.width,
      display_height: dimensions.height,
      environment: 'browser'
    }];
    
    // Create OpenAI client
    const openaiClient = new OpenAIClient(apiKey);
    
    // Initial items need both a call and its output
    const initialItems: CUAItem[] = [
      // First, a computer call for a screenshot
      {
        type: 'computer_call',
        call_id: 'initial_screenshot',
        action: {
          type: 'screenshot'
        }
      },
      // Then, the output of that call
      {
        type: 'computer_call_output',
        call_id: 'initial_screenshot',
        output: {
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${screenshot}`,
          current_url: await computer.getCurrentUrl()
        }
      }
    ];
    
    // Add initial items to session
    session.items.push(...initialItems);
    
    // Create a response loop
    // Create a truncated list for the API calls, mimicking Python's behavior
    let conversationContext: CUAItem[] = [];
    
    // Always include the user's initial instruction
    const userInstruction = session.items.find(item => 'role' in item && item.role === 'user');
    if (userInstruction) {
      conversationContext.push(userInstruction);
    }
    
    // Add the initial screenshot setup
    conversationContext.push(
      // First call
      {
        type: 'computer_call',
        call_id: 'initial_screenshot',
        action: {
          type: 'screenshot'
        }
      },
      // And its output
      {
        type: 'computer_call_output',
        call_id: 'initial_screenshot',
        output: {
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${session.images[0]}`,
          current_url: await computer.getCurrentUrl()
        }
      }
    );
    
    console.error(`Initial context items: ${conversationContext.length}`);
    
    while (session.status === 'running') {
      try {
        // Log what we're sending - avoid sending the full image data to the console
        const debugContext = conversationContext.map(item => {
          if ('type' in item && item.type === 'computer_call_output' && item.output?.image_url) {
            return {
              ...item,
              output: {
                ...item.output,
                image_url: `[image data - ${item.output.image_url.substring(0, 30)}...]`
              }
            };
          }
          return item;
        });
        console.error(`Sending ${conversationContext.length} items to API: ${JSON.stringify(debugContext)}`);
        
        // Create a CUA response with only necessary context
        const response = await openaiClient.createCUAResponse(conversationContext, tools);
        
        // Process the output items
        if (response.output && response.output.length > 0) {
          console.error(`Received ${response.output.length} items from API`);
          
          // Store the full history in the session
          session.items.push(...response.output);
          
          // Check for wait loop (model repeatedly calling wait)
          const waitActions = response.output.filter(item => 
            'type' in item && item.type === 'computer_call' && 
            item.action?.type === 'wait'
          );
          
          // If all actions are waits and we have multiple items, it's likely a wait loop
          const isWaitLoop = waitActions.length === response.output.filter(item => 
            'type' in item && item.type === 'computer_call'
          ).length && waitActions.length > 0;
          
          if (isWaitLoop) {
            console.error("Detected a wait loop - model is only calling wait. Adding a system message to help it break out of the loop.");
            // Add a system message to help break the loop
            session.items.push({
              type: 'message',
              content: [{
                type: 'text',
                text: "I notice you're waiting repeatedly. If you don't see the expected results, try clicking on a visible element or typing a more specific search like 'dish set' in the search box, then press Enter."
              }]
            });
          }
          
          // Process computer calls and get any new outputs
          const newItems = await processCUAItems(response.output, computer, session);
          
          // Reset conversation context for next loop 
          conversationContext = [];
          
          // Always include the user's initial instruction
          if (userInstruction) {
            conversationContext.push(userInstruction);
          }
          
          // Add the most recent items from this round to the next context
          // This mimics how Python adds response.output to items
          conversationContext.push(...response.output);
          
          // Add the latest outputs produced in this round (like screenshots)
          if (newItems.length > 0) {
            conversationContext.push(...newItems);
          }
          
          // Check if we've reached the end of the conversation (no more computer calls)
          const hasComputerCalls = response.output.some(item => 
            'type' in item && item.type === 'computer_call'
          );
          
          if (!hasComputerCalls && response.output.some(item => 'role' in item && item.role === 'assistant')) {
            // End of conversation, update session status
            session.status = 'completed';
            session.endTime = Date.now();
            session.runningTime = session.endTime - session.startTime;
            console.error(`CUA session ${sessionId} completed`);
            break;
          }
        }
      } catch (error: any) {
        session.logs.push(`Error in CUA loop: ${error.message}`);
        console.error(`Error in CUA loop: ${error.message}`);
        
        // If there's an error, we'll continue the loop unless it's terminal
        if (error.message.includes('No output from model') || 
            error.message.includes('Failed to parse response')) {
          session.status = 'error';
          session.error = error.message;
          session.endTime = Date.now();
          session.runningTime = session.endTime - session.startTime;
          break;
        }
      }
    }
  } catch (error: any) {
    // Handle terminal errors
    console.error(`Fatal error in CUA session ${sessionId}: ${error.message}`);
    
    if (session) {
      session.status = 'error';
      session.error = error.message;
      session.endTime = Date.now();
      session.runningTime = session.endTime - session.startTime;
      session.logs.push(`Fatal error: ${error.message}`);
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
    
    // Check if we need to create a browser page
    // Using the same approach as browser_navigate for consistency
    let page;
    let createdNewPage = false;
    
    try {
      // Try to get existing page 
      page = context.existingPage();
    } catch (e) {
      // No page exists, create one exactly like browser_navigate does
      createdNewPage = true;
      
      // If we created a new page and no startUrl was provided, set a default
      if (!validatedParams.startUrl) {
        validatedParams.startUrl = 'https://www.google.com';
      }
    }
    
    // Create a new session
    const sessionId = generateSessionId();
    
    // If startUrl is provided or we need to create a new page, we'll navigate
    if (validatedParams.startUrl || createdNewPage) {
      // Ensure URL has a protocol using our shared utility function
      const url = normalizeUrl(validatedParams.startUrl || 'https://www.google.com');
      
      try {
        // Create or get the page using the same method as browser_navigate
        if (createdNewPage) {
          page = await context.createPage();
          console.error(`Created new browser page for CUA session ${sessionId}`);
        } else {
          page = context.existingPage();
        }
        
        // Use the same waitUntil option as browser_navigate
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        
        // Use same cap on load event as browser_navigate 
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        
        console.error(`Navigated to: ${url} for CUA session ${sessionId}`);
      } catch (error: any) {
        console.error(`Navigation error: ${error.message}`);
      }
    }
    
    // Initialize a new CUA session
    const newSession: SessionData = {
      items: [],
      status: 'starting',
      images: [],
      logs: [`Session ${sessionId} created with instructions: ${validatedParams.instructions}`],
      startTime: Date.now()
    };
    
    // Add the user instruction as the first message
    newSession.items.push({
      role: 'user',
      content: validatedParams.instructions
    });
    
    // Store the session
    sessions.set(sessionId, newSession);
    
    // Start the CUA loop in the background
    // Get OpenAI API key from environment
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      console.error('No OpenAI API key found in environment');
      newSession.status = 'error';
      newSession.error = 'No OpenAI API key found in environment';
      return {
        content: [{ 
          type: 'text' as const, 
          text: JSON.stringify({ 
            error: 'No OpenAI API key found in environment',
            sessionId 
          }) 
        }],
        isError: true,
      };
    }
    
    // Create a computer instance for this session
    const computer = new PlaywrightComputer(context);
    
    // Start the CUA loop in the background
    setTimeout(() => runCUALoop(sessionId, computer, apiKey), 0);
    
    // Return the session ID to the caller
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ 
          sessionId,
          status: 'started',
          message: 'CUA session started successfully'
        })
      }],
    };
  },
};

// Agent status schema
const agentStatusSchema = z.object({
  sessionId: z.string().describe('The ID of the session to check'),
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

    // Get the session
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session ${sessionId} not found` }) }],
        isError: true,
      };
    }

    // If wait time is specified and session is still running, wait
    if (waitSeconds > 0 && (session.status === 'starting' || session.status === 'running')) {
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
    }

    // Get the current status
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          sessionId,
          status: session.status,
          runningTime: session.status === 'running'
            ? Date.now() - session.startTime
            : session.runningTime,
          lastMessage: session.items.length > 0 
            ? session.items[session.items.length - 1] 
            : null,
          error: session.error
        })
      }],
    };
  },
};

// Agent log schema
const agentLogSchema = z.object({
  sessionId: z.string().describe('The ID of the session to get logs for'),
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
    const { sessionId, includeImages = false } = validatedParams;

    // Get the session
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session ${sessionId} not found` }) }],
        isError: true,
      };
    }

    // Prepare the response
    const result: any = {
      sessionId,
      status: session.status,
      logs: session.logs,
      startTime: new Date(session.startTime).toISOString(),
      endTime: session.endTime ? new Date(session.endTime).toISOString() : undefined,
      runningTime: session.status === 'running'
        ? Date.now() - session.startTime
        : session.runningTime,
      error: session.error
    };

    // Include conversation items
    result.items = session.items.map(item => {
      // Sanitize computer_call_output items to omit image data if includeImages is false
      if ('type' in item && item.type === 'computer_call_output' && !includeImages) {
        const sanitized = {...item};
        if (sanitized.output && sanitized.output.image_url) {
          sanitized.output = {...sanitized.output, image_url: '[image omitted]'};
        }
        return sanitized;
      }
      return item;
    });

    // Optionally include images
    if (includeImages) {
      result.images = session.images;
    }

    // Combine into a single content response
    const content = [{ type: 'text' as const, text: JSON.stringify(result) }];
    
    // If includeImages, add the most recent image
    if (includeImages && session.images.length > 0) {
      content.push({
        type: 'image',
        data: session.images[session.images.length - 1],
        mimeType: 'image/jpeg'
      } as any);
    }

    return { content };
  },
};

// Agent end schema
const agentEndSchema = z.object({
  sessionId: z.string().describe('The ID of the session to end'),
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

    // Get the session
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session ${sessionId} not found` }) }],
        isError: true,
      };
    }

    // Get current status before ending
    const previousStatus = session.status;

    // Update session status
    session.status = 'completed';
    session.endTime = Date.now();
    session.runningTime = session.endTime - session.startTime;
    session.logs.push(`Session ${sessionId} forcefully ended`);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          sessionId,
          status: 'ended',
          message: 'Session ended successfully',
          previousStatus
        })
      }],
    };
  },
};

// Get the last image schema
const agentGetLastImageSchema = z.object({
  sessionId: z.string().describe('The ID of the session to get the last image from'),
});

export const agentGetLastImage: Tool = {
  schema: {
    name: 'agent_get_last_image',
    description: 'Get the last screenshot from an agent session',
    inputSchema: zodToJsonSchema(agentGetLastImageSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentGetLastImageSchema.parse(params);
    const { sessionId } = validatedParams;

    // Get the session
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session ${sessionId} not found` }) }],
        isError: true,
      };
    }

    // Check if there are any images
    if (session.images.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `No images available for session ${sessionId}` }) }],
        isError: true,
      };
    }

    // Get the most recent image
    const lastImage = session.images[session.images.length - 1];

    return {
      content: [
        { 
          type: 'text' as const, 
          text: JSON.stringify({
            sessionId,
            status: session.status
          }) 
        },
        {
          type: 'image',
          data: lastImage,
          mimeType: 'image/jpeg'
        } as any
      ],
    };
  },
};

// Agent reply schema
const agentReplySchema = z.object({
  sessionId: z.string().describe('The ID of the session to reply to'),
  replyText: z.string().describe('Text to send to the agent as a reply'),
});

export const agentReply: Tool = {
  schema: {
    name: 'agent_reply',
    description: 'Send a reply to a running agent session to continue the conversation',
    inputSchema: zodToJsonSchema(agentReplySchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentReplySchema.parse(params);
    const { sessionId, replyText } = validatedParams;

    // Get the session
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session ${sessionId} not found` }) }],
        isError: true,
      };
    }

    // Check if the session can accept replies
    if (session.status !== 'completed' && session.status !== 'running') {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session ${sessionId} cannot accept replies (status: ${session.status})` }) }],
        isError: true,
      };
    }

    // Add the user message to the session
    session.items.push({
      role: 'user',
      content: replyText
    });
    
    // Log the reply
    session.logs.push(`User reply: ${replyText}`);
    
    // If the session was completed, restart it
    if (session.status === 'completed') {
      // Set status back to running
      session.status = 'running';
      
      // Get OpenAI API key
      const apiKey = process.env.OPENAI_API_KEY || '';
      if (!apiKey) {
        console.error('No OpenAI API key found in environment');
        session.status = 'error';
        session.error = 'No OpenAI API key found in environment';
        return {
          content: [{ 
            type: 'text' as const, 
            text: JSON.stringify({ 
              error: 'No OpenAI API key found in environment',
              sessionId 
            }) 
          }],
          isError: true,
        };
      }
      
      // Create a computer for this session
      const computer = new PlaywrightComputer(context);
      
      // For replies, we need a special restart that doesn't reinitialize everything
      setTimeout(() => {
        // Create a special function to restart with reply
        const restartWithReply = async (): Promise<void> => {
          const session = sessions.get(sessionId);
          if (!session) return;
          
          try {
            // Set session status to running
            session.status = 'running';
            
            // Get display dimensions from the computer
            const dimensions = computer.getDimensions();
            
            // Define tools - CUA requires a computer-preview tool
            const tools = [{
              type: 'computer-preview',
              display_width: dimensions.width,
              display_height: dimensions.height,
              environment: 'browser'
            }];
            
            // Create OpenAI client
            const openaiClient = new OpenAIClient(apiKey);
            
            // Get the latest screenshot
            const screenshot = await computer.screenshot();
            session.images.push(screenshot);
            
            // Create a conversation context with:
            // 1. The user's initial instruction
            // 2. The most recent user reply
            // 3. The latest screenshot
            let conversationContext: CUAItem[] = session.items
              .filter(item => 'role' in item && item.role === 'user')
              .slice(-2); // Get up to the last 2 user messages
              
            // Add last screenshot
            conversationContext.push(
              {
                type: 'computer_call',
                call_id: `screenshot_${Date.now()}`,
                action: {
                  type: 'screenshot'
                }
              },
              {
                type: 'computer_call_output',
                call_id: `screenshot_${Date.now()}`,
                output: {
                  type: 'input_image',
                  image_url: `data:image/jpeg;base64,${screenshot}`,
                  current_url: await computer.getCurrentUrl()
                }
              }
            );
            
            console.error(`Reply context items: ${conversationContext.length}`);
            
            // The rest of the code is similar to runCUALoop
            while (session.status === 'running') {
              try {
                // Log what we're sending
                const debugContext = conversationContext.map(item => {
                  if ('type' in item && item.type === 'computer_call_output' && item.output?.image_url) {
                    return {
                      ...item,
                      output: {
                        ...item.output,
                        image_url: `[image data - ${item.output.image_url.substring(0, 30)}...]`
                      }
                    };
                  }
                  return item;
                });
                console.error(`Sending ${conversationContext.length} items to API: ${JSON.stringify(debugContext)}`);
                
                // Create a CUA response with only necessary context
                const response = await openaiClient.createCUAResponse(conversationContext, tools);
                
                // Process the output items
                if (response.output && response.output.length > 0) {
                  console.error(`Received ${response.output.length} items from API`);
                  
                  // Store the full history in the session
                  session.items.push(...response.output);
                  
                  // Check for wait loop (model repeatedly calling wait)
                  const waitActions = response.output.filter(item => 
                    'type' in item && item.type === 'computer_call' && 
                    item.action?.type === 'wait'
                  );
                  
                  // If all actions are waits and we have multiple items, it's likely a wait loop
                  const isWaitLoop = waitActions.length === response.output.filter(item => 
                    'type' in item && item.type === 'computer_call'
                  ).length && waitActions.length > 0;
                  
                  if (isWaitLoop) {
                    console.error("Detected a wait loop in reply - model is only calling wait. Adding a system message to help it break out of the loop.");
                    // Add a system message to help break the loop
                    session.items.push({
                      type: 'message',
                      content: [{
                        type: 'text',
                        text: "I notice you're waiting repeatedly. If you don't see the expected results, try clicking on a visible element or typing a more specific search like 'dish set' in the search box, then press Enter."
                      }]
                    });
                  }
                  
                  // Process computer calls and get any new outputs
                  const newItems = await processCUAItems(response.output, computer, session);
                  
                  // Reset conversation context for next loop 
                  conversationContext = [];
                  
                  // Always include the latest user message
                  const latestUserMsg = session.items
                    .filter(item => 'role' in item && item.role === 'user')
                    .pop();
                  if (latestUserMsg) {
                    conversationContext.push(latestUserMsg);
                  }
                  
                  // Add the most recent items from this round to the next context
                  conversationContext.push(...response.output);
                  
                  // Add the latest outputs produced in this round
                  if (newItems.length > 0) {
                    conversationContext.push(...newItems);
                  }
                  
                  // Check if we've reached the end of the conversation
                  const hasComputerCalls = response.output.some(item => 
                    'type' in item && item.type === 'computer_call'
                  );
                  
                  if (!hasComputerCalls && response.output.some(item => 'role' in item && item.role === 'assistant')) {
                    // End of conversation
                    session.status = 'completed';
                    session.endTime = Date.now();
                    session.runningTime = session.endTime - session.startTime;
                    console.error(`CUA session ${sessionId} completed after reply`);
                    break;
                  }
                }
              } catch (error: any) {
                session.logs.push(`Error in CUA reply loop: ${error.message}`);
                console.error(`Error in CUA reply loop: ${error.message}`);
                
                // If there's an error, continue unless terminal
                if (error.message.includes('No output from model') || 
                    error.message.includes('Failed to parse response')) {
                  session.status = 'error';
                  session.error = error.message;
                  session.endTime = Date.now();
                  session.runningTime = session.endTime - session.startTime;
                  break;
                }
              }
            }
          } catch (error: any) {
            console.error(`Fatal error in CUA session ${sessionId}: ${error.message}`);
            
            if (session) {
              session.status = 'error';
              session.error = error.message;
              session.endTime = Date.now();
              session.runningTime = session.endTime - session.startTime;
              session.logs.push(`Fatal error: ${error.message}`);
            }
          }
        };
        
        // Start the reply process
        restartWithReply();
      }, 0);
    }

    return {
      content: [{ 
        type: 'text' as const, 
        text: JSON.stringify({ 
          sessionId,
          status: session.status,
          message: 'Reply sent successfully' 
        }) 
      }],
    };
  },
};
