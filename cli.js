#!/usr/bin/env node
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

// Check if the lib directory exists, if not, build it
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const libDir = path.join(__dirname, 'lib');

if (!fs.existsSync(libDir) || !fs.existsSync(path.join(libDir, 'program.js'))) {
  console.log('Building TypeScript files...');
  try {
    // When running via npx from GitHub, the project should already be built
    if (process.env.npm_lifecycle_event === 'npx') {
      console.error('Error: The lib directory is missing. This package must be pre-built when run via npx.');
      process.exit(1);
    }
    
    // Otherwise try to build it locally
    execSync('npm install && npm run build', { stdio: 'inherit', cwd: __dirname });
    console.log('Build complete.');
  } catch (error) {
    console.error('Error building project:', error);
    process.exit(1);
  }
}

require('./lib/program');
