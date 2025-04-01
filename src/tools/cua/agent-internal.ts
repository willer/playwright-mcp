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

import type { PlaywrightComputer } from './computer';

// Interface definitions for test access
export interface ComputerOutput {
  type: string;
  image_url: string;
  current_url?: string;
}

// Explicitly define the input_image type for type safety
export interface InputImageOutput extends ComputerOutput {
  type: 'input_image';
  current_url?: string;
}

export interface ComputerErrorOutput {
  type: string;
  error: string;
}

export interface ComputerCallOutput {
  type: string;
  call_id: string;
  acknowledged_safety_checks: any[];
  output: ComputerOutput | ComputerErrorOutput;
}

export interface ComputerAction {
  type: string;
  [key: string]: any;
}

export interface SessionInfo {
  sessionId: string;
  computer: PlaywrightComputer;
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  error?: string;
  logs: string[];
  images: string[];
  items: any[]; // Track all items in the session
  runningTime?: number;
}

/**
 * Creates a response using the OpenAI responses API for Computer Use Agent
 * Exposed for testing
 */
export async function createResponse(kwargs: Record<string, any>): Promise<any> {
  const url = "https://api.openai.com/v1/responses";
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };

  // Add organization header if present
  const openaiOrg = process.env.OPENAI_ORG;
  if (openaiOrg) {
    headers["Openai-Organization"] = openaiOrg;
  }

  try {
    // Log the payload for debugging (with sensitive data redacted)
    const debugPayload = { ...kwargs };
    if (debugPayload.input) {
      debugPayload.input = debugPayload.input.map((item: any) => {
        if (item.content && typeof item.content === 'string' && item.content.length > 50) {
          return { ...item, content: item.content.substring(0, 50) + '...' };
        }
        return item;
      });
    }
    console.error(`Sending payload to OpenAI - model: ${debugPayload.model}, items: ${debugPayload.input?.length || 0}`);
    
    // For actual API calls, we'd use fetch here
    // But for our test module, we'll just return a mock result
    // The actual implementation will be replaced in tests

    throw new Error('This is a test module - createResponse should be mocked');
  } catch (error: any) {
    console.error('Error calling OpenAI API:', error);
    throw error;
  }
}

/**
 * Handles each item returned from the OpenAI responses API
 * Exposed for testing
 */
export async function handleItem(
  item: any, 
  computer: PlaywrightComputer, 
  sessionId: string, 
  activeSessions: Map<string, SessionInfo>
): Promise<any[]> {
  const sessionInfo = activeSessions.get(sessionId);
  if (!sessionInfo) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (item.type === 'message') {
    // Handle messages
    const messageText = item.content[0]?.text || 'No message content';
    console.error(`[${sessionId}] Message: ${messageText}`);
    sessionInfo.logs.push(`Message: ${messageText}`);
    return [];
  }

  if (item.type === 'tool_call') {
    // Handle tool calls from the CUA model
    console.error(`[${sessionId}] Received tool_call - id: ${item.id || 'missing-id'}, function: ${item.function?.name || 'unknown'}`);
    
    if (item.function && item.function.name === 'computer') {
      try {
        // Parse the computer action from the function arguments
        let args;
        try {
          args = JSON.parse(item.function.arguments);
        } catch (parseError) {
          console.error(`Error parsing tool call arguments: ${parseError}`);
          throw new Error(`Invalid tool call arguments: ${parseError}`);
        }
        
        if (!args || !args.action || !args.action.type) {
          throw new Error('Invalid computer action: missing type');
        }
        
        const action = args.action;
        const actionType = action.type;
        const actionArgs = Object.fromEntries(
          Object.entries(action).filter(([key]) => key !== 'type')
        );
        
        console.error(`[${sessionId}] Computer action: ${actionType} with ${Object.keys(actionArgs).length} args`);
        sessionInfo.logs.push(`Action: ${actionType} with args: ${Object.keys(actionArgs).join(', ')}`);
        
        // Execute the action on the computer
        await (computer as any)[actionType](...Object.values(actionArgs));
        
        // Take a screenshot after the action
        const screenshotBase64 = await computer.screenshot();
        
        // Build the call output with proper tool_result type
        const tool_call_id = item.id || item.call_id;
        
        // Ensure we actually have a tool_call_id
        if (!tool_call_id) {
          console.error(`[${sessionId}] Missing tool_call_id in item:`, item);
          throw new Error('Missing tool_call_id in tool_call item');
        }
        
        console.error(`[${sessionId}] Responding to tool_call_id: ${tool_call_id}`);
        
        const callOutput = {
          type: 'tool_result',
          tool_call_id: tool_call_id,
          output: JSON.stringify({
            browser: {
              screenshot: screenshotBase64,
              current_url: await computer.getCurrentUrl().catch(() => '')
            }
          })
        };
        
        // Store the screenshot in the session
        sessionInfo.images.push(screenshotBase64);
        
        return [callOutput];
      } catch (error: any) {
        console.error(`[${sessionId}] Error executing computer action:`, error);
        sessionInfo.logs.push(`Error: ${error.message || 'Unknown error'}`);
        
        // Return a failed tool result
        const tool_call_id = item.id || item.call_id;
        if (!tool_call_id) {
          console.error(`[${sessionId}] Missing tool_call_id in error handling:`, item);
          throw new Error('Missing tool_call_id in tool_call item during error handling');
        }
        
        return [{
          type: 'tool_result',
          tool_call_id: tool_call_id,
          output: JSON.stringify({ error: error.message || 'Unknown error' })
        }];
      }
    } else {
      console.warn(`[${sessionId}] Unknown tool call: ${item.function?.name}`);
      const tool_call_id = item.id || item.call_id;
      if (!tool_call_id) {
        console.error(`[${sessionId}] Missing tool_call_id for unknown tool:`, item);
        throw new Error('Missing tool_call_id in tool_call item for unknown tool');
      }
      
      return [{
        type: 'tool_result',
        tool_call_id: tool_call_id,
        output: JSON.stringify({ error: `Unsupported tool: ${item.function?.name}` })
      }];
    }
  }
  
  // Backward compatibility with computer_call type
  if (item.type === 'computer_call') {
    try {
      // Extract action details
      const action = item.action;
      const actionType = action.type;
      const actionArgs = Object.fromEntries(
        Object.entries(action).filter(([key]) => key !== 'type')
      );
      
      console.error(`[${sessionId}] ${actionType}(${JSON.stringify(actionArgs)})`);
      sessionInfo.logs.push(`Action: ${actionType}(${JSON.stringify(actionArgs)})`);
      
      // Execute the action on the computer
      await (computer as any)[actionType](...Object.values(actionArgs));
      
      // Take a screenshot after the action
      const screenshotBase64 = await computer.screenshot();
      
      // Build the call output
      const callOutput: ComputerCallOutput = {
        type: 'computer_call_output',
        call_id: item.call_id,
        acknowledged_safety_checks: item.pending_safety_checks || [],
        output: {
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${screenshotBase64}`,
          current_url: ''
        }
      };
      
      // Add current URL for browser environments
      const currentUrl = await computer.getCurrentUrl();
      (callOutput.output as ComputerOutput).current_url = currentUrl;
      
      // Store the screenshot in the session
      sessionInfo.images.push(screenshotBase64);
      
      return [callOutput];
    } catch (error: any) {
      console.error(`[${sessionId}] Error executing computer action:`, error);
      sessionInfo.logs.push(`Error: ${error.message || 'Unknown error'}`);
      
      // Return a failed action output
      return [{
        type: 'computer_call_output',
        call_id: item.call_id,
        acknowledged_safety_checks: [],
        output: {
          type: 'error',
          error: error.message
        }
      }];
    }
  }

  return [];
}

/**
 * Runs the Computer Use Agent loop
 * Exposed for testing
 */
export async function runComputerAgent(
  sessionId: string, 
  computer: PlaywrightComputer, 
  instructions: string,
  activeSessions: Map<string, SessionInfo> = new Map(),
  responseFunction: any = createResponse
): Promise<void> {
  const sessionInfo = activeSessions.get(sessionId);
  if (!sessionInfo) {
    throw new Error(`Session ${sessionId} not found`);
  }

  try {
    // Setup basic browser parameters
    const browserCapabilities = await computer.getBrowserCapabilities();
    
    // Take an initial screenshot
    const initialScreenshot = await computer.screenshot();
    sessionInfo.images.push(initialScreenshot);
    
    // Define the browser environment
    const browserEnvironment = "browser";
    
    // Define the tools for the API using the proper format for the Computer Use Agent tool API
    const tools = [
      {
        type: "function",
        name: "computer",
        function: {
          name: "computer",
          description: "Execute a computer action",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["click", "type", "navigate", "press", "scroll", "doubleClick", "wait", "move", "drag"],
                    description: "The type of action to perform"
                  }
                },
                required: ["type"]
              }
            },
            required: ["action"]
          }
        }
      }
    ];
    
    // Define the initial input with user instructions
    const items: any[] = [
      { role: 'user', content: instructions }
    ];
    
    // Store items in the session
    sessionInfo.items = items;
    
    // Start the loop
    sessionInfo.logs.push('Starting Computer Use Agent loop');
    
    // Loop until we get a message back or encounter an error
    let loopCount = 0;
    const maxLoops = 5; // Short for testing
    
    while (sessionInfo.status === 'running' && loopCount < maxLoops) {
      loopCount++;
      
      try {
        // Create the payload for the API
        const kwargs = {
          model: 'computer-use-preview',
          input: items,
          tools: tools,
          truncation: 'auto'
        };
        
        // Call the create_response function, which is replaced in tests
        const response = await responseFunction(kwargs);
        
        if (!response.output) {
          throw new Error('No output from model');
        }
        
        // Add response outputs to the conversation
        items.push(...response.output);
        
        // Process each output item
        for (const item of response.output) {
          // Process the item and get any outputs
          const outputs = await handleItem(item, computer, sessionId, activeSessions);
          
          // Add outputs to the conversation
          items.push(...outputs);
        }
        
        // Check if we have a final message (assistant response ends the loop)
        const hasCompletedMessage = items.length > 0 && items[items.length - 1].role === 'assistant';
        
        if (hasCompletedMessage) {
          sessionInfo.status = 'completed';
          sessionInfo.logs.push('Task completed successfully');
          break;
        }
      } catch (error: any) {
        console.error(`Error in agent loop (${loopCount}):`, error);
        sessionInfo.logs.push(`Error: ${error.message || 'Unknown error'}`);
        sessionInfo.status = 'error';
        sessionInfo.error = error.message || 'Unknown error';
        break;
      }
    }
    
    // Set end time and running time
    sessionInfo.endTime = Date.now();
    sessionInfo.runningTime = sessionInfo.endTime - sessionInfo.startTime;
    
    // If we reached the max loops, set status to error
    if (loopCount >= maxLoops && sessionInfo.status === 'running') {
      sessionInfo.status = 'error';
      sessionInfo.error = 'Reached maximum number of loop iterations';
    }
    
    sessionInfo.logs.push(`Agent ${sessionInfo.status} after ${sessionInfo.runningTime}ms`);
  } catch (error: any) {
    console.error(`Error running agent ${sessionId}:`, error);
    sessionInfo.status = 'error';
    sessionInfo.error = error.message || 'Unknown error';
    sessionInfo.endTime = Date.now();
    sessionInfo.runningTime = sessionInfo.endTime - sessionInfo.startTime;
  }
}