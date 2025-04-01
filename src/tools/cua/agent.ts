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

import type { Context } from '../../context';
import type { ToolResult } from '../tool';
import { PlaywrightComputer } from './computer';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fetch from 'node-fetch';

// Import the types from agent-internal.ts
import { ComputerOutput, InputImageOutput, ComputerErrorOutput, ComputerCallOutput, ComputerAction, SessionInfo } from './agent-internal';

// Types for the Computer Use Agent API
interface ComputerUseAgentInput {
  role: string;
  content: string;
}

interface ComputerCallItem {
  type: string;
  action: ComputerAction;
  call_id: string;
  pending_safety_checks?: any[];
}

interface MessageItem {
  type: string;
  content: { text: string }[];
}

// SessionInfo already imported from agent-internal.ts

// Store active sessions
const activeSessions: Map<string, SessionInfo> = new Map();

/**
 * Creates a response using the OpenAI responses API for Computer Use Agent
 * Direct port of the Python create_response function with added tool result validation
 */
async function createResponse(kwargs: Record<string, any>, sessionInfo?: SessionInfo): Promise<any> {
  const url = "https://api.openai.com/v1/responses";
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json"
  };

  // Add organization header if present, same as Python code
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
    // Use safer logging - avoid direct JSON.stringify to prevent MCP stderr parsing errors
    console.error(`API request: model=${debugPayload.model}, items=${debugPayload.input?.length || 0}`);
    
    // Let the API handle mismatched tool call/results
    // Simple validation for logging only (not modifying input)
    if (kwargs.input && Array.isArray(kwargs.input)) {
      // Track all tool call IDs and corresponding tool results
      const toolCallIds = new Set<string>();
      const resultIds = new Set<string>();
      
      // First pass: collect all IDs 
      for (const item of kwargs.input) {
        if (item.type === 'tool_call' && item.id) {
          toolCallIds.add(item.id);
        } else if (item.type === 'tool_result' && item.tool_call_id) {
          resultIds.add(item.tool_call_id);
        }
      }
      
      // Log any missing tool results (diagnostic only)
      for (const callId of toolCallIds) {
        if (!resultIds.has(callId)) {
          console.error(`WARNING: Missing tool_result for tool_call ${callId}`);
        }
      }
    }
    
    // Log tool configuration safely 
    if (kwargs.tools && Array.isArray(kwargs.tools)) {
      console.error(`Tools: count=${kwargs.tools.length}`);
      if (kwargs.tools.length > 0) {
        const firstTool = kwargs.tools[0];
        console.error(`First tool: type=${firstTool.type || 'unknown'}, name=${firstTool.name || 'unnamed'}`);
      }
    }
    
    // Log validation info but let API handle errors properly
    if (kwargs.input && Array.isArray(kwargs.input)) {
      // Track tool calls and their responses for logging purposes
      const toolCallIds = new Set<string>();
      const toolResultIds = new Set<string>();
      const computerCallIds = new Set<string>();
      const computerCallOutputIds = new Set<string>();
      
      // Collect all IDs from the conversation
      for (const item of kwargs.input) {
        if (item.type === 'tool_call' && item.id) {
          toolCallIds.add(item.id);
        } else if (item.type === 'tool_result' && item.tool_call_id) {
          toolResultIds.add(item.tool_call_id);
        } else if (item.type === 'computer_call' && item.call_id) {
          computerCallIds.add(item.call_id);
        } else if (item.type === 'computer_call_output' && item.call_id) {
          computerCallOutputIds.add(item.call_id);
        }
      }
      
      // Log any missing responses (for diagnostic purposes)
      for (const callId of toolCallIds) {
        if (!toolResultIds.has(callId)) {
          console.error(`API WARNING: Missing tool_result for tool_call ${callId}`);
        }
      }
      
      for (const callId of computerCallIds) {
        if (!computerCallOutputIds.has(callId)) {
          console.error(`API WARNING: Missing computer_call_output for computer_call ${callId}`);
        }
      }
    }
    
    // Exact equivalent of Python's requests.post(url, headers=headers, json=kwargs)
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(kwargs)
    });

    // Handle response the same way as Python
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error: ${response.status} ${errorText}`);
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    // Parse and log the response for debugging, but don't print JSON directly to console
    const jsonResponse = await response.json() as Record<string, any>;
    
    // Use more careful logging to avoid JSON syntax issues in the console
    if (jsonResponse.output && Array.isArray(jsonResponse.output)) {
      console.error(`API response: items=${jsonResponse.output.length}`);
      
      // Carefully log the first item if available
      if (jsonResponse.output.length > 0) {
        const firstItem = jsonResponse.output[0] as Record<string, any>;
        const itemType = firstItem.type || (firstItem.role ? `role-${firstItem.role}` : 'unknown');
        console.error(`First item: type=${itemType}`);
        
        // Log tool_call details safely without output that could break MCP
        if (itemType === 'tool_call') {
          const id = firstItem.id || 'missing-id';
          const functionName = firstItem.function?.name || 'unknown';
          console.error(`Tool call: id=${id}, function=${functionName}`);
        }
      }
    } else {
      console.error('API response: no output items');
    }

    return jsonResponse;
  } catch (error: any) {
    console.error('Error calling OpenAI API:', error);
    throw error;
  }
}

/**
 * Handles a computer action by calling the appropriate method on the computer instance
 * Following the pattern from sample_cua_loop.py
 */
async function handleAction(action: ComputerAction, computer: PlaywrightComputer, callId: string): Promise<ComputerCallOutput> {
  const actionType = action.type;
  const actionArgs = Object.fromEntries(
    Object.entries(action).filter(([key]) => key !== 'type')
  );

  console.error(`Executing action: ${actionType}(${JSON.stringify(actionArgs)})`);
  
  try {
    // Call the appropriate method on the computer
    await (computer as any)[actionType](...Object.values(actionArgs));
    
    // Take a screenshot after the action
    const screenshot = await computer.screenshot();
    
    // Create screenshot output with proper typing
    const outputObj: InputImageOutput = {
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${screenshot}`,
      current_url: ''
    };
    
    // Add current URL if possible (exactly following sample code pattern)
    try {
      const currentUrl = await computer.getCurrentUrl();
      outputObj.current_url = currentUrl;
    } catch (error) {
      console.error('Error getting current URL:', error);
    }
    
    // Create the complete call output
    const callOutput: ComputerCallOutput = {
      type: 'computer_call_output',
      call_id: callId,
      acknowledged_safety_checks: [],
      output: outputObj
    };
    
    return callOutput;
  } catch (error) {
    console.error(`Error executing action ${actionType}:`, error);
    throw error;
  }
}

/**
 * Handles each item returned from the OpenAI responses API
 * Direct implementation of the Python handle_item function
 */
async function handleItem(item: any, computer: PlaywrightComputer, sessionId: string): Promise<any[]> {
  const sessionInfo = activeSessions.get(sessionId);
  if (!sessionInfo) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Handle messages - direct port of Python implementation
  if (item.type === 'message') {
    const messageText = item.content[0]?.text || 'No message content';
    console.error(`[${sessionId}] Message: ${messageText}`);
    sessionInfo.logs.push(`Message: ${messageText}`);
    return [];
  }

  // Handle computer_call - direct port of Python implementation
  if (item.type === 'computer_call') {
    try {
      // Extract action details exactly as in Python
      const action = item.action;
      const actionType = action.type;
      const actionArgs = Object.fromEntries(
        Object.entries(action).filter(([key]) => key !== 'type')
      );
      
      // Log the action (equivalent to Python's print)
      console.error(`[${sessionId}] ${actionType}(${JSON.stringify(actionArgs)})`);
      sessionInfo.logs.push(`Action: ${actionType}(${JSON.stringify(actionArgs)})`);
      
      // Execute the action on the computer
      await (computer as any)[actionType](...Object.values(actionArgs));
      
      // Take a screenshot after the action
      const screenshotBase64 = await computer.screenshot();
      
      // Get pending safety checks (if any)
      const pendingChecks = item.pending_safety_checks || [];
      
      // Build the call output exactly as in Python
      const callOutput = {
        type: 'computer_call_output',
        call_id: item.call_id,
        acknowledged_safety_checks: pendingChecks,
        output: {
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${screenshotBase64}`
        }
      };
      
      // Add current URL for browser environments
      if (computer.environment === 'browser') {
        try {
          const currentUrl = await computer.getCurrentUrl();
          if (callOutput.output.type === 'input_image') {
            (callOutput.output as InputImageOutput).current_url = currentUrl;
          }
        } catch (error) {
          console.error('Could not get current URL:', error);
        }
      }
      
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
  
  // Handle tool_call (modern API)
  if (item.type === 'tool_call' && item.function && item.function.name === 'computer') {
    try {
      // Parse the computer action from the function arguments
      let args;
      try {
        args = JSON.parse(item.function.arguments);
      } catch (parseError) {
        throw new Error(`Invalid tool call arguments: ${parseError}`);
      }
      
      if (!args || !args.action || !args.action.type) {
        throw new Error('Invalid computer action: missing type');
      }
      
      // Extract action details - same as for computer_call
      const action = args.action;
      const actionType = action.type;
      const actionArgs = Object.fromEntries(
        Object.entries(action).filter(([key]) => key !== 'type')
      );
      
      console.error(`[${sessionId}] ${actionType}(${JSON.stringify(actionArgs)})`);
      sessionInfo.logs.push(`Action: ${actionType}(${Object.keys(actionArgs).join(', ')})`);
      
      // Execute the action on the computer
      await (computer as any)[actionType](...Object.values(actionArgs));
      
      // Take a screenshot after the action
      const screenshotBase64 = await computer.screenshot();
      
      // Create tool result response
      const toolResult = {
        type: 'tool_result',
        tool_call_id: item.id,
        output: JSON.stringify({
          browser: {
            screenshot: screenshotBase64,
            current_url: await computer.getCurrentUrl().catch(() => '')
          }
        })
      };
      
      // Store the screenshot in the session
      sessionInfo.images.push(screenshotBase64);
      
      return [toolResult];
    } catch (error: any) {
      console.error(`[${sessionId}] Error executing tool call action:`, error);
      sessionInfo.logs.push(`Error: ${error.message || 'Unknown error'}`);
      
      // Return a failed tool result
      return [{
        type: 'tool_result',
        tool_call_id: item.id,
        output: JSON.stringify({ error: error.message || 'Unknown error' })
      }];
    }
  }

  return [];
}

/**
 * Starts a new agent session
 */
export async function agentStart(context: Context, params: { startUrl: string, instructions: string }): Promise<ToolResult> {
  try {
    const { startUrl, instructions } = params;
    
    // Generate a unique session ID
    const sessionId = crypto.randomUUID();
    
    // Create a computer instance
    const computer = new PlaywrightComputer(context);
    
    // Create a session info object
    const sessionInfo: SessionInfo = {
      sessionId,
      computer,
      status: 'running',
      startTime: Date.now(),
      logs: ['Starting agent session'],
      images: [],
      items: []
    };
    
    // Add the session to active sessions
    activeSessions.set(sessionId, sessionInfo);
    
    // Navigate to the starting URL first
    try {
      sessionInfo.logs.push(`Navigating to initial URL: ${startUrl}`);
      await computer.navigate(startUrl);
      sessionInfo.logs.push(`Successfully navigated to ${startUrl}`);
    } catch (error: any) {
      sessionInfo.logs.push(`Error navigating to initial URL: ${error.message || 'Unknown error'}`);
      console.error(`Error navigating to initial URL: ${error}`);
      // Continue anyway as the agent might be able to recover
    }
    
    // Run the agent in the background
    runComputerAgent(sessionId, computer, instructions).catch(error => {
      console.error(`Error in agent session ${sessionId}:`, error);
      const session = activeSessions.get(sessionId);
      if (session) {
        session.status = 'error';
        session.error = error.message;
        session.endTime = Date.now();
        session.runningTime = session.endTime - session.startTime;
      }
    });
    
    // Return the session ID
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            sessionId,
            status: 'running'
          })
        }
      ]
    };
  } catch (error: any) {
    console.error('Error starting agent:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message || 'Unknown error'
          })
        }
      ],
      isError: true
    };
  }
}

/**
 * Runs the Computer Use Agent loop
 */
async function runComputerAgent(sessionId: string, computer: PlaywrightComputer, instructions: string): Promise<void> {
  const sessionInfo = activeSessions.get(sessionId);
  if (!sessionInfo) {
    throw new Error(`Session ${sessionId} not found`);
  }

  try {
    // Get API key from environment
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('No OpenAI API key found in environment. Please set OPENAI_API_KEY.');
    }
    
    // Fix TypeScript errors with any
    const anyComputer = computer as any;

    // Log the start of processing
    sessionInfo.logs.push('Processing instructions: ' + instructions);

    // Initialize with browser capabilities
    const browserCapabilities = await computer.getBrowserCapabilities();
    
    // Take an initial screenshot
    const initialScreenshot = await computer.screenshot();
    sessionInfo.images.push(initialScreenshot);
    
    // Define the browser environment
    const browserEnvironment = "browser";
    
    // Define the tools for the API using the proper format for the Computer Use Agent tool API
    // Tools format based on the API error message about missing 'tools[0].name'
    const tools = [
      {
        type: "function",
        name: "computer", // Added name at this level based on error message
        function: {
          name: "computer", // Keep this as well for backward compatibility
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
    
    // Define the initial input with user instructions - exactly match sample code structure
    const items: any[] = [
      { role: 'user', content: instructions }
    ];
    
    // Store items in the session
    sessionInfo.items = items;
    
    // Start the loop
    sessionInfo.logs.push('Starting Computer Use Agent loop');
    
    // Loop until we get a message back or encounter an error
    let loopCount = 0;
    const maxLoops = 50; // Prevent infinite loops
    
    while (sessionInfo.status === 'running' && loopCount < maxLoops) {
      loopCount++;
      
      try {
        // Add detailed debugging of conversation state before API call
        console.error(`Loop ${loopCount}: items=${sessionInfo.items.length}`);
        
        // Track tool calls and results, but don't log each item to avoid MCP parsing issues
        const toolCalls = new Map();
        const toolResults = new Map();
        
        // First pass: collect all tool call IDs and tool result IDs
        for (let i = 0; i < sessionInfo.items.length; i++) {
          const item = sessionInfo.items[i];
          
          if (!item) {
            continue;
          }
          
          const itemType = item.type || (item.role ? `role-${item.role}` : 'no-type');
          
          // Track tool calls and results without verbose logging
          if (itemType === 'tool_call') {
            const id = item.id || 'missing-id';
            toolCalls.set(id, { index: i, item });
          }
          
          if (itemType === 'tool_result') {
            const id = item.tool_call_id || 'missing-id';
            toolResults.set(id, { index: i, item });
          }
        }
        
        // Log summary information
        console.error(`Found ${toolCalls.size} tool calls and ${toolResults.size} tool results`);
        
        // Check for missing tool results without individual logging
        let missingResultCount = 0;
        for (const [id, call] of toolCalls.entries()) {
          if (!toolResults.has(id)) {
            missingResultCount++;
          }
        }
        
        if (missingResultCount > 0) {
          console.error(`WARNING: Missing ${missingResultCount} tool results`);
        }
        
        // Call the OpenAI Responses API exactly like the Python sample
        sessionInfo.logs.push(`Making API request (loop ${loopCount})`);
        
        // Create the payload exactly as in Python sample_cua_loop.py
        // Identical to: response = create_response(model="computer-use-preview", input=items, tools=tools, truncation="auto")
        const kwargs = {
          model: 'computer-use-preview',
          input: items,
          tools: tools,
          truncation: 'auto'
        };
        
        console.error(`API request ${loopCount}: sending ${kwargs.input.length} items with model=${kwargs.model}`);
        
        // Call the create_response function with session info for validation
        const response = await createResponse(kwargs, sessionInfo);
        
        if (!response.output) {
          console.error(response);
          throw new Error('No output from model');
        }
        
        // Add response outputs to the conversation, exactly as in Python
        // Python: items += response["output"]
        items.push(...response.output);
        
        // Process each output item and get any results (e.g., screenshot after action)
        // Process each item individually, exactly as in Python
        for (const item of response.output) {
          // Process the item and get any outputs (direct port of Python)
          const outputs = await handleItem(item, computer, sessionId);
          
          // Add outputs to the conversation (Python: items += handle_item(item, computer))
          items.push(...outputs);
        }
        
        // Check if we have a final message (assistant response ends the loop)
        // Python: if items[-1].get("role") == "assistant": break
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
    sessionInfo.logs.push(`Fatal error: ${error.message || 'Unknown error'}`);
    
    // If the error is about tools parameter, add more diagnostic info
    if (error.message && error.message.includes('tools') && error.message.includes('Extra inputs are not permitted')) {
      // This is a critical error that needs resolution
      console.error(`
====================== IMPORTANT DIAGNOSTIC INFO ======================
The OpenAI API is rejecting the 'tools' parameter even though it's in the sample code.
Sample code structure we're trying to match:
response = create_response(
    model="computer-use-preview",
    input=items,
    tools=tools,
    truncation="auto",
)

Where tools = [{"type": "computer-preview", "display_width": width, "display_height": height, "environment": "browser"}]

This is a known issue that needs to be resolved.
====================================================================
`);
    }
  }
}

/**
 * Gets the status of an agent session
 */
export async function agentStatus(context: Context, params: { sessionId: string, waitSeconds?: number }): Promise<ToolResult> {
  const { sessionId, waitSeconds = 0 } = params;
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Session ${sessionId} not found`
          })
        }
      ],
      isError: true
    };
  }
  
  // If wait time is specified and session is still running, wait for the specified time
  if (waitSeconds > 0 && session.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
  }
  
  // Update running time
  if (session.status === 'running') {
    session.runningTime = Date.now() - session.startTime;
  }
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sessionId,
          status: session.status,
          runningTime: session.runningTime,
          error: session.error
        })
      }
    ]
  };
}

/**
 * Gets the logs of an agent session
 */
export async function agentLog(context: Context, params: { sessionId: string, includeImages?: boolean }): Promise<ToolResult> {
  const { sessionId, includeImages = false } = params;
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Session ${sessionId} not found`
          })
        }
      ],
      isError: true
    };
  }
  
  const content: any[] = [];
  
  // Add logs as text
  session.logs.forEach(log => {
    content.push({
      type: 'text',
      text: log
    });
  });
  
  // Add images if requested
  if (includeImages && session.images.length > 0) {
    session.images.forEach((image, index) => {
      content.push({
        type: 'image',
        data: image,
        mimeType: 'image/jpeg'
      });
    });
  }
  
  return { content };
}

/**
 * Ends an agent session
 */
export async function agentEnd(context: Context, params: { sessionId: string }): Promise<ToolResult> {
  const { sessionId } = params;
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Session ${sessionId} not found`
          })
        }
      ],
      isError: true
    };
  }
  
  if (session.status === 'running') {
    session.status = 'completed';
    session.endTime = Date.now();
    session.runningTime = session.endTime - session.startTime;
  }
  
  // Close the computer
  try {
    await session.computer.close();
  } catch (error) {
    console.error(`Error closing computer for session ${sessionId}:`, error);
  }
  
  // Return the final status
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sessionId,
          status: session.status,
          runningTime: session.runningTime
        })
      }
    ]
  };
}

/**
 * Gets the last image from an agent session
 */
export async function agentGetLastImage(context: Context, params: { sessionId: string }): Promise<ToolResult> {
  const { sessionId } = params;
  
  const session = activeSessions.get(sessionId);
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Session ${sessionId} not found`
          })
        }
      ],
      isError: true
    };
  }
  
  if (session.images.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No images available for this session'
        }
      ]
    };
  }
  
  // Get the last image
  const lastImage = session.images[session.images.length - 1];
  
  return {
    content: [
      {
        type: 'image',
        data: lastImage,
        mimeType: 'image/jpeg'
      }
    ]
  };
}

/**
 * Continues the conversation with an agent by adding a user reply
 */
export async function agentReply(context: Context, params: { sessionId: string, replyText: string }): Promise<ToolResult> {
  const { sessionId, replyText } = params;
  
  const sessionInfo = activeSessions.get(sessionId);
  if (!sessionInfo) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Session ${sessionId} not found`
          })
        }
      ],
      isError: true
    };
  }
  
  // Check if session is still running
  if (sessionInfo.status !== 'running' && sessionInfo.status !== 'completed') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Cannot reply to session in '${sessionInfo.status}' state`
          })
        }
      ],
      isError: true
    };
  }
  
  // Add the user reply to the conversation
  sessionInfo.logs.push(`User reply: ${replyText}`);
  sessionInfo.items.push({ role: 'user', content: replyText });
  
  // If the session was completed, restart it
  if (sessionInfo.status === 'completed') {
    sessionInfo.status = 'running';
    sessionInfo.logs.push('Resuming agent session after completion');
    
    // Run the agent in the background to process the reply
    const computer = sessionInfo.computer;
    
    // Use the same loop logic as in runComputerAgent but without initializing
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('No OpenAI API key found in environment. Please set OPENAI_API_KEY.');
      }
      
      // Get the browser capabilities
      const browserCapabilities = await computer.getBrowserCapabilities();
      
      // Define the browser environment
      const browserEnvironment = "browser";
      
      // Define the tools using the proper format for the Computer Use Agent tool API
      const tools = [
        {
          type: "function",
          name: "computer", // Added name at this level based on error message
          function: {
            name: "computer", // Keep this as well for backward compatibility
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
      
      // Take a new screenshot for our records, but don't add it to the items array
      // The modern CUA API doesn't need explicit screenshots
      const screenshot = await computer.screenshot();
      sessionInfo.images.push(screenshot);
      
      // No need to add a specific screenshot message - the CUA will infer the browser state from context
      
      // Resume the agent loop in the background
      (async () => {
        try {
          // Loop until we get a message back or encounter an error
          let loopCount = 0;
          const maxLoops = 50; // Prevent infinite loops
          
          while (sessionInfo.status === 'running' && loopCount < maxLoops) {
            loopCount++;
            
            try {
              // Add detailed debugging of conversation state before API call
              console.error(`Reply loop ${loopCount}: items=${sessionInfo.items.length}`);
              
              // Track tool calls and results, but don't log each item to avoid MCP parsing issues
              const toolCalls = new Map();
              const toolResults = new Map();
              
              // First pass: collect all tool call IDs and tool result IDs
              for (let i = 0; i < sessionInfo.items.length; i++) {
                const item = sessionInfo.items[i];
                
                if (!item) {
                  continue;
                }
                
                const itemType = item.type || (item.role ? `role-${item.role}` : 'no-type');
                
                // Track tool calls and results without verbose logging
                if (itemType === 'tool_call') {
                  const id = item.id || 'missing-id';
                  toolCalls.set(id, { index: i, item });
                }
                
                if (itemType === 'tool_result') {
                  const id = item.tool_call_id || 'missing-id';
                  toolResults.set(id, { index: i, item });
                }
              }
              
              // Log summary information
              console.error(`Found ${toolCalls.size} tool calls and ${toolResults.size} tool results`);
              
              // Check for missing tool results without individual logging
              let missingResultCount = 0;
              for (const [id, call] of toolCalls.entries()) {
                if (!toolResults.has(id)) {
                  missingResultCount++;
                }
              }
              
              if (missingResultCount > 0) {
                console.error(`WARNING: Missing ${missingResultCount} tool results`);
              }
              
              // Create the payload for the API
              // Add basic validation for robustness
              // Track tool calls and responses
              const replyToolCalls = new Map<string, any>();
              const replyToolResults = new Map<string, any>();
              
              // Collect all tool calls and responses
              for (const item of sessionInfo.items) {
                if (item.type === 'tool_call' && item.id) {
                  replyToolCalls.set(item.id, item);
                } else if (item.type === 'tool_result' && item.tool_call_id) {
                  replyToolResults.set(item.tool_call_id, item);
                }
              }
              
              // Check for missing responses
              let inputItems = sessionInfo.items;
              let hasMissingReplyResponses = false;
              
              for (const [callId, item] of replyToolCalls.entries()) {
                if (!replyToolResults.has(callId)) {
                  hasMissingReplyResponses = true;
                  break;
                }
              }
              
              // Generate fallbacks if needed
              if (hasMissingReplyResponses) {
                console.error(`Found missing tool results in reply - generating fallbacks`);
                
                // Get latest screenshot
                let latestScreenshot = '';
                if (sessionInfo.images.length > 0) {
                  latestScreenshot = sessionInfo.images[sessionInfo.images.length - 1];
                }
                
                // Create fixed input
                const fixedInput = [...sessionInfo.items];
                
                // Add fallbacks for missing results
                for (const [callId, item] of replyToolCalls.entries()) {
                  if (!replyToolResults.has(callId)) {
                    console.error(`Adding fallback for tool_call ${callId}`);
                    
                    // Create a fallback tool result
                    fixedInput.push({
                      type: 'tool_result',
                      tool_call_id: callId,
                      output: JSON.stringify({
                        browser: {
                          screenshot: latestScreenshot,
                          current_url: await computer.getCurrentUrl().catch(() => '')
                        }
                      })
                    });
                  }
                }
                
                inputItems = fixedInput;
              }
              
              const kwargs = {
                model: 'computer-use-preview',
                input: inputItems,
                tools: tools,
                truncation: 'auto'
              };
              
              sessionInfo.logs.push(`Making API request (reply loop ${loopCount})`);
              
              // Call the API with session info for validation
              const response = await createResponse(kwargs, sessionInfo);
              
              if (!response.output) {
                throw new Error('No output from model');
              }
              
              // Add response outputs to the conversation
              sessionInfo.items.push(...response.output);
              
              // Process each output item - keep it simple like Python
              for (const item of response.output) {
                // Process the item and get any outputs
                const outputs = await handleItem(item, computer, sessionId);
                
                // Add outputs to the conversation
                sessionInfo.items.push(...outputs);
              }
              
              // Check if we have a final message
              const hasCompletedMessage = sessionInfo.items.length > 0 && 
                                         sessionInfo.items[sessionInfo.items.length - 1].role === 'assistant';
              
              if (hasCompletedMessage) {
                sessionInfo.status = 'completed';
                sessionInfo.logs.push('Task completed successfully');
                break;
              }
            } catch (error: any) {
              console.error(`Error in agent reply loop (${loopCount}):`, error);
              sessionInfo.logs.push(`Error: ${error.message || 'Unknown error'}`);
              sessionInfo.status = 'error';
              sessionInfo.error = error.message || 'Unknown error';
              break;
            }
          }
          
          // If we reached max loops, set status to error
          if (loopCount >= maxLoops && sessionInfo.status === 'running') {
            sessionInfo.status = 'error';
            sessionInfo.error = 'Reached maximum number of loop iterations';
          }
        } catch (error: any) {
          console.error(`Error processing reply for session ${sessionId}:`, error);
          sessionInfo.status = 'error';
          sessionInfo.error = error.message || 'Unknown error';
          sessionInfo.logs.push(`Fatal error: ${error.message || 'Unknown error'}`);
        }
      })().catch(error => {
        console.error(`Error in agent reply session ${sessionId}:`, error);
        sessionInfo.status = 'error';
        sessionInfo.error = error.message || 'Unknown error';
      });
    } catch (error: any) {
      console.error(`Error preparing reply for session ${sessionId}:`, error);
      sessionInfo.status = 'error';
      sessionInfo.error = error.message || 'Unknown error';
      sessionInfo.logs.push(`Error preparing reply: ${error.message || 'Unknown error'}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: `Failed to process reply: ${error.message || 'Unknown error'}`
            })
          }
        ],
        isError: true
      };
    }
  }
  
  // Return success response
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          sessionId,
          status: sessionInfo.status,
          message: 'Reply added to the conversation'
        })
      }
    ]
  };
}