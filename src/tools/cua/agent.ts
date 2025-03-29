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
  stepsTotal?: number;
  stepsCompleted?: number;
  currentAction?: string;
  timeoutId?: NodeJS.Timeout;
}

// Session storage - keeps track of active sessions in memory
const sessions = new Map<string, SessionData>();

// Log a message to the specified session with optional content
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

// OpenAI Computer Use Agent client
class ComputerUseAgent {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async callOpenAIAPI(payload: any): Promise<any> {
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
            if (parsedData.error) {
              reject(new Error(`OpenAI API error: ${parsedData.error.message}`));
              return;
            }
            resolve(parsedData);
          } catch (e: any) {
            console.error('Error parsing OpenAI response:', e);
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
      });

      req.on('error', (e: Error) => {
        console.error('OpenAI API request error:', e);
        reject(new Error(`API request failed: ${e.message}`));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Run the Computer Use Agent with the given instructions
   */
  async runComputerAgent(sessionId: string, computer: PlaywrightComputer, instructions: string): Promise<void> {
    logToSession(sessionId, `Processing instructions with Computer Use Agent: ${instructions}`, 'text');
    
    // Get initial screenshot for the Computer Use Agent
    const screenshot = await computer.screenshot();
    logToSession(sessionId, 'Captured initial screenshot', 'image', screenshot);
    
    // Get session for tracking
    const sessionData = sessions.get(sessionId);
    if (!sessionData) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Set up browser capabilities
      const browserInfo = await computer.getBrowserCapabilities();
      
      // Create the payload for the Computer Use Agent
      const payload = {
        model: 'computer-use-preview',
        messages: [
          { 
            role: 'system', 
            content: 'You are a helpful computer control assistant that helps users with browser tasks.'
          },
          { 
            role: 'user', 
            content: instructions
          }
        ],
        tools: [
          {
            type: 'computer',
            computer: {
              type: 'browser',
              screen: {
                width: browserInfo.width,
                height: browserInfo.height
              }
            }
          }
        ],
        tool_choice: { type: 'computer' }
      };
      
      logToSession(sessionId, 'Sending request to Computer Use Agent API', 'text');
      
      // Initialize variables to track our progress
      let toolExecutionComplete = false;
      let lastResponseMessage = null;
      let continuationToken = null;
      sessionData.stepsTotal = 0;  // Will be updated as we get actions
      sessionData.stepsCompleted = 0;
      
      // Loop until the agent completes the task or we encounter an error
      while (!toolExecutionComplete) {
        // If we have a continuation token, add it to the request
        const requestPayload = {...payload};
        if (continuationToken) {
          requestPayload.tool_continuation = {
            prompt_index: 0,
            tool_index: 0,
            continuation_token: continuationToken
          };
        }
        
        // Send the request to the OpenAI API
        const response = await this.callOpenAIAPI(requestPayload);
        
        if (!response.choices || response.choices.length === 0) {
          throw new Error('No response choices from the Computer Use Agent API');
        }
        
        const choice = response.choices[0];
        lastResponseMessage = choice.message;
        
        // Check if there's a tool call in the response
        if (lastResponseMessage.tool_calls && lastResponseMessage.tool_calls.length > 0) {
          const toolCall = lastResponseMessage.tool_calls[0];
          
          // Execute computer actions based on the tool call
          if (toolCall.type === 'computer') {
            const computerActions = toolCall.computer.actions;
            
            if (computerActions && computerActions.length > 0) {
              // Update step count for progress tracking
              sessionData.stepsTotal += computerActions.length;
              
              // Log the actions we're about to execute
              logToSession(sessionId, `Received ${computerActions.length} actions from Computer Use Agent`, 'text');
              
              // Perform each action
              for (const action of computerActions) {
                // Update the current action in the session
                sessionData.currentAction = JSON.stringify(action);
                logToSession(sessionId, `Executing action: ${sessionData.currentAction}`, 'text');
                
                try {
                  // Execute the action based on its type
                  switch (action.type) {
                    case 'click':
                      await computer.click(action.coordinates.x, action.coordinates.y);
                      break;
                    case 'type':
                      await computer.type(action.text);
                      break;
                    case 'keypress':
                      await computer.press(action.key);
                      break;
                    case 'navigate':
                      await computer.navigate(action.url);
                      break;
                    case 'scroll':
                      await computer.scroll(
                        action.coordinates.x, 
                        action.coordinates.y, 
                        action.delta_x || 0, 
                        action.delta_y || 0
                      );
                      break;
                    default:
                      logToSession(sessionId, `Unsupported action type: ${action.type}`, 'text');
                      continue;
                  }
                  
                  // Take a screenshot after each action to show progress
                  const actionScreenshot = await computer.screenshot();
                  logToSession(sessionId, `Screenshot after ${action.type} action`, 'image', actionScreenshot);
                  
                  // Update progress
                  sessionData.stepsCompleted++;
                  
                } catch (actionError: any) {
                  logToSession(sessionId, `Error executing action: ${actionError.message}`, 'text');
                  console.error(`Error executing action ${action.type}:`, actionError);
                  throw actionError;
                }
              }
              
              // Check if we need to continue or if we're done
              if (toolCall.computer.continuation_token) {
                continuationToken = toolCall.computer.continuation_token;
                logToSession(sessionId, 'More actions pending, continuing execution', 'text');
              } else {
                toolExecutionComplete = true;
                logToSession(sessionId, 'All actions completed successfully', 'text');
              }
            } else {
              // No actions were provided, so we're done
              toolExecutionComplete = true;
              logToSession(sessionId, 'Computer Use Agent completed (no actions)', 'text');
            }
          } else {
            throw new Error(`Unexpected tool call type: ${toolCall.type}`);
          }
        } else {
          // No tool calls in the response, so we're done
          toolExecutionComplete = true;
          
          // If there's content in the message, log it
          if (lastResponseMessage.content) {
            logToSession(sessionId, `Computer Use Agent message: ${lastResponseMessage.content}`, 'text');
          } else {
            logToSession(sessionId, 'Computer Use Agent completed (no message)', 'text');
          }
        }
      }
      
      // Log the final result
      if (lastResponseMessage && lastResponseMessage.content) {
        logToSession(sessionId, `Final message from Computer Use Agent: ${lastResponseMessage.content}`, 'text');
      }
      
    } catch (error: any) {
      console.error(`Computer Use Agent error for session ${sessionId}:`, error);
      logToSession(sessionId, `Error in Computer Use Agent: ${error.message}`, 'text');
      throw error;
    }
  }
}

// Agent start schema
const agentStartSchema = z.object({
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

    // Verify that the required API key is available
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'No OpenAI API key found in environment (OPENAI_API_KEY)' }) }],
        isError: true,
      };
    }

    /* Initialize the agent session */
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
    // Note: This isn't test code; it's part of tool implementation, so setTimeout is appropriate
    const agentTimeoutId = setTimeout(() => executeAgent(context, sessionId, apiKey), 0);
    // Store the timeout ID in the session for potential cancellation
    session.timeoutId = agentTimeoutId;

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
    // Note: This isn't test code; it's part of tool implementation, so setTimeout is appropriate
    if (waitSeconds > 0 && (session.status === 'starting' || session.status === 'running')) {
      await new Promise(resolve => {
        const waitTimeoutId = setTimeout(resolve, waitSeconds * 1000);
        /* Ensures timeout resources are cleaned up when promise resolves */
        return () => clearTimeout(waitTimeoutId);
      });
    }


    // Get the updated session status after waiting
    const updatedSession = sessions.get(sessionId);

    // Calculate progress percentage if running
    let progress = 0;
    if (updatedSession?.status === 'running' &&
        updatedSession?.stepsTotal &&
        updatedSession?.stepsTotal > 0) {
      progress = Math.min(
          Math.floor((updatedSession.stepsCompleted || 0) / updatedSession.stepsTotal * 100),
          99  // Cap at 99% until complete
      );
    } else if (updatedSession?.status === 'completed') {
      progress = 100;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          sessionId,
          status: updatedSession?.status || 'unknown',
          runningTime: Date.now() - (updatedSession?.startTime || 0),
          progress,
          currentAction: updatedSession?.currentAction || ''
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
    description: 'Get the text logs of an agent session without images',
    inputSchema: zodToJsonSchema(agentLogSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentLogSchema.parse(params);
    const { sessionId } = validatedParams;

    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }],
        isError: true,
      };
    }

    // Create content items for each log entry - only include text logs, never images
    const content = [];

    for (const log of session.logs) {
      // Only add text entries, skip images entirely
      if (log.contentType === 'text') {
        content.push({ type: 'text' as const, text: `[${log.timestamp}] ${log.message}` });
      }
    }

    // Add summary at the end
    let progress = 0;
    if (session.stepsTotal && session.stepsTotal > 0) {
      progress = Math.floor((session.stepsCompleted || 0) / session.stepsTotal * 100);
    }

    content.push({
      type: 'text' as const,
      text: `\nSession status: ${session.status}` +
            (session.error ? `\nError: ${session.error}` : '') +
            (progress > 0 ? `\nProgress: ${progress}%` : '') +
            (session.currentAction ? `\nCurrent/Last action: ${session.currentAction}` : '') +
            `\nRunning time: ${((session.endTime || Date.now()) - session.startTime) / 1000}s`
    });

    return { content };
  },
};

// Agent get last image schema
const agentGetLastImageSchema = z.object({
  sessionId: z.string().describe('Session ID returned from agent_start'),
});

export const agentGetLastImage: Tool = {
  schema: {
    name: 'agent_get_last_image',
    description: 'Get the most recent screenshot from an agent session',
    inputSchema: zodToJsonSchema(agentGetLastImageSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentGetLastImageSchema.parse(params);
    const { sessionId } = validatedParams;

    const session = sessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }],
        isError: true,
      };
    }

    // Find the last image in the session logs
    const imageLogs = session.logs.filter(log => log.contentType === 'image');

    if (imageLogs.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'No screenshots available in this session' }) }],
        isError: true,
      };
    }

    // Get the most recent image
    const lastImage = imageLogs[imageLogs.length - 1];

    return {
      content: [
        {
          type: 'image' as const,
          data: lastImage.content,
          mimeType: 'image/jpeg'
        },
        { type: 'text' as const, text: `Screenshot taken at: ${lastImage.timestamp}\nMessage: ${lastImage.message}` }
      ],
    };
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

// Execute agent tasks within a browser environment
async function executeAgent(context: Context, sessionId: string, apiKey: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`Agent execution failed: Session ${sessionId} not found`);
    return;
  }

  try {
    // Update status to running and track steps remaining
    session.status = 'running';
    session.stepsTotal = 0;  // Will be updated as we get actions
    session.stepsCompleted = 0;
    logToSession(sessionId, 'Agent execution started', 'text');

    // Create a computer instance
    const computer = new PlaywrightComputer(context);
    session.computer = computer;

    // Initialize the Computer Use Agent client
    const computerUseAgent = new ComputerUseAgent(apiKey);

    // Execute the agent with instructions
    await computerUseAgent.runComputerAgent(sessionId, computer, session.instructions);

    // Complete the session
    session.status = 'completed';
    session.endTime = Date.now();
    logToSession(sessionId, 'Agent execution completed successfully', 'text');
  } catch (error: any) {
    // Handle errors
    console.error(`Agent execution error for session ${sessionId}:`, error);
    logToSession(sessionId, `Error encountered: ${error.message || 'Unknown error'}`, 'text');
    logToSession(sessionId, `Error stack: ${error.stack || 'No stack trace available'}`, 'text');

    try {
      // Attempt to take a screenshot to help with debugging if computer exists
      if (session.computer) {
        const finalScreenshot = await session.computer.screenshot();
        if (finalScreenshot) {
          logToSession(sessionId, 'Final state screenshot before error', 'image', finalScreenshot);
        }
      }
    } catch (screenshotError: any) {
      console.error(`Failed to capture error screenshot for session ${sessionId}:`, screenshotError);
      logToSession(sessionId, `Failed to capture error screenshot: ${screenshotError.message}`, 'text');
    }

    session.status = 'error';
    session.error = error.message || 'Unknown error';
    session.endTime = Date.now();
  }
}