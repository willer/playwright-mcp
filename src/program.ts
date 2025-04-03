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

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { program } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';


import { createServer } from './index';
import { ServerList } from './server';

import type { LaunchOptions } from 'playwright';
import assert from 'assert';

const packageJSON = require('../package.json');

program
    .version('Version ' + packageJSON.version)
    .name(packageJSON.name)
    .option('--browser <browser>', 'Browser or chrome channel to use, possible values: chrome, firefox, webkit, msedge, brave.')
    .option('--cdp-endpoint <endpoint>', 'CDP endpoint to connect to.')
    .option('--executable-path <path>', 'Path to the browser executable.')
    .option('--headless', 'Run browser in headless mode, headed by default')
    .option('--port <port>', 'Port to listen on for SSE transport.')
    .option('--user-data-dir <path>', 'Path to the user data directory')
    .option('--vision', 'Run server that uses screenshots (Aria snapshots are used by default)')
    .action(async options => {
      // Include our custom browser types even though they will be mapped to standard ones
      let browserName: 'chromium' | 'firefox' | 'webkit' | 'brave' | 'msedge';
      let channel: string | undefined;
      let executablePath = options.executablePath;
      let useBraveDirectly = false; // Flag to indicate we're using Brave directly
      
      switch (options.browser) {
        case 'chrome':
        case 'chrome-beta':
        case 'chrome-canary':
        case 'chrome-dev':
        case 'msedge':
        case 'msedge-beta':
        case 'msedge-canary':
        case 'msedge-dev':
          browserName = 'chromium';
          channel = options.browser;
          break;
        case 'brave':
          browserName = 'chromium'; // Set to a type that Playwright knows
          useBraveDirectly = true;  // Flag that we're launching Brave directly
          
          // Set Brave executable path if not specified
          if (!executablePath) {
            const platform = process.platform;
            if (platform === 'darwin') {
              // macOS
              const arm64Path = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
              const x64Path = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
              executablePath = fs.existsSync(arm64Path) ? arm64Path : x64Path;
              console.error(`Using Brave executable: ${executablePath}`);
            } else if (platform === 'win32') {
              // Windows
              executablePath = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
            } else if (platform === 'linux') {
              // Linux
              executablePath = '/usr/bin/brave-browser';
            }
          }
          break;
        case 'chromium':
          browserName = 'chromium';
          break;
        case 'firefox':
          browserName = 'firefox';
          break;
        case 'webkit':
          browserName = 'webkit';
          break;
        default:
          browserName = 'chromium';
          // Use Chromium directly instead of Chrome
          channel = undefined;
      }

      // Set up browser-specific arguments
      const args = [];
      
      // We'll use ignoreAllDefaultArgs: true and add back only what we need
      if (options.browser === 'msedge') {
        args.push(
          '--enable-extensions',
          '--disable-extensions-file-access-check',
          '--allow-outdated-plugins',
          '--disable-extension-http-throttling',
          '--disable-features=ExtensionsToolbarMenu', // Try to ensure extensions menu is not disabled
          '--enable-easy-off-store-extension-install'
        );
      } else if (options.browser === 'brave') {
        // For Brave, we want minimal arguments, just enough to ensure extensions work
        args.push(
          '--enable-extensions',
          '--no-sandbox',
          '--enable-automation=false',
          '--no-first-run'
        );
      } else {
        // For other browsers, use a standard set of arguments
        args.push(
          '--enable-extensions',
          '--no-sandbox',
          '--no-first-run'
        );
      }
      
      const launchOptions: LaunchOptions = {
        headless: !!options.headless,
        channel,
        executablePath,
        ignoreDefaultArgs: true, // Take full control of the launch arguments
        args,
      };

      // For Brave, use the system user profile instead of creating a temporary one
      let userDataDir;
      if (options.browser === 'brave') {
        const platform = process.platform;
        if (platform === 'darwin') {
          // macOS - Use the default Brave profile
          userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'Default');
          
          // Check if the path exists and look for alternative paths if it doesn't
          if (!fs.existsSync(userDataDir)) {
            console.error(`Default Brave profile not found at: ${userDataDir}`);
            const parentDir = path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser');
            if (fs.existsSync(parentDir)) {
              try {
                const profiles = fs.readdirSync(parentDir, { withFileTypes: true })
                  .filter(dirent => dirent.isDirectory())
                  .map(dirent => dirent.name);
                
                console.error(`Found these potential Brave profiles: ${profiles.join(', ')}`);
                
                // Try to find a profile named Default or Profile
                const defaultProfile = profiles.find(name => name === 'Default' || name.startsWith('Profile'));
                if (defaultProfile) {
                  userDataDir = path.join(parentDir, defaultProfile);
                  console.error(`Using alternate Brave profile: ${userDataDir}`);
                } else if (profiles.length > 0) {
                  // Use any profile we can find
                  userDataDir = path.join(parentDir, profiles[0]);
                  console.error(`Using first available Brave profile: ${userDataDir}`);
                }
              } catch (e) {
                console.error(`Error examining Brave profiles: ${e}`);
              }
            } else {
              console.error(`Brave parent directory not found: ${parentDir}`);
              // Force use of the parent User Data directory
              userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser');
            }
          }
        } else if (platform === 'win32') {
          // Windows
          userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data');
        } else if (platform === 'linux') {
          // Linux
          userDataDir = path.join(os.homedir(), '.config', 'BraveSoftware', 'Brave-Browser');
        } else {
          // Fallback to a temporary directory
          userDataDir = await createUserDataDir(browserName);
        }
        console.error(`NOT using explicit user data directory for Brave - letting it use default`);
      } else {
        // For other browsers, use the specified or temporary user data directory
        userDataDir = options.userDataDir ?? await createUserDataDir(browserName);
      }

      // Pass additional information as we create the server
      if (useBraveDirectly) {
        // Add a special attribute to indicate we're using Brave
        (launchOptions as any).isBrave = true;
        console.error('Using Brave-specific launch options');
      }
      
      const serverList = new ServerList(() => createServer({
        browserName,
        userDataDir,
        launchOptions,
        vision: !!options.vision,
        cdpEndpoint: options.cdpEndpoint,
      }));
      setupExitWatchdog(serverList);

      if (options.port) {
        startSSEServer(+options.port, serverList);
      } else {
        const server = await serverList.create();
        await server.connect(new StdioServerTransport());
      }
    });

function setupExitWatchdog(serverList: ServerList) {
  // Share cleanup logic between different exit paths
  const cleanupAndExit = async (exitCode: number, reason: string) => {
    console.error(`Shutting down due to ${reason}...`);

    // Kill any related browser processes that might be running
    if (process.platform === 'darwin' || process.platform === 'linux') {
      try {
        // Try to find and kill any stale chromium processes that might be related to our profile
        const { exec } = require('child_process');
        exec('pkill -f "mcp-.*-profile"', (error: Error | null) => {
          // Ignore errors - this is just a best-effort cleanup
        });
      } catch (e) {
        // Ignore any errors in the cleanup process
      }
    }

    // Set a timeout to force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      console.error('Forced exit after timeout');
      process.exit(exitCode);
    }, 5000);

    try {
      // Try to close all servers gracefully
      await serverList.closeAll();
      clearTimeout(forceExitTimeout);
      process.exit(exitCode);
    } catch (error) {
      console.error('Error during cleanup:', error);
      clearTimeout(forceExitTimeout);
      process.exit(exitCode);
    }
  };

  // Handle normal process exit
  process.stdin.on('close', async () => {
    await cleanupAndExit(0, 'stdin close');
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    await cleanupAndExit(0, 'SIGINT');
  });

  // Handle SIGTERM
  process.on('SIGTERM', async () => {
    await cleanupAndExit(0, 'SIGTERM');
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async error => {
    console.error('Uncaught exception:', error);
    await cleanupAndExit(1, 'uncaught exception');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    await cleanupAndExit(1, 'unhandled rejection');
  });
}

program.parse(process.argv);

async function createUserDataDir(browserName: string) {
  let cacheDirectory: string;
  if (process.platform === 'linux')
    cacheDirectory = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  else if (process.platform === 'darwin')
    cacheDirectory = path.join(os.homedir(), 'Library', 'Caches');
  else if (process.platform === 'win32')
    cacheDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  else
    throw new Error('Unsupported platform: ' + process.platform);

  // Create a consistent profile directory for persistence
  const result = path.join(cacheDirectory, 'ms-playwright', `mcp-${browserName}-profile`);

  // Ensure directory exists
  await fs.promises.mkdir(result, { recursive: true });

  // Check for lock files in the profile directory
  const potentialLockFiles = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket'
  ];

  // Find other possible lock files
  const files = await fs.promises.readdir(result);
  const lockFiles = files.filter(file =>
    file.includes('Lock') ||
    file.includes('Socket') ||
    file.includes('Cookie') ||
    (file.startsWith('.') && file.length > 10)
  );

  // Add any discovered lock files to our list
  for (const file of lockFiles) {
    if (!potentialLockFiles.includes(file))
      potentialLockFiles.push(file);

  }

  // Helper to check if a process is running
  const isProcessRunning = async (pid: number): Promise<boolean> => {
    if (isNaN(pid) || pid <= 0)
      return false;

    try {
      // On POSIX systems, sending signal 0 tests if process exists
      if (process.platform !== 'win32') {
        try {
          process.kill(pid, 0);
          return true;
        } catch (e) {
          return false; // Process doesn't exist
        }
      } else {
        // On Windows, use tasklist (requires child_process)
        const { execSync } = require('child_process');
        const cmd = `tasklist /FI "PID eq ${pid}" /NH`;
        const output = execSync(cmd, { encoding: 'utf8' });
        return output.includes(pid.toString());
      }
    } catch (e) {
      return false; // Any error means the process is not accessible
    }
  };

  // Handle each potential lock file
  for (const lockFile of potentialLockFiles) {
    try {
      const lockFilePath = path.join(result, lockFile);

      // Check if the file exists
      await fs.promises.access(lockFilePath);

      // For SingletonLock, check if it contains a valid PID
      if (lockFile === 'SingletonLock') {
        try {
          // Read the file to see if it contains a PID
          const content = await fs.promises.readFile(lockFilePath, 'utf8');
          const pidMatch = /^(\d+)$/.exec(content.trim());

          if (pidMatch) {
            const pid = parseInt(pidMatch[1], 10);
            const processRunning = await isProcessRunning(pid);

            if (!processRunning) {
              // PID exists in file but process is not running, safe to remove
              await fs.promises.unlink(lockFilePath);
              console.error(`Removed stale lock file (PID ${pid} not running): ${lockFile}`);
            } else {
              console.error(`Found active lock (PID ${pid} is running): ${lockFile}`);
            }
          } else {
            // Doesn't contain a valid PID, safe to remove
            await fs.promises.unlink(lockFilePath);
            console.error(`Removed invalid lock file (no valid PID): ${lockFile}`);
          }
        } catch (readError) {
          // Can't read the file, try to remove it
          await fs.promises.unlink(lockFilePath);
          console.error(`Removed unreadable lock file: ${lockFile}`);
        }
      } else {
        // For other lock files, just remove them
        await fs.promises.unlink(lockFilePath);
        console.error(`Removed lock file: ${lockFile}`);
      }
    } catch (error) {
      // File doesn't exist or can't be accessed/removed - continue
    }
  }

  return result;
}

async function startSSEServer(port: number, serverList: ServerList) {
  const sessions = new Map<string, SSEServerTransport>();
  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
      const searchParams = new URL(`http://localhost${req.url}`).searchParams;
      const sessionId = searchParams.get('sessionId');
      if (!sessionId) {
        res.statusCode = 400;
        res.end('Missing sessionId');
        return;
      }
      const transport = sessions.get(sessionId);
      if (!transport) {
        res.statusCode = 404;
        res.end('Session not found');
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    } else if (req.method === 'GET') {
      const transport = new SSEServerTransport('/sse', res);
      sessions.set(transport.sessionId, transport);
      const server = await serverList.create();
      res.on('close', () => {
        sessions.delete(transport.sessionId);
        serverList.close(server).catch(e => console.error(e));
      });
      await server.connect(transport);
      return;
    } else {
      res.statusCode = 405;
      res.end('Method not allowed');
    }
  });

  httpServer.listen(port, () => {
    const address = httpServer.address();
    assert(address, 'Could not bind server socket');
    let url: string;
    if (typeof address === 'string') {
      url = address;
    } else {
      const resolvedPort = address.port;
      let resolvedHost = address.family === 'IPv4' ? address.address : `[${address.address}]`;
      if (resolvedHost === '0.0.0.0' || resolvedHost === '[::]')
        resolvedHost = 'localhost';
      url = `http://${resolvedHost}:${resolvedPort}`;
    }
    console.error(`Listening on ${url}`);
    console.error('Put this in your client config:');
    console.error(JSON.stringify({
      'mcpServers': {
        'playwright': {
          'url': `${url}/sse`
        }
      }
    }, undefined, 2));
  });
}
