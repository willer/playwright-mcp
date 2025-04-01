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
/**
 * Index file for registering CUA tools.
 */
import { Tool } from './tool';
import { agentStart, agentStatus, agentLog, agentEnd, agentGetLastImage, agentReply, initializeAgentManager } from './agent-tools';

// Try to get the API key from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize agent manager if OpenAI API key is available
if (OPENAI_API_KEY)
  initializeAgentManager(OPENAI_API_KEY);

// No warning message - the tools will just be non-functional if key isn't available

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
