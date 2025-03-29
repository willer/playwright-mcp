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

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get list of changed files
const gitOutput = execSync('git diff --cached --name-only --diff-filter=ACMR').toString();
const changedFiles = gitOutput.split('\n').filter(file => file.trim());

// Filter for TypeScript files
const tsFiles = changedFiles.filter(file => file.endsWith('.ts') || file.endsWith('.tsx'));

if (tsFiles.length === 0) {
  console.log('No TypeScript files to lint');
  process.exit(0);
}

// Separate test files for test-specific rules
const testFiles = tsFiles.filter(file => file.includes('/tests/'));
const sourceFiles = tsFiles.filter(file => !file.includes('/tests/'));

try {
  if (sourceFiles.length > 0) {
    console.log('\nRunning robust code quality checks on source files:', sourceFiles.join(', '));
    const sourceResult = execSync(`npx eslint ${sourceFiles.join(' ')} --rule "robust/code-quality:2"`, { stdio: 'inherit' });
  }
  
  if (testFiles.length > 0) {
    console.log('\nRunning robust test quality checks on test files:', testFiles.join(', '));
    const testResult = execSync(`npx eslint ${testFiles.join(' ')} --rule "robust/test-quality:2"`, { stdio: 'inherit' });
  }
  
  // Run standard linter on all TS files
  console.log('\nRunning standard linter checks on all changed TS files');
  execSync(`npx eslint ${tsFiles.join(' ')}`, { stdio: 'inherit' });
  
  console.log('\nAll linter checks passed! Proceeding with commit.');
  process.exit(0);
} catch (error) {
  console.error('\nLinter checks failed. Please fix the issues before committing.');
  process.exit(1);
}