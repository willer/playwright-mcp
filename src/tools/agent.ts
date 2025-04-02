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
import { v4 as uuidv4 } from 'uuid';
import { BrowserContext } from 'playwright';
import fetch from 'node-fetch';
import { PlaywrightComputer } from './computer';
import { BLOCKED_DOMAINS } from './blocked-domains';
import { createUserDataDir } from './utils';

/**
 * Session information type
 */
export interface SessionInfo {
  sessionId: string;
  computer: PlaywrightComputer;
  // 'running' - actively processing
  // 'completed' - turn completed, waiting for more input
  // 'ended' - session fully terminated
  // 'error' - something went wrong
  status: 'running' | 'completed' | 'ended' | 'error';
  startTime: number;
  endTime?: number;
  error?: string;
  logs: string[];
  images: string[];
  items: any[]; // Conversation items
  runningTime?: number;
}

/**
 * Manages CUA sessions
 */
export class AgentManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private apiKey: string;
  private model: string = 'computer-use-preview';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Start a new agent session
   */
  async startSession(context: BrowserContext, startUrl: string, instructions: string): Promise<string> {
    const sessionId = uuidv4();

    // Create and initialize a new computer
    const computer = new PlaywrightComputer(context);
    await computer.initialize(startUrl);

    // Create a new session
    const session: SessionInfo = {
      sessionId,
      computer,
      status: 'running',
      startTime: Date.now(),
      logs: [],
      images: [],
      items: [{ role: 'user', content: instructions }]
    };

    this.sessions.set(sessionId, session);

    // Start the agent execution in the background
    this.runAgentLoop(sessionId).catch(error => {
      console.error(`Error in agent loop for session ${sessionId}:`, error);
      session.status = 'error';
      session.error = error instanceof Error ? error.message : String(error);
      session.endTime = Date.now();
      session.runningTime = session.endTime - session.startTime;
    });

    return sessionId;
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }
  
  /**
   * Get all sessions
   */
  getAllSessions(): Map<string, SessionInfo> {
    return this.sessions;
  }

  /**
   * End a session - this fully terminates the session
   */
  async endSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session)
      return false;


    // When ending a session, we use 'ended' status to clearly indicate
    // it's terminated (different from 'completed' which means a turn is complete)
    session.status = 'ended';
    session.endTime = Date.now();
    session.runningTime = session.endTime - session.startTime;

    // Close the computer, but save storage state first if possible
    try {
      // Try to save the storage state before closing
      const context = session.computer.getBrowserContext();
      const userDataDir = await createUserDataDir();
      if (context) {
        const storageState = await context.storageState();
        const fs = await import('fs/promises');
        const path = await import('path');
        const storageStatePath = path.join(userDataDir, 'storage-state.json');
        await fs.writeFile(storageStatePath, JSON.stringify(storageState, null, 2));
        console.error(`[DEBUG] Saved storage state to ${storageStatePath}`);
      }

      // Now close the browser
      await session.computer.close();
    } catch (error) {
      console.error(`Error closing computer for session ${sessionId}:`, error);
    }

    return true;
  }

  /**
   * Send a reply to continue a conversation
   */
  async sendReply(sessionId: string, replyText: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);

    // We can send a reply if the session is in 'completed' status (waiting for input)
    // or if it's 'running' (though that would be unusual)
    if (!session || (session.status !== 'completed' && session.status !== 'running')) {
      console.error(`[ERROR] Cannot send reply to session with status: ${session?.status}`);
      return false;
    }

    // Add the user message to the conversation
    session.items.push({ role: 'user', content: replyText });
    session.logs.push(`User: ${replyText}`);

    // Continue the agent execution
    this.runAgentLoop(sessionId).catch(error => {
      console.error(`Error in agent loop for session ${sessionId}:`, error);
      session.status = 'error';
      session.error = error instanceof Error ? error.message : String(error);
      session.endTime = Date.now();
      session.runningTime = session.endTime - session.startTime;
    });

    return true;
  }

  /**
   * Main agent execution loop
   */
  private async runAgentLoop(sessionId: string): Promise<void> {
    console.error(`[DEBUG] Starting/resuming agent loop for session ${sessionId}`);

    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`[ERROR] Session ${sessionId} not found`);
      return;
    }

    // A session should either be 'running' (active), 'completed' (turn completed, waiting for input)
    // or 'error' (something went wrong)
    // 'completed' status means we can accept new input to continue the session
    if (session.status !== 'running' && session.status !== 'completed') {
      console.error(`[ERROR] Session ${sessionId} cannot be resumed (status: ${session.status})`);
      return;
    }

    // Set the session to running again since we're processing
    session.status = 'running';

    const { computer, items } = session;
    console.error(`[DEBUG] Session has ${items.length} items`);
    const lastItem = items[items.length - 1];
    console.error(`[DEBUG] Last item type: ${lastItem ? lastItem.type || lastItem.role : 'none'}`);


    try {
      // Do NOT send an initial screenshot - the sample code doesn't do this
      // We should only send computer_call_output in response to a computer_call from the API

      // Keep processing until we get a final assistant message
      while (true) {
        // Create the API request
        console.error(`[DEBUG] Sending request to OpenAI API with ${items.length} items`);
        const response = await this.createResponse(items);
        console.error(`[DEBUG] Received response from OpenAI API`);


        if (!response.output)
          throw new Error('No output from model');


        // First add all outputs from the model to items (just like in sample code)
        console.error(`[DEBUG] Response has ${response.output.length} output items`);
        for (const item of response.output)
          console.error(`[DEBUG] Output item type: ${item.type || item.role}`);

        items.push(...response.output);

        // Then handle each item and add any resulting items back to the array
        for (const item of response.output) {
          // If it's a message, log it
          if (item.type === 'message')
            session.logs.push(`Assistant: ${item.content[0].text}`);


          // If it's a computer call, process it - follow the sample code exactly
          if (item.type === 'computer_call') {
            // Handle computer call exactly like in handle_item function from sample code
            const action = item.action;
            const actionType = action.type;
            const actionArgs = Object.fromEntries(
                Object.entries(action).filter(([key]) => key !== 'type')
            );

            session.logs.push(`${actionType}(${JSON.stringify(actionArgs)})`);

            // Execute the action on the computer with better error handling
            try {
              console.error(`[DEBUG] Executing action: ${actionType} with args:`, JSON.stringify(actionArgs));
              await (computer as any)[actionType](...Object.values(actionArgs));
            } catch (error) {
              console.error(`[ERROR] Failed to execute action ${actionType}:`, error);
              console.error(`[ERROR] Action arguments:`, JSON.stringify(actionArgs));
              throw error;
            }

            // Take screenshot
            const screenshot = await computer.screenshot();
            session.images.push(screenshot);

            // Handle pending safety checks
            const pendingChecks = item.pending_safety_checks || [];
            // Note: we don't have interactive safety check handling in this implementation

            // Get current URL first
            const currentUrl = await computer.getCurrentUrl();
            this.checkBlockedUrl(currentUrl);

            // Create the call output EXACTLY as in the sample code
            const callOutput = {
              type: 'computer_call_output',
              call_id: item.call_id,
              acknowledged_safety_checks: pendingChecks,
              output: {
                type: 'input_image',
                image_url: `data:image/png;base64,${screenshot}`,
                current_url: currentUrl
              }
            };

            // Add the result to items - exactly like sample code does with items += handle_item(...)
            items.push(callOutput);
          }
        }

        // Check if we got a final assistant message for this turn
        // but don't complete the session (we want to allow further interaction)
        if (items[items.length - 1].role === 'assistant') {
          // Just break out of the loop but keep the session running
          break;
        }
      }

      // The loop has completed for this turn
      // Mark the session as 'completed' to indicate it's waiting for more input
      session.status = 'completed'; // 'completed' means the turn is complete, not the session
      console.error('[DEBUG] Completed processing turn, session status set to "completed" (waiting for input)');

    } catch (error) {
      session.status = 'error';
      session.error = error instanceof Error ? error.message : String(error);
      session.endTime = Date.now();
      session.runningTime = session.endTime - session.startTime;
      throw error;
    }
  }

  /**
   * Create a response from the OpenAI API
   */
  private async createResponse(input: any[]): Promise<any> {
    const url = 'https://api.openai.com/v1/responses';

    // Get the browser dimensions from the computer
    const dimensions = await this.getBrowserDimensions();

    const request = {
      model: this.model,
      input,
      tools: [
        {
          type: 'computer-preview',
          display_width: dimensions.width,
          display_height: dimensions.height,
          environment: 'browser'
        }
      ],
      truncation: 'auto'
    };

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      throw error;
    }
  }

  /**
   * Check if a URL is blocked
   */
  private checkBlockedUrl(url: string): void {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    if (BLOCKED_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith(`.${domain}`)))
      throw new Error(`Blocked URL: ${url}`);

  }

  /**
   * Get browser dimensions
   */
  private async getBrowserDimensions(): Promise<{ width: number, height: number }> {
    // Default dimensions
    return { width: 1024, height: 768 };
  }
}
