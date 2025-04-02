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

interface CUAReasoningItem {
  type: 'reasoning';
  id: string;
  summary: any[];
}

// OpenAI CUA format output_text type
interface CUAOutputTextItem {
  type: 'output_text';
  text: string;
  annotations?: any[];
}

type CUAItem = CUAMessage | CUAComputerCall | CUAComputerCallOutput | CUAMessageItem | CUAReasoningItem | CUAOutputTextItem;

interface CUAResponse {
  output: CUAItem[];
}

// Action log entry for human-readable display
interface ActionLogEntry {
  timestamp: number;
  action: string;
  details: string;
  success: boolean;
  url?: string;
}

// Session data structure
interface SessionData {
  items: CUAItem[];
  status: 'starting' | 'running' | 'completed' | 'error';
  images: string[]; // Base64 encoded screenshots
  logs: string[]; // Text logs for debugging
  actionLog: ActionLogEntry[]; // Human-readable log of actions for display
  error?: string;
  startTime: number;
  endTime?: number;
  runningTime?: number;
  waitLoopCount?: number; // Count of consecutive wait loops
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

// Helper function to extract message info without image data
function getLastMessageInfo(items: CUAItem[]): { type: string; summary: string } {
  if (items.length === 0) {
    return { type: 'none', summary: 'No messages' };
  }
  
  const lastItem = items[items.length - 1];
  
  if ('role' in lastItem) {
    if (lastItem.role === 'user') {
      return { 
        type: 'user_message', 
        summary: typeof lastItem.content === 'string' ? `User: ${lastItem.content.substring(0, 50)}${lastItem.content.length > 50 ? '...' : ''}` : 'User message' 
      };
    } else if (lastItem.role === 'assistant') {
      return { 
        type: 'assistant_message', 
        summary: typeof lastItem.content === 'string' ? `Assistant: ${lastItem.content.substring(0, 50)}${lastItem.content.length > 50 ? '...' : ''}` : 'Assistant message' 
      };
    }
  } else if ('type' in lastItem) {
    if (lastItem.type === 'output_text') {
      return { 
        type: 'cua_message', 
        summary: `CUA: ${lastItem.text.substring(0, 50)}${lastItem.text.length > 50 ? '...' : ''}` 
      };
    } else if (lastItem.type === 'computer_call') {
      return { 
        type: 'computer_action', 
        summary: `Action: ${lastItem.action.type}` 
      };
    } else if (lastItem.type === 'computer_call_output') {
      return { 
        type: 'screenshot', 
        summary: 'Screenshot taken' 
      };
    } else if (lastItem.type === 'message') {
      return { 
        type: 'system_message', 
        summary: lastItem.content && lastItem.content[0] ? `System: ${lastItem.content[0].text.substring(0, 50)}${lastItem.content[0].text.length > 50 ? '...' : ''}` : 'System message'
      };
    }
  }
  
  return { type: 'unknown', summary: 'Unknown message type' };
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
  
  // Create a human-readable description for the action log
  let actionDescription = '';
  let actionDetails = '';
  
  switch (actionType) {
    case 'click':
      actionDescription = 'Click';
      actionDetails = `Clicked at coordinates (${action.x}, ${action.y})${action.button ? ` with ${action.button} button` : ''}`;
      break;
    case 'double_click':
      actionDescription = 'Double Click';
      actionDetails = `Double-clicked at coordinates (${action.x}, ${action.y})`;
      break;
    case 'type':
      actionDescription = 'Type Text';
      actionDetails = `Typed: "${action.text}"`;
      break;
    case 'keypress':
      actionDescription = 'Keyboard Shortcut';
      actionDetails = Array.isArray(action.keys) 
        ? `Pressed keys: ${action.keys.join(' + ')}`
        : `Pressed key: ${action.key}`;
      break;
    case 'press':
      actionDescription = 'Press Key';
      actionDetails = `Pressed key: ${action.key}`;
      break;
    case 'wait':
      actionDescription = 'Wait';
      actionDetails = `Waited ${action.ms || 1000}ms`;
      break;
    case 'navigate':
    case 'goto':
      actionDescription = 'Navigate';
      actionDetails = `Navigated to: ${action.url}`;
      break;
    case 'move':
      actionDescription = 'Move Cursor';
      actionDetails = `Moved cursor to coordinates (${action.x}, ${action.y})`;
      break;
    case 'scroll':
      actionDescription = 'Scroll';
      actionDetails = action.scroll_y 
        ? `Scrolled by (${action.scroll_x || 0}, ${action.scroll_y}) pixels` 
        : `Scrolled by ${action.delta_y || 100} pixels`;
      break;
    default:
      actionDescription = actionType.charAt(0).toUpperCase() + actionType.slice(1);
      actionDetails = JSON.stringify(action);
  }
  
  // Add entry to action log - we'll update the success status later
  const logEntry: ActionLogEntry = {
    timestamp: Date.now(),
    action: actionDescription,
    details: actionDetails,
    success: false // Will update after the action is performed
  };
  session.actionLog.push(logEntry);
  
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
          
          // Map CUA key names to Playwright key names
          const keyMap: Record<string, string> = {
            'BACKSPACE': 'Backspace',
            'CTRL': 'Control',
            'CONTROL': 'Control',
            'COMMAND': 'Meta',
            'CMD': 'Meta',
            'ALT': 'Alt',
            'SHIFT': 'Shift',
            'ENTER': 'Enter',
            'TAB': 'Tab',
            'ESCAPE': 'Escape',
            'ESC': 'Escape',
            'ARROWUP': 'ArrowUp',
            'ARROW UP': 'ArrowUp',
            'UP': 'ArrowUp',
            'ARROWDOWN': 'ArrowDown',
            'ARROW DOWN': 'ArrowDown',
            'DOWN': 'ArrowDown',
            'ARROWLEFT': 'ArrowLeft',
            'ARROW LEFT': 'ArrowLeft',
            'LEFT': 'ArrowLeft',
            'ARROWRIGHT': 'ArrowRight',
            'ARROW RIGHT': 'ArrowRight',
            'RIGHT': 'ArrowRight',
            'DELETE': 'Delete',
            'DEL': 'Delete',
            'END': 'End',
            'HOME': 'Home',
            'INSERT': 'Insert',
            'INS': 'Insert',
            'PAGEDOWN': 'PageDown',
            'PAGE DOWN': 'PageDown',
            'PAGEUP': 'PageUp',
            'PAGE UP': 'PageUp',
            'CAPSLOCK': 'CapsLock',
            'CAPS LOCK': 'CapsLock',
            'SPACE': ' ',
            'SUPER': 'Meta',
            'WINDOWS': 'Meta',
            'A': 'a',
            'B': 'b',
            'C': 'c',
            'D': 'd',
            'E': 'e',
            'F': 'f',
            'G': 'g',
            'H': 'h',
            'I': 'i',
            'J': 'j',
            'K': 'k',
            'L': 'l',
            'M': 'm',
            'N': 'n',
            'O': 'o',
            'P': 'p',
            'Q': 'q',
            'R': 'r',
            'S': 's',
            'T': 't',
            'U': 'u',
            'V': 'v',
            'W': 'w',
            'X': 'x',
            'Y': 'y',
            'Z': 'z'
          };
          
          // Handle keypress with multiple keys (keyboard shortcuts)
          const page = await computer.getPage();
          
          // Map keys using our mapping
          const mappedKeys = action.keys.map(key => {
            const normalizedKey = typeof key === 'string' ? key.toUpperCase() : '';
            return keyMap[normalizedKey] || key;
          });
          
          console.error(`Mapped keys: ${JSON.stringify(mappedKeys)}`);
          
          try {
            // Press all keys down in sequence
            for (const key of mappedKeys) {
              console.error(`Pressing down: ${key}`);
              await page.keyboard.down(key);
            }
            
            // Small delay to ensure the keypress is registered
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Release keys in reverse order
            for (let i = mappedKeys.length - 1; i >= 0; i--) {
              console.error(`Releasing: ${mappedKeys[i]}`);
              await page.keyboard.up(mappedKeys[i]);
            }
          } catch (error) {
            console.error(`Error executing keypress: ${error}`);
            // Fall back to typing the text if key combination fails
            if (action.keys.includes('A') && (action.keys.includes('CTRL') || action.keys.includes('CONTROL'))) {
              // Special handling for Ctrl+A (select all)
              await page.evaluate(() => document.execCommand('selectAll'));
            }
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
        if (action.scroll_x !== undefined && action.scroll_y !== undefined) {
          await computer.scroll(action.x || 0, action.y || 0, action.scroll_x || 0, action.scroll_y || 0);
        } else {
          // Fallback for different scroll action formats
          await computer.scroll(action.x || 0, action.y || 0, 0, action.delta_y || 100); 
        }
        break;
      // Could add more actions as needed
    }
  } catch (error: any) {
    session.logs.push(`Error executing action: ${error.message}`);
    console.error(`Error executing CUA action: ${error.message}`);
    
    // Mark the action as failed in the log
    const currentLogEntry = session.actionLog[session.actionLog.length - 1];
    if (currentLogEntry) {
      currentLogEntry.success = false;
      currentLogEntry.details += ` - Error: ${error.message}`;
    }
    
    // No need to return early, we still want to take a screenshot
  }
  
  // Take a screenshot after the action
  const screenshot = await computer.screenshot();
  session.images.push(screenshot);
  
  // Get the current URL for safety checking and to add to the action log
  const currentUrl = await computer.getCurrentUrl();
  
  // Update the log entry with success status and current URL
  const currentLogEntry = session.actionLog[session.actionLog.length - 1];
  if (currentLogEntry) {
    currentLogEntry.success = true; // If we got here without exception, it's a success
    currentLogEntry.url = currentUrl;
  }
  
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
    
    // Handle output_text items (CUA format)
    if ('type' in item && item.type === 'output_text') {
      console.error(`CUA message: ${JSON.stringify([item])}`); 
      session.logs.push(`CUA message: ${JSON.stringify([item])}`);
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
    
    // Track consecutive API errors to avoid infinite error loops
    let consecutiveApiErrors = 0;
    
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
          
          // Track the number of consecutive wait loops to take more aggressive action
          session.waitLoopCount = (session.waitLoopCount || 0) + (isWaitLoop ? 1 : 0);
          
          if (isWaitLoop) {
            console.error(`Detected a wait loop - model is only calling wait. Consecutive wait loops: ${session.waitLoopCount}`);
            
            // Intervention based on the number of wait loops detected
            if (session.waitLoopCount === 1) {
              // First wait loop - gentle guidance
              session.items.push({
                type: 'message',
                content: [{
                  type: 'text',
                  text: "I notice you're waiting repeatedly. If you don't see the expected results, try clicking on a visible element or typing a more specific search in the search box, then press Enter."
                }]
              });
            } else if (session.waitLoopCount === 2) {
              // Second wait loop - more specific suggestion
              session.items.push({
                type: 'message',
                content: [{
                  type: 'text',
                  text: "You seem to be stuck in a wait loop. Try clicking on the search box and typing 'dinnerware sets' or 'dish set', then press Enter to search."
                }]
              });
              
              // Take action to try to click the search box
              try {
                const page = await computer.getPage();
                // Try to find and click the search box
                await page.evaluate(() => {
                  const searchInputs = Array.from(document.querySelectorAll('input[type="search"], input[type="text"]'));
                  const visibleInput = searchInputs.find(el => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
                  });
                  if (visibleInput) {
                    (visibleInput as HTMLElement).click();
                  }
                });
              } catch (e) {
                console.error("Failed to auto-click search box:", e);
              }
            } else if (session.waitLoopCount >= 3) {
              // Third or later wait loop - take direct action
              try {
                const page = await computer.getPage();
                
                // First try to find and click a search box
                const clickedSearch = await page.evaluate(() => {
                  const searchInputs = Array.from(document.querySelectorAll('input[type="search"], input[type="text"]'));
                  const visibleInput = searchInputs.find(el => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
                  });
                  if (visibleInput) {
                    (visibleInput as HTMLElement).click();
                    return true;
                  }
                  return false;
                });
                
                if (clickedSearch) {
                  // If we clicked a search box, try to clear it first, then type in it
                  try {
                    // Try to select all text and delete it
                    await page.keyboard.press('Control+a');
                    await page.keyboard.press('Backspace');
                  } catch (e) {
                    console.error("Failed to clear search box:", e);
                  }
                  
                  // Type the search term
                  await computer.type("dinnerware sets");
                  await computer.press("Enter");
                  
                  // Add message about our intervention
                  session.items.push({
                    type: 'message',
                    content: [{
                      type: 'text',
                      text: "I've searched for 'dinnerware sets' to help you find dish sets. Now I'll help you select one from the search results."
                    }]
                  });
                } else {
                  // If no search box found, try to click something interactive
                  await page.evaluate(() => {
                    // Try to find any interactive element
                    const interactiveElements = Array.from(document.querySelectorAll('a, button, [role="button"]'));
                    const visibleElement = interactiveElements.find(el => {
                      const style = window.getComputedStyle(el);
                      const rect = el.getBoundingClientRect();
                      return style.display !== 'none' && style.visibility !== 'hidden' && 
                             rect.width > 0 && rect.height > 0 && 
                             rect.top >= 0 && rect.left >= 0 && 
                             rect.top < window.innerHeight && rect.left < window.innerWidth;
                    });
                    if (visibleElement) {
                      (visibleElement as HTMLElement).click();
                    }
                  });
                  
                  session.items.push({
                    type: 'message',
                    content: [{
                      type: 'text',
                      text: "I tried clicking on an interactive element to help move forward. Please give me more specific instructions on what you'd like me to do on this page to find dish sets."
                    }]
                  });
                }
              } catch (e) {
                console.error("Failed to take automatic action:", e);
                session.items.push({
                  type: 'message',
                  content: [{
                    type: 'text',
                    text: "I'm having trouble navigating this page. Please provide more specific instructions for finding dish sets, such as 'Click on the search box' or 'Type dinnerware sets and press Enter'."
                  }]
                });
              }
            }
          } else {
            // Reset wait loop counter when we're not in a wait loop
            session.waitLoopCount = 0;
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
          // Filter out reasoning items if they don't have a computer_call following
          const filteredOutputItems = response.output.filter(item => {
            // Keep all non-reasoning items
            if (!('type' in item) || item.type !== 'reasoning') {
              return true;
            }
            
            // For reasoning items, check if there's a computer_call in the response
            const hasComputerCall = response.output.some(otherItem => 
              'type' in otherItem && otherItem.type === 'computer_call'
            );
            
            // Only keep reasoning if there's a computer_call in the response
            return hasComputerCall;
          });
          
          // Add filtered items to conversation context
          conversationContext.push(...filteredOutputItems);
          
          // Add the latest outputs produced in this round (like screenshots)
          if (newItems.length > 0) {
            conversationContext.push(...newItems);
          }
          
          // Check if we've reached the end of the conversation (no more computer calls)
          const hasComputerCalls = response.output.some(item => 
            'type' in item && item.type === 'computer_call'
          );
          
          if (!hasComputerCalls && response.output.some(item => 'role' in item && item.role === 'assistant')) {
            // Mark session as completed but don't end it - allow it to continue with future replies
            session.status = 'completed';
            console.error('CUA session waiting for next user input');
            break;
          }
        }
      } catch (error: any) {
        session.logs.push(`Error in CUA loop: ${error.message}`);
        console.error(`Error in CUA loop: ${error.message}`);
        
        // Increment consecutive API errors
        consecutiveApiErrors++;
        
        // If there are too many consecutive errors, break out of the loop
        if (consecutiveApiErrors >= 3) {
          console.error(`Too many consecutive API errors (${consecutiveApiErrors}), stopping session`);
          session.status = 'error';
          session.error = `Multiple API errors: ${error.message}`;
          session.endTime = Date.now();
          session.runningTime = session.endTime - session.startTime;
          break;
        }
        
        // If we get API errors, try with just the user instruction and a screenshot
        if (error.message.includes('API Error')) {
          console.error(`API error detected, simplifying context for next attempt`);
          
          // Log the API error to the action log
          session.actionLog.push({
            timestamp: Date.now(),
            action: 'API Error',
            details: `Error: ${error.message}. Resetting conversation context.`,
            success: false
          });
          
          // Reset conversation context to the minimal needed
          conversationContext = [];
          
          // Just include user instruction
          if (userInstruction) {
            conversationContext.push(userInstruction);
          }
          
          // Take a new screenshot
          const newScreenshot = await computer.screenshot();
          session.images.push(newScreenshot);
          
          // Get current URL
          const currentUrl = await computer.getCurrentUrl();
          
          // Add a new screenshot to the context
          conversationContext.push({
            type: 'computer_call',
            call_id: `screenshot_reset_${Date.now()}`,
            action: {
              type: 'screenshot'
            }
          });
          
          conversationContext.push({
            type: 'computer_call_output',
            call_id: `screenshot_reset_${Date.now()}`,
            output: {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${newScreenshot}`,
              current_url: currentUrl
            }
          });
          
          // Log the recovery action
          session.actionLog.push({
            timestamp: Date.now(),
            action: 'Reset Context',
            details: 'Simplified conversation context and took a new screenshot to recover from API error',
            success: true,
            url: currentUrl
          });
          
          // Add a message to help the user understand what's happening
          session.items.push({
            type: 'message',
            content: [{
              type: 'text',
              text: "I encountered an issue with the API. I've reset our conversation and will try again with your original request. Please be patient."
            }]
          });
          
          // Continue the loop with the simplified context
          continue;
        }
        
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
      
      // Reset consecutive API errors counter on successful loop
      consecutiveApiErrors = 0;
    }
  } catch (error: any) {
    // Handle terminal errors
    console.error(`Fatal error in CUA session: ${error.message}`);
    
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
          console.error('Created new browser page for CUA session');
        } else {
          page = context.existingPage();
        }
        
        // Use the same waitUntil option as browser_navigate
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        
        // Use same cap on load event as browser_navigate 
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        
        console.error(`Navigated to: ${url} for CUA session`);
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
      actionLog: [{
        timestamp: Date.now(),
        action: 'Session Created',
        details: `New CUA session created with instructions: "${validatedParams.instructions.substring(0, 50)}${validatedParams.instructions.length > 50 ? '...' : ''}"`,
        success: true
      }],
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
  waitSeconds: z.number().optional().default(5).describe('Time in seconds to wait for session completion (defaults to 5 seconds). Set to 0 to check status immediately without waiting.'),
});

export const agentStatus: Tool = {
  schema: {
    name: 'agent_status',
    description: 'Check the status of the running agent session. Waits for 5 seconds by default to allow the agent to complete its current action before reporting status. Use to check if the agent has finished processing or needs more input.',
    inputSchema: zodToJsonSchema(agentStatusSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentStatusSchema.parse(params);
    // Default is now handled by schema, but we extract it here
    const { waitSeconds } = validatedParams;

    // Get the most recent session
    const sessionEntries = Array.from(sessions.entries());
    if (sessionEntries.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }
    
    // Sort sessions by start time, descending (most recent first)
    sessionEntries.sort((a, b) => b[1].startTime - a[1].startTime);
    const [latestSessionId, session] = sessionEntries[0];

    // If wait time is specified and session is still running, wait
    if (waitSeconds > 0 && (session.status === 'starting' || session.status === 'running')) {
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
    }

    // Get the last few actions for a summary
    const recentActions = session.actionLog
      .slice(-5) // Get last 5 actions
      .map(entry => ({
        time: new Date(entry.timestamp).toISOString(),
        action: entry.action,
        details: entry.details,
        success: entry.success
      }));
    
    // Count successful and failed actions
    const successfulActions = session.actionLog.filter(entry => entry.success).length;
    const failedActions = session.actionLog.filter(entry => !entry.success).length;
    const totalActions = session.actionLog.length;

    // Get the last action if available
    const lastAction = session.actionLog.length > 0 
      ? session.actionLog[session.actionLog.length - 1]
      : null;
    
    // Extract the last message (without any image data)
    const lastMessageInfo = getLastMessageInfo(session.items);
    
    // Get the current status (minimal information, no images)
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: session.status,
          runningTime: session.status === 'running'
            ? Date.now() - session.startTime
            : session.runningTime,
          lastAction: lastAction ? {
            action: lastAction.action,
            details: lastAction.details,
            success: lastAction.success,
            time: new Date(lastAction.timestamp).toISOString()
          } : null,
          messageWaiting: session.status === 'completed',
          lastMessageType: lastMessageInfo.type,
          lastMessageSummary: lastMessageInfo.summary,
          error: session.error
        })
      }],
    };
  },
};

// Agent log schema
const agentLogSchema = z.object({
  includeImages: z.boolean().optional().describe('EXPENSIVE: Whether to include images in the log (defaults to false). Including images uses many tokens and should be avoided unless necessary'),
  maxMessages: z.number().optional().default(2).describe('Maximum number of recent conversation messages to include (defaults to 2)'),
  maxLogs: z.number().optional().default(5).describe('Maximum number of recent log entries to include (defaults to 5)'),
  maxActions: z.number().optional().default(3).describe('Maximum number of recent actions to include (defaults to 3)'),
});

export const agentLog: Tool = {
  schema: {
    name: 'agent_log',
    description: 'Get a summary log of an agent session. Returns minimal data by default to conserve tokens: only 2 recent messages, 5 log entries, and 3 actions. Customize with maxMessages, maxLogs, and maxActions parameters. Does NOT include screenshots by default.',
    inputSchema: zodToJsonSchema(agentLogSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    const validatedParams = agentLogSchema.parse(params);
    const { 
      includeImages = false,
      maxMessages = 2,
      maxLogs = 5,
      maxActions = 3
    } = validatedParams;

    // Get the most recent session
    const sessionEntries = Array.from(sessions.entries());
    if (sessionEntries.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }
    
    // Sort sessions by start time, descending (most recent first)
    sessionEntries.sort((a, b) => b[1].startTime - a[1].startTime);
    const [latestSessionId, session] = sessionEntries[0];

    // Format the action log for display with timestamps
    const formattedActionLog = session.actionLog.map(entry => ({
      time: new Date(entry.timestamp).toISOString(),
      action: entry.action,
      details: entry.details,
      success: entry.success,
      url: entry.url || ''
    }));

    // Format the logs as an array of separate entries for better display
    // Create a more readable summary first
    const summaryResult = {
      status: session.status,
      sessionId: latestSessionId,
      startTime: new Date(session.startTime).toISOString(),
      endTime: session.endTime ? new Date(session.endTime).toISOString() : undefined,
      runningTime: session.status === 'running'
        ? Date.now() - session.startTime
        : session.runningTime,
      actions: {
        total: formattedActionLog.length,
        successful: formattedActionLog.filter(a => a.success).length,
        failed: formattedActionLog.filter(a => !a.success).length
      },
      error: session.error
    };
    
    // Return logs as formatted text entries rather than a big JSON blob
    const content = [
      { type: 'text' as const, text: `Session Summary: ${JSON.stringify(summaryResult, null, 2)}` }
    ];
    
    // Add only a limited number of recent actions to save tokens
    if (formattedActionLog.length > 0 && maxActions > 0) {
      content.push({ 
        type: 'text' as const, 
        text: `\nRecent Actions (${Math.min(maxActions, formattedActionLog.length)} of ${formattedActionLog.length}):\n${JSON.stringify(formattedActionLog.slice(-maxActions), null, 2)}` 
      });
    }
    
    // Add a limited number of recent log entries
    if (session.logs.length > 0 && maxLogs > 0) {
      content.push({ 
        type: 'text' as const, 
        text: `\nRecent Logs (${Math.min(maxLogs, session.logs.length)} of ${session.logs.length}):\n${session.logs.slice(-maxLogs).join('\n')}` 
      });
    }
    
    // Add both user messages and output_text messages (CUA conversation)
    const conversation = [];
    
    // Extract messages in conversational order
    for (const item of session.items) {
      if ('role' in item && item.role === 'user') {
        conversation.push({
          role: 'user',
          text: item.content
        });
      } else if ('type' in item && item.type === 'output_text') {
        conversation.push({
          role: 'assistant',
          text: item.text
        });
      }
    }
    
    // Show just the most recent conversation entries, limited by maxMessages
    const recentConversation = maxMessages > 0 ? conversation.slice(-maxMessages) : [];
    
    if (recentConversation.length > 0) {
      content.push({ 
        type: 'text' as const, 
        text: `\nRecent Conversation (${recentConversation.length} of ${conversation.length}):\n${recentConversation.map(msg => 
          `${msg.role === 'user' ? '👤 User' : '🤖 CUA'}: ${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}`
        ).join('\n\n')}` 
      });
    }
    
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
const agentEndSchema = z.object({});

export const agentEnd: Tool = {
  schema: {
    name: 'agent_end',
    description: 'Forcefully end an agent session',
    inputSchema: zodToJsonSchema(agentEndSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    agentEndSchema.parse(params);

    // Get the most recent session
    const sessionEntries = Array.from(sessions.entries());
    if (sessionEntries.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }
    
    // Sort sessions by start time, descending (most recent first)
    sessionEntries.sort((a, b) => b[1].startTime - a[1].startTime);
    const [latestSessionId, session] = sessionEntries[0];

    // Get current status before ending
    const previousStatus = session.status;

    // Update session status
    session.status = 'completed';
    session.endTime = Date.now();
    session.runningTime = session.endTime - session.startTime;
    session.logs.push('Session forcefully ended');

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'ended',
          message: 'Session ended successfully',
          previousStatus
        })
      }],
    };
  },
};

// Get the last image schema
const agentGetLastImageSchema = z.object({});

export const agentGetLastImage: Tool = {
  schema: {
    name: 'agent_get_last_image',
    description: 'EXPENSIVE: Get the last screenshot from an agent session. Uses many tokens due to image size. Only use when explicitly requested by user.',
    inputSchema: zodToJsonSchema(agentGetLastImageSchema),
  },

  handle: async (context: Context, params?: Record<string, any>): Promise<ToolResult> => {
    agentGetLastImageSchema.parse(params);

    // Get the most recent session
    const sessionEntries = Array.from(sessions.entries());
    if (sessionEntries.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }
    
    // Sort sessions by start time, descending (most recent first)
    sessionEntries.sort((a, b) => b[1].startTime - a[1].startTime);
    const [latestSessionId, session] = sessionEntries[0];

    // Check if there are any images
    if (session.images.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No images available for current session' }) }],
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
    const { replyText } = validatedParams;

    // Get the most recent session
    const sessionEntries = Array.from(sessions.entries());
    if (sessionEntries.length === 0) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No active session found' }) }],
        isError: true,
      };
    }
    
    // Sort sessions by start time, descending (most recent first)
    sessionEntries.sort((a, b) => b[1].startTime - a[1].startTime);
    const [latestSessionId, session] = sessionEntries[0];

    // Check if the session can accept replies
    if (session.status !== 'completed' && session.status !== 'running') {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session cannot accept replies (status: ${session.status})` }) }],
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
              error: 'No OpenAI API key found in environment'
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
          const session = sessions.get(latestSessionId);
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
                  
                  // Filter out reasoning items if they don't have a computer_call following
                  const filteredOutputItems = response.output.filter(item => {
                    // Keep all non-reasoning items
                    if (!('type' in item) || item.type !== 'reasoning') {
                      return true;
                    }
                    
                    // For reasoning items, check if there's a computer_call in the response
                    const hasComputerCall = response.output.some(otherItem => 
                      'type' in otherItem && otherItem.type === 'computer_call'
                    );
                    
                    // Only keep reasoning if there's a computer_call in the response
                    return hasComputerCall;
                  });
                  
                  // Add filtered items to conversation context
                  conversationContext.push(...filteredOutputItems);
                  
                  // Add the latest outputs produced in this round
                  if (newItems.length > 0) {
                    conversationContext.push(...newItems);
                  }
                  
                  // Check if we've reached the end of the conversation
                  const hasComputerCalls = response.output.some(item => 
                    'type' in item && item.type === 'computer_call'
                  );
                  
                  if (!hasComputerCalls && response.output.some(item => 'role' in item && item.role === 'assistant')) {
                    // Just mark as completed but ready for more input
                    session.status = 'completed';
                    console.error(`CUA session ${latestSessionId} waiting for next user input`);
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
            console.error(`Fatal error in CUA session: ${error.message}`);
            
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
          status: session.status,
          message: 'Reply sent successfully' 
        }) 
      }],
    };
  },
};
