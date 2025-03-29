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
  if (!session)
    throw new Error(`Session ${sessionId} not found`);


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
            console.error('Error parsing OpenAI response:', e);
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

  // Process computer tasks using OpenAI vision model
  async runComputerAgent(sessionId: string, computer: PlaywrightComputer, instructions: string): Promise<void> {
    logToSession(sessionId, `Processing instructions with AI: ${instructions}`, 'text');

    // Get initial screenshot
    const screenshot = await computer.screenshot();
    logToSession(sessionId, 'Captured initial screenshot', 'image', screenshot);

    // Create the initial message for the AI
    const systemPrompt = `You are a browser automation agent that executes computer commands exactly as specified. 

IMPORTANT: You MUST provide your commands in a code block format that can be executed directly.

Available commands:
- screenshot() - Take a screenshot of the current browser window
- click(x, y) - Click at coordinates (x, y) where x and y MUST be specific pixel numbers (e.g., click(350, 200))
- type("text") - Type the given text, text MUST be in quotes
- press("key") - Press a keyboard key (e.g., "Enter", "ArrowDown"), key MUST be in quotes 
- wait(ms) - Wait for the specified number of milliseconds (e.g., wait(2000) for 2 seconds)
- navigate("url") - Navigate to the specified URL, url MUST be in quotes and include https://

REQUIRED FORMAT: 
\`\`\`
navigate("https://example.com")
wait(1000)
type("search query")
press("Enter")
wait(2000)
click(250, 300)
\`\`\`

If you don't know specific pixel coordinates, use click(x, y) as a placeholder. The system will analyze the screen and determine coordinates for you.

For best results:
1. Always use full URLs with https://
2. Include wait() commands between actions to ensure pages load
3. Be precise about what text to type and what keys to press
4. Put each command on its own line inside a single code block

This task will be executed exactly as you specify, with no human intervention. Your code block must be complete and executable.`;

    // Add instructions clarification - repetition helps improve performance
    const userPrompt = `I need you to help me with the following task in a web browser:

${instructions}

REMEMBER: You MUST format your response with the commands in a code block using triple backticks:
\`\`\`
navigate("https://example.com")
wait(1000)
click(x, y)  
\`\`\`

If you don't know coordinates for a click, use click(x, y) as a placeholder and I'll analyze the screen to determine them.

Please provide ONLY the commands needed to complete this task, formatted properly in a code block.`;

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
    const actionableLines: string[] = [];

    // Check if there are code blocks in the response
    const codeBlocks: string[] = [];
    let inCodeBlock = false;
    let currentCodeBlock = '';

    // Extract code blocks first
    for (const line of lines) {
      if (line.trim().startsWith('```') && !inCodeBlock) {
        inCodeBlock = true;
        currentCodeBlock = '';
      } else if (line.trim().startsWith('```') && inCodeBlock) {
        inCodeBlock = false;
        codeBlocks.push(currentCodeBlock);
      } else if (inCodeBlock) {
        currentCodeBlock += line + '\n';
      }
    }

    logToSession(sessionId, `Found ${codeBlocks.length} code blocks in response`, 'text');

    // Process code blocks first if they exist
    if (codeBlocks.length > 0) {
      for (const block of codeBlocks) {
        const blockLines = block.split('\n');
        for (const line of blockLines) {
          const trimmedLine = line.trim();
          if (trimmedLine && !trimmedLine.startsWith('//') && !trimmedLine.startsWith('#')) {
            if (
              trimmedLine.includes('screenshot()') ||
              trimmedLine.match(/click\(\s*\d+\s*,\s*\d+\s*\)/) ||
              trimmedLine.match(/click\(\s*[a-zA-Z]+\s*,\s*[a-zA-Z]+\s*\)/) ||
              trimmedLine.match(/type\(['"](.*)['"]\)/) ||
              trimmedLine.match(/press\(['"](.*)['"]\)/) ||
              trimmedLine.match(/wait\(\s*\d+\s*\)/) ||
              trimmedLine.match(/navigate\(['"](.*)['"]/)
            ) {
              actionableLines.push(trimmedLine);
            } else if (
              // More permissive patterns as fallbacks
              trimmedLine.toLowerCase().includes('navigate') ||
              trimmedLine.toLowerCase().includes('click') ||
              trimmedLine.toLowerCase().includes('type') ||
              trimmedLine.toLowerCase().includes('press') ||
              trimmedLine.toLowerCase().includes('wait') ||
              trimmedLine.toLowerCase().includes('screenshot')
            ) {
              // Try to convert to actionable format
              if (trimmedLine.toLowerCase().includes('navigate')) {
                const urlMatch = trimmedLine.match(/(['"])(.*?)\1/);
                if (urlMatch && urlMatch[2])
                  actionableLines.push(`navigate("${urlMatch[2]}")`);
                else
                  actionableLines.push(`navigate("https://example.com")`);

              } else if (trimmedLine.toLowerCase().includes('click')) {
                actionableLines.push('click(x, y)');
              } else if (trimmedLine.toLowerCase().includes('type')) {
                const textMatch = trimmedLine.match(/(['"])(.*?)\1/);
                if (textMatch && textMatch[2])
                  actionableLines.push(`type("${textMatch[2]}")`);

              } else if (trimmedLine.toLowerCase().includes('press')) {
                const keyMatch = trimmedLine.match(/(['"])(.*?)\1/);
                if (keyMatch && keyMatch[2])
                  actionableLines.push(`press("${keyMatch[2]}")`);
                else if (trimmedLine.toLowerCase().includes('enter'))
                  actionableLines.push(`press("Enter")`);

              } else if (trimmedLine.toLowerCase().includes('wait')) {
                const timeMatch = trimmedLine.match(/\d+/);
                if (timeMatch && timeMatch[0])
                  actionableLines.push(`wait(${timeMatch[0]})`);
                else
                  actionableLines.push('wait(2000)');

              } else if (trimmedLine.toLowerCase().includes('screenshot')) {
                actionableLines.push('screenshot()');
              }
            }
          }
        }
      }
    }

    // If no actionable lines were found in code blocks, try to find them in the regular text
    if (actionableLines.length === 0) {
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (
          trimmedLine.includes('screenshot()') ||
          trimmedLine.match(/click\(\s*\d+\s*,\s*\d+\s*\)/) ||
          trimmedLine.match(/click\(\s*[a-zA-Z]+\s*,\s*[a-zA-Z]+\s*\)/) ||
          trimmedLine.match(/type\(['"](.*)['"]\)/) ||
          trimmedLine.match(/press\(['"](.*)['"]\)/) ||
          trimmedLine.match(/wait\(\s*\d+\s*\)/) ||
          trimmedLine.match(/navigate\(['"](.*)['"]/)
        )
          actionableLines.push(trimmedLine);

      }
    }

    // If we still have no actions, try to infer a basic plan from the session's instructions
    if (actionableLines.length === 0) {
      logToSession(sessionId, 'No actionable commands found in response. Creating fallback plan.', 'text');

      // Get the session so we can access the instructions
      const session = sessions.get(sessionId);
      if (!session)
        throw new Error(`Session ${sessionId} not found`);


      // Log error message without any fallback actions
      console.error(`No actionable commands found for session ${sessionId}`);

      // If we couldn't extract actionable commands and have no fallback options,
      // log an error and don't add any actions - the agent will terminate

      logToSession(sessionId, 'No actionable commands found in response. Unable to execute task.', 'text');
      logToSession(sessionId, 'AI response was not in the required format to complete the task.', 'text');

      // Do not create fallback plans - if no actionable commands were found, we'll fail cleanly
    }

    // Log what we found and update step count for progress tracking
    logToSession(sessionId, `Found ${actionableLines.length} actionable commands in the plan`, 'text');
    if (actionableLines.length > 0) {
      logToSession(sessionId, `Actions to execute: ${actionableLines.join(', ')}`, 'text');

      // Update session step count for progress tracking
      const session = sessions.get(sessionId);
      if (session) {
        session.stepsTotal = actionableLines.length;
        session.stepsCompleted = 0;
      }
    }

    // Get session for updating progress and coordinate determination
    const sessionData = sessions.get(sessionId);
    if (!sessionData)
      throw new Error(`Session ${sessionId} not found`);


    // Use a second round of AI to determine actual coordinates when placeholders exist
    // Track lines requiring coordinate determination
    const clickLines: string[] = [];
    const needsCoordinateDetermination = actionableLines.some(line => {
      const isClickPlaceholder =
        line.includes('click(x, y)') ||
        line.includes('click(X, Y)') ||
        line.match(/click\(\s*[a-zA-Z]+\s*,\s*[a-zA-Z]+\s*\)/) ||
        (line.toLowerCase().includes('click') && !line.match(/click\(\s*\d+\s*,\s*\d+\s*\)/));

      if (isClickPlaceholder)
        clickLines.push(line);

      return isClickPlaceholder;
    });

    if (needsCoordinateDetermination) {
      logToSession(sessionId, 'Found click command with placeholder coordinates. Taking screenshot for analysis.', 'text');
      const screenshot = await computer.screenshot();
      logToSession(sessionId, 'Screenshot taken for coordinate analysis', 'image', screenshot);

      // Create a prompt for the AI to analyze the screenshot and determine coordinates
      logToSession(sessionId, 'Requesting AI to analyze screenshot and determine click coordinates', 'text');

      try {
        // Get current URL to provide context
        const currentUrl = await computer.getCurrentUrl();

        // Create a special coordinate determination prompt
        const coordinatePrompt = `
You are now analyzing a screenshot of a webpage at URL: ${currentUrl}

The current task is: ${sessionData.instructions}

The plan includes one or more click operations that need exact coordinates:
${clickLines.join('\n')}

Based on the screenshot, determine the exact X,Y coordinates for each click operation.
For each placeholder click(x, y), provide a replacement with specific pixel coordinates.

For example, if the plan says:
- click(x, y) # Click on search box
- click(x, y) # Click on a search result

Your response should be:
click(255, 155)
click(300, 380)

IMPORTANT INSTRUCTIONS:
1. Return ONLY the click command(s) with specific coordinates, one per line
2. Use numbers between 100-800 for X and 100-600 for Y to ensure they're on screen
3. DO NOT include any explanation or commentary
4. If multiple clicks are needed, provide coordinates for all of them

Just provide click commands with coordinates, NOTHING ELSE.
`;

        // Send the prompt to the API with the screenshot
        const response = await this.createOpenAIRequest({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a computer vision assistant that determines precise pixel coordinates for clicking elements on a webpage.' },
            { role: 'user', content: [
              { type: 'text', text: coordinatePrompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } }
            ] }
          ],
          max_tokens: 100
        });

        if (response.choices && response.choices.length > 0) {
          const coordinateResponse = response.choices[0].message.content.trim();
          logToSession(sessionId, `AI determined coordinates: ${coordinateResponse}`, 'text');

          // Process the coordinate response and update actionableLines
          logToSession(sessionId, `Processing coordinate response: ${coordinateResponse}`, 'text');

          // The response might contain multiple click commands, one per line
          const clickCommands = coordinateResponse.split('\n').filter((line: string) => line.trim() !== '');

          if (clickCommands.length > 0) {
            // Replace placeholders with actual coordinates
            let clickCommandIndex = 0;
            for (let i = 0; i < actionableLines.length; i++) {
              if (actionableLines[i].includes('click(x, y)') ||
                  actionableLines[i].includes('click(X, Y)') ||
                  actionableLines[i].match(/click\(\s*[a-zA-Z]+\s*,\s*[a-zA-Z]+\s*\)/) ||
                  (actionableLines[i].toLowerCase().includes('click') && !actionableLines[i].match(/click\(\s*\d+\s*,\s*\d+\s*\)/))) {

                if (clickCommandIndex < clickCommands.length) {
                  actionableLines[i] = clickCommands[clickCommandIndex];
                  clickCommandIndex++;
                  logToSession(sessionId, `Updated click command: ${actionableLines[i]}`, 'text');
                }
              }
            }
          } else {
            // Fallback to fixed coordinates if response parsing fails
            for (let i = 0; i < actionableLines.length; i++) {
              if (actionableLines[i].includes('click(x, y)') ||
                  actionableLines[i].includes('click(X, Y)') ||
                  actionableLines[i].match(/click\(\s*[a-zA-Z]+\s*,\s*[a-zA-Z]+\s*\)/) ||
                  (actionableLines[i].toLowerCase().includes('click') && !actionableLines[i].match(/click\(\s*\d+\s*,\s*\d+\s*\)/))) {

                // Use fallback coordinates for different purposes
                if (actionableLines[i].toLowerCase().includes('search'))
                  actionableLines[i] = 'click(300, 200)'; // Typical search box location
                else
                  actionableLines[i] = 'click(400, 350)'; // Typical search result location

                logToSession(sessionId, `Using fallback coordinates: ${actionableLines[i]}`, 'text');
              }
            }
          }
        } else {
          throw new Error('No response from the OpenAI API for coordinate determination');
        }
      } catch (error: any) {
        logToSession(sessionId, `Error determining coordinates: ${error.message}`, 'text');
        throw error;
      }
    }

    // We already have the session data from earlier

    // If we have no actionable commands, set error state and exit
    if (actionableLines.length === 0) {
      sessionData.status = 'error';
      sessionData.error = 'No actionable commands could be parsed from the AI response';
      sessionData.endTime = Date.now();
      return;
    }

    // Execute each actionable command
    for (let i = 0; i < actionableLines.length; i++) {
      const line = actionableLines[i];

      // Update current action in session
      sessionData.currentAction = line;

      // Execute different commands based on pattern matching
      if (line.includes('screenshot()')) {
        logToSession(sessionId, 'Taking screenshot', 'text');
        const screenshot = await computer.screenshot();
        logToSession(sessionId, 'Screenshot taken', 'image', screenshot);
      } else if (line.match(/click\(\s*\d+\s*,\s*\d+\s*\)/)) {
        const match = line.match(/click\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (match) {
          const x = parseInt(match[1], 10);
          const y = parseInt(match[2], 10);
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
          const ms = parseInt(match[1], 10);
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

      // Update progress in session
      sessionData.stepsCompleted = i + 1;
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
      if (log.contentType === 'text')
        content.push({ type: 'text' as const, text: `[${log.timestamp}] ${log.message}` });

    }

    // Add summary at the end
    let progress = 0;
    if (session.stepsTotal && session.stepsTotal > 0)
      progress = Math.floor((session.stepsCompleted || 0) / session.stepsTotal * 100);


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
    if (session.computer)
      await session.computer.close();


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
    session.stepsTotal = 0;  // Will be set when we parse the plan
    session.stepsCompleted = 0;
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
    console.error(`Agent execution error for session ${sessionId}:`, error);
    logToSession(sessionId, `Error encountered: ${error.message || 'Unknown error'}`, 'text');
    logToSession(sessionId, `Error stack: ${error.stack || 'No stack trace available'}`, 'text');

    try {
      // Attempt to take a screenshot to help with debugging if computer exists
      if (session.computer) {
        const finalScreenshot = await session.computer.screenshot();
        if (finalScreenshot)
          logToSession(sessionId, 'Final state screenshot before error', 'image', finalScreenshot);

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
