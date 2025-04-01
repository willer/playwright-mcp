import { Tool, ToolResult } from './tool';
import { BrowserContext } from 'playwright';
import { AgentManager } from './agent';
import { chromium } from 'playwright';
import { Context } from '../context';
import { createUserDataDir } from './utils';

// Initialize the agent manager
let agentManager: AgentManager;

// Initialize the agent manager with the API key
export function initializeAgentManager(apiKey: string): void {
  agentManager = new AgentManager(apiKey);
}

/**
 * Get or create storage state for persistent sessions
 */
async function getOrCreateStorageState(userDataDir: string): Promise<any> {
  // Import modules inside the function to avoid circular dependencies
  const fs = await import('fs/promises');
  const path = await import('path');
  
  // Path to the storage state file
  const storageStatePath = path.join(userDataDir, 'storage-state.json');
  
  try {
    // Try to read existing storage state
    const storageStateContent = await fs.readFile(storageStatePath, 'utf-8');
    return JSON.parse(storageStateContent);
  } catch (error) {
    // If the file doesn't exist, create a new empty storage state
    const emptyStorageState = {
      cookies: [],
      origins: []
    };
    
    // Save it to the file for future use
    await fs.writeFile(storageStatePath, JSON.stringify(emptyStorageState, null, 2));
    
    return emptyStorageState;
  }
}

/**
 * Start a new agent session
 */
export const agentStart: Tool = {
  schema: {
    name: 'agent_start',
    description: 'Start a new agent session with given instructions. PREFERRED: Use this tool whenever possible for browsing tasks instead of direct browser controls.',
    inputSchema: {
      type: 'object',
      required: ['instructions'],
      properties: {
        instructions: { type: 'string' },
        startUrl: { type: 'string' }
      }
    }
  },
  async handle(context: Context, params?: Record<string, any>): Promise<ToolResult> {
    if (!params || !params.instructions) {
      return {
        content: [{ type: 'text', text: 'Missing required parameter: instructions' }],
        isError: true
      };
    }
    if (!agentManager) {
      throw new Error('Agent manager not initialized. Please set the OPENAI_API_KEY environment variable.');
    }
    
    const { instructions } = params;
    
    // Get start URL from parameters or extract from instructions
    let startUrl = params.startUrl || 'https://www.bing.com';
    
    // If no start URL provided, try to extract it from instructions
    if (!params.startUrl) {
      const urlMatch = instructions.match(/https?:\/\/[^\s)]+/);
      if (urlMatch) {
        startUrl = urlMatch[0];
      }
    }
    
    // Create user data directory for persistent sessions
    const userDataDir = await createUserDataDir();
    console.error(`[DEBUG] Using user data directory: ${userDataDir}`);
    
    // Launch Chromium with persistent user data
    const browser = await chromium.launch({ 
      headless: false,
      // No channel specified = use Chromium
    });
    
    // Create a browser context with the user data directory
    // This will preserve sessions, cookies, etc. across runs
    const browserContext = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      storageState: await getOrCreateStorageState(userDataDir)
    });
    
    // Start the session
    const sessionId = await agentManager.startSession(browserContext, startUrl, instructions);
    
    return {
      content: [{ type: 'text', text: JSON.stringify({
        sessionId,
        status: 'running',
        message: 'Agent session started successfully'
      }) }]
    };
  }
};

/**
 * Check the status of a running agent session
 */
export const agentStatus: Tool = {
  schema: {
    name: 'agent_status',
    description: 'Check the status of a running agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        waitSeconds: { type: 'number' }
      }
    }
  },
  async handle(context: Context, params?: Record<string, any>): Promise<ToolResult> {
    if (!params || !params.sessionId) {
      return {
        content: [{ type: 'text', text: 'Missing required parameter: sessionId' }],
        isError: true
      };
    }
    if (!agentManager) {
      throw new Error('Agent manager not initialized');
    }
    
    const { sessionId, waitSeconds } = params;
    
    // If waitSeconds is specified, wait for completion or timeout
    if (waitSeconds) {
      const maxWaitTime = waitSeconds * 1000;
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        const session = agentManager.getSession(sessionId);
        
        if (!session) {
          return {
            content: [{ type: 'text', text: `Session ${sessionId} not found` }],
            isError: true
          };
        }
        
        // If the session is completed or errored, return the status
        if (session.status !== 'running') {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              sessionId,
              status: session.status,
              runningTime: session.runningTime,
              lastMessage: session.logs[session.logs.length - 1],
              error: session.error
            }) }]
          };
        }
        
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // If we get here, we timed out
      const timeoutSession = agentManager.getSession(sessionId);
      if (!timeoutSession) {
        return {
          content: [{ type: 'text', text: `Session ${sessionId} not found` }],
          isError: true
        };
      }
      
      return {
        content: [{ type: 'text', text: JSON.stringify({
          sessionId,
          status: timeoutSession.status,
          timeElapsed: Date.now() - timeoutSession.startTime,
          message: 'Still running'
        }) }]
      };
    }
    
    // If no waitSeconds, just return the current status
    const session = agentManager.getSession(sessionId);
    
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true
      };
    }
    
    return {
      content: [{ type: 'text', text: JSON.stringify({
        sessionId,
        status: session.status,
        timeElapsed: session.status === 'running' 
          ? Date.now() - session.startTime 
          : session.runningTime,
        message: session.status === 'running' 
          ? 'Session is running' 
          : 'Session has completed',
        error: session.error
      }) }]
    };
  }
};

/**
 * Get the complete log of an agent session
 */
export const agentLog: Tool = {
  schema: {
    name: 'agent_log',
    description: 'Get the complete log of an agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        includeImages: { type: 'boolean' }
      }
    }
  },
  async handle(context: Context, params?: Record<string, any>): Promise<ToolResult> {
    if (!params || !params.sessionId) {
      return {
        content: [{ type: 'text', text: 'Missing required parameter: sessionId' }],
        isError: true
      };
    }
    if (!agentManager) {
      throw new Error('Agent manager not initialized');
    }
    
    const { sessionId, includeImages = false } = params;
    
    const session = agentManager.getSession(sessionId);
    
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true
      };
    }
    
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
    
    if (includeImages) {
      result.images = session.images;
    }
    
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }]
    };
  }
};

/**
 * Forcefully end an agent session
 */
export const agentEnd: Tool = {
  schema: {
    name: 'agent_end',
    description: 'Forcefully end an agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' }
      }
    }
  },
  async handle(context: Context, params?: Record<string, any>): Promise<ToolResult> {
    if (!params || !params.sessionId) {
      return {
        content: [{ type: 'text', text: 'Missing required parameter: sessionId' }],
        isError: true
      };
    }
    if (!agentManager) {
      throw new Error('Agent manager not initialized');
    }
    
    const { sessionId } = params;
    console.error(`[DEBUG] Ending session ${sessionId}`);
    
    // Get session before ending
    const sessionBefore = agentManager.getSession(sessionId);
    if (!sessionBefore) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true
      };
    }
    
    console.error(`[DEBUG] Current session status: ${sessionBefore.status}`);
    
    // Force the session to end (regardless of current status)
    const success = await agentManager.endSession(sessionId);
    
    if (!success) {
      return {
        content: [{ type: 'text', text: `Failed to end session ${sessionId}` }],
        isError: true
      };
    }
    
    return {
      content: [{ type: 'text', text: JSON.stringify({
        sessionId,
        status: 'ended',
        message: 'Session ended successfully',
        previousStatus: sessionBefore.status
      }) }]
    };
  }
};

/**
 * Get the last screenshot from an agent session
 */
export const agentGetLastImage: Tool = {
  schema: {
    name: 'agent_get_last_image',
    description: 'Get the last screenshot from an agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' }
      }
    }
  },
  async handle(context: Context, params?: Record<string, any>): Promise<ToolResult> {
    if (!params || !params.sessionId) {
      return {
        content: [{ type: 'text', text: 'Missing required parameter: sessionId' }],
        isError: true
      };
    }
    if (!agentManager) {
      throw new Error('Agent manager not initialized');
    }
    
    const { sessionId } = params;
    
    const session = agentManager.getSession(sessionId);
    
    if (!session) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true
      };
    }
    
    if (session.images.length === 0) {
      return {
        content: [{ type: 'text', text: `No images available for session ${sessionId}` }],
        isError: true
      };
    }
    
    const lastImage = session.images[session.images.length - 1];
    
    return {
      content: [
        { type: 'text', text: JSON.stringify({
          sessionId,
          status: session.status
        }) },
        { 
          type: 'image', 
          data: lastImage,
          mimeType: 'image/jpeg'
        }
      ]
    };
  }
};

/**
 * Send a reply to continue a conversation
 */
export const agentReply: Tool = {
  schema: {
    name: 'agent_reply',
    description: 'Send a reply to a running agent session to continue the conversation',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'replyText'],
      properties: {
        sessionId: { type: 'string' },
        replyText: { type: 'string' }
      }
    }
  },
  async handle(context: Context, params?: Record<string, any>): Promise<ToolResult> {
    if (!params || !params.sessionId || !params.replyText) {
      return {
        content: [{ type: 'text', text: 'Missing required parameters: sessionId and/or replyText' }],
        isError: true
      };
    }
    if (!agentManager) {
      throw new Error('Agent manager not initialized');
    }
    
    const { sessionId, replyText } = params;
    console.error(`[DEBUG] Sending reply to session ${sessionId}: "${replyText}"`);
    
    // Get the session before sending the reply
    const sessionBefore = agentManager.getSession(sessionId);
    if (!sessionBefore) {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} not found` }],
        isError: true
      };
    }
    
    // Sessions in 'completed' status are waiting for more input
    // Sessions in 'running' status can technically accept input too (though that's unusual)
    if (sessionBefore.status !== 'completed' && sessionBefore.status !== 'running') {
      return {
        content: [{ type: 'text', text: `Session ${sessionId} cannot accept replies (status: ${sessionBefore.status})` }],
        isError: true
      };
    }
    
    // Send the reply
    const success = await agentManager.sendReply(sessionId, replyText);
    
    if (!success) {
      return {
        content: [{ type: 'text', text: `Failed to send reply to session ${sessionId}` }],
        isError: true
      };
    }
    
    // Get the session again to check its status
    const sessionAfter = agentManager.getSession(sessionId);
    
    return {
      content: [{ type: 'text', text: JSON.stringify({
        sessionId,
        status: sessionAfter ? sessionAfter.status : 'unknown',
        message: 'Reply sent successfully, waiting for response',
        itemCount: sessionAfter ? sessionAfter.items.length : 0
      }) }]
    };
  }
};