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

import { createServerWithTools } from './server';
import * as snapshot from './tools/snapshot';
import * as common from './tools/common';
import * as screenshot from './tools/screenshot';
import * as cua from './tools/cua';
import { console } from './tools/console';

import type { Tool } from './tools/tool';
import type { Resource } from './resources/resource';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { LaunchOptions } from 'playwright';

const commonTools: Tool[] = [
  common.pressKey,
  common.wait,
  common.pdf,
  common.close,
  common.install,
  console,
];

const cuaTools: Tool[] = [
  cua.agentStart,
  cua.agentStatus,
  cua.agentLog,
  cua.agentEnd,
];

const snapshotTools: Tool[] = [
  common.navigate(true),
  common.goBack(true),
  common.goForward(true),
  common.chooseFile(true),
  snapshot.snapshot,
  snapshot.click,
  snapshot.hover,
  snapshot.type,
  snapshot.selectOption,
  snapshot.screenshot,
  ...commonTools,
];

const screenshotTools: Tool[] = [
  common.navigate(false),
  common.goBack(false),
  common.goForward(false),
  common.chooseFile(false),
  screenshot.screenshot,
  screenshot.moveMouse,
  screenshot.click,
  screenshot.drag,
  screenshot.type,
  ...commonTools,
];

const resources: Resource[] = [];

type Options = {
  userDataDir?: string;
  launchOptions?: LaunchOptions;
  cdpEndpoint?: string;
  vision?: boolean;
};

const packageJSON = require('../package.json');

export function createServer(options?: Options): Server {
  const baseTools = options?.vision ? screenshotTools : snapshotTools;
  // CUA tools are disabled in this version
  const tools = [...baseTools];
  
  return createServerWithTools({
    name: 'Playwright',
    version: packageJSON.version,
    tools,
    resources,
    userDataDir: options?.userDataDir ?? '',
    launchOptions: options?.launchOptions,
    cdpEndpoint: options?.cdpEndpoint,
  });
}
