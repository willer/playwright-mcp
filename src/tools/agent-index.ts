/**
 * Index file for registering CUA tools.
 */
import { Tool } from './tool';
import { agentStart, agentStatus, agentLog, agentEnd, agentGetLastImage, agentReply, initializeAgentManager } from './agent-tools';

// Try to get the API key from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize agent manager if OpenAI API key is available
if (OPENAI_API_KEY) {
  initializeAgentManager(OPENAI_API_KEY);
} else {
  console.error('[WARN] OPENAI_API_KEY environment variable not found. CUA tools will not function properly.');
}

// Export all CUA tools
export const agentTools: Tool[] = [
  agentStart,
  agentStatus,
  agentLog,
  agentEnd,
  agentGetLastImage,
  agentReply
];

// Export a function to register all tools
export function registerAgentTools(): Tool[] {
  return agentTools;
}