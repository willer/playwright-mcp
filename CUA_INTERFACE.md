# Computer Use Agent (CUA) Interface Specification

This document outlines the interface and implementation details for the Computer Use Agent (CUA) in the Playwright MCP project.

## Core Components

### 1. Computer Interface

The `PlaywrightComputer` class provides a bridge between the AI agent and the browser:

```typescript
class PlaywrightComputer {
  // Creates a new instance with the given context
  constructor(context: Context);
  
  // Browser actions
  async screenshot(): Promise<string>;  // Returns base64 JPEG
  async click(x: number, y: number, button?: string): Promise<void>;
  async doubleClick(x: number, y: number): Promise<void>;
  async type(text: string): Promise<void>;
  async press(key: string): Promise<void>;
  async wait(ms: number): Promise<void>;
  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  async move(x: number, y: number): Promise<void>;
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void>;
  async navigate(url: string): Promise<void>;
  async getCurrentUrl(): Promise<string>;
  async getBrowserCapabilities(): Promise<{width: number, height: number}>;
  async close(): Promise<void>;
}
```

### 2. Agent Session Management

The CUA needs to manage long-running sessions and maintain state between interactions:

```typescript
interface SessionInfo {
  sessionId: string;
  computer: PlaywrightComputer;
  status: 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;
  error?: string;
  logs: string[];
  images: string[];
  items: any[]; // Conversation items
  runningTime?: number;
}
```

### 3. Tool Interfaces

The CUA exposes several tools for external systems to interact with:

```typescript
// Start a new agent session
export const agentStart: Tool = {
  schema: {
    name: 'agent_start',
    description: 'Start a new agent session with given instructions',
    inputSchema: {
      type: 'object',
      required: ['startUrl', 'instructions'],
      properties: {
        startUrl: { type: 'string' },
        instructions: { type: 'string' }
      }
    }
  }
};

// Check agent status
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
  }
};

// Get complete agent logs
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
  }
};

// End an agent session
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
  }
};

// Get the last screenshot
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
  }
};

// Send a reply to continue a conversation
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
  }
};
```

## Communication Flow

### Agent Lifecycle

1. **Initialization**:
   - User calls `agent_start` with URL and instructions
   - System creates a new session and computer
   - Browser navigates to the URL
   - Initial screenshot is taken
   - Background process starts for agent execution

2. **Execution Loop**:
   - Agent analyzes screenshot and instructions
   - Agent decides action to take (click, type, etc.)
   - Action is executed in the browser
   - New screenshot is taken
   - Loop continues until complete or error

3. **Completion**:
   - Agent responds with final message
   - Session marked as completed
   - Results available through `agent_log` or `agent_status`

4. **Continuation (optional)**:
   - User can continue with `agent_reply`
   - Adds user message to conversation
   - Restarts execution loop

## API Communication

The CUA uses OpenAI's Computer Use Agent API with the following structure:

```typescript
// Request structure
const request = {
  model: 'computer-use-preview',
  input: [
    { role: 'user', content: instructions },
    // Additional items from previous actions
  ],
  tools: [
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
                  enum: ["click", "type", "navigate", "press", "scroll", "doubleClick", "wait", "move", "drag"]
                }
              },
              required: ["type"]
            }
          },
          required: ["action"]
        }
      }
    }
  ],
  truncation: 'auto'
};

// Response handling
// 1. Computer action tool call
if (item.type === 'tool_call' && item.function.name === 'computer') {
  // Parse action from arguments
  const action = JSON.parse(item.function.arguments).action;
  
  // Execute action
  await computer[action.type](...Object.values(actionArgs));
  
  // Take screenshot
  const screenshot = await computer.screenshot();
  
  // Return tool result with screenshot
  return {
    type: 'tool_result',
    tool_call_id: item.id,
    output: JSON.stringify({
      browser: {
        screenshot: screenshotBase64,
        current_url: currentUrl
      }
    })
  };
}

// 2. Message response (completion)
if (item.type === 'message') {
  // Process final message
  // Session is complete
}
```

## Testing Strategy

The CUA implementation includes a testing approach that:

1. Mocks the OpenAI API for reliable testing
2. Directly tests agent loop with controlled inputs
3. Validates browser actions are properly executed
4. Tests error handling and recovery
5. Ensures proper session management

The `agent-internal.ts` file provides versions of key functions exposed specifically for testing, allowing unit tests to validate the implementation without external dependencies.

## Security and Error Handling

1. All external inputs are validated
2. Error states properly captured and reported
3. Resources properly cleaned up when sessions end
4. No sensitive data logged in plain text
5. Rate limits and timeouts respected

## Implementation Recommendations

1. Use the Builder pattern for cleaner instantiation
2. Separate OpenAI API integration into a client class
3. Add telemetry for operation monitoring
4. Use stronger typing for conversation items
5. Implement retries for transient failures