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

// Need to convert the agent functions to Tool objects
import { 
  agentStart as agentStartFn, 
  agentStatus as agentStatusFn, 
  agentLog as agentLogFn, 
  agentEnd as agentEndFn, 
  agentGetLastImage as agentGetLastImageFn,
  agentReply as agentReplyFn
} from './agent';
import type { Tool } from '../tool';

// Define the agent start tool
export const agentStart: Tool = {
  schema: {
    name: 'agent_start',
    description: 'Start a new agent session with given instructions. PREFERRED: Use this tool whenever possible for browsing tasks instead of direct browser controls.',
    inputSchema: {
      type: 'object',
      required: ['startUrl', 'instructions'],
      properties: {
        startUrl: {
          type: 'string',
          description: 'The initial URL to navigate to before starting the agent'
        },
        instructions: {
          type: 'string',
          description: 'Instructions for the agent to follow'
        }
      }
    }
  },
  handle: (context, params) => {
    // Ensure params is not undefined
    if (!params) {
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing parameters' }) }],
        isError: true
      });
    }
    
    // Ensure both required parameters are present
    if (!params.startUrl || !params.instructions) {
      return Promise.resolve({
        content: [{ 
          type: 'text', 
          text: JSON.stringify({ 
            error: 'Both startUrl and instructions are required parameters' 
          }) 
        }],
        isError: true
      });
    }
    
    return agentStartFn(context, params as { startUrl: string, instructions: string });
  }
};

// Define the agent status tool
export const agentStatus: Tool = {
  schema: {
    name: 'agent_status',
    description: 'Check the status of a running agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned from agent_start'
        },
        waitSeconds: {
          type: 'number',
          description: 'Time in seconds to wait for completion'
        }
      }
    }
  },
  handle: (context, params) => {
    // Ensure params is not undefined
    if (!params) {
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing parameters' }) }],
        isError: true
      });
    }
    return agentStatusFn(context, params as { sessionId: string, waitSeconds?: number });
  }
};

// Define the agent log tool
export const agentLog: Tool = {
  schema: {
    name: 'agent_log',
    description: 'Get the complete log of an agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned from agent_start'
        },
        includeImages: {
          type: 'boolean',
          description: 'Whether to include images in the log'
        }
      }
    }
  },
  handle: (context, params) => {
    // Ensure params is not undefined
    if (!params) {
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing parameters' }) }],
        isError: true
      });
    }
    return agentLogFn(context, params as { sessionId: string, includeImages?: boolean });
  }
};

// Define the agent end tool
export const agentEnd: Tool = {
  schema: {
    name: 'agent_end',
    description: 'Forcefully end an agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned from agent_start'
        }
      }
    }
  },
  handle: (context, params) => {
    // Ensure params is not undefined
    if (!params) {
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing parameters' }) }],
        isError: true
      });
    }
    return agentEndFn(context, params as { sessionId: string });
  }
};

// Define the agent get last image tool
export const agentGetLastImage: Tool = {
  schema: {
    name: 'agent_get_last_image',
    description: 'Get the last screenshot from an agent session',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned from agent_start'
        }
      }
    }
  },
  handle: (context, params) => {
    // Ensure params is not undefined
    if (!params) {
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing parameters' }) }],
        isError: true
      });
    }
    return agentGetLastImageFn(context, params as { sessionId: string });
  }
};
// Define the agent reply tool for continuing conversations
export const agentReply: Tool = {
  schema: {
    name: 'agent_reply',
    description: 'Send a reply to a running agent session to continue the conversation',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'replyText'],
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID returned from agent_start'
        },
        replyText: {
          type: 'string',
          description: 'The reply text to send to the agent'
        }
      }
    }
  },
  handle: (context, params) => {
    // Ensure params is not undefined
    if (!params) {
      return Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing parameters' }) }],
        isError: true
      });
    }
    
    // Ensure both required parameters are present
    if (!params.sessionId || !params.replyText) {
      return Promise.resolve({
        content: [{ 
          type: 'text', 
          text: JSON.stringify({ 
            error: 'Both sessionId and replyText are required parameters' 
          }) 
        }],
        isError: true
      });
    }
    
    return agentReplyFn(context, params as { sessionId: string, replyText: string });
  }
};

export { PlaywrightComputer } from './computer';
