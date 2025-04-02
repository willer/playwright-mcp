#!/usr/bin/env node
// Simple script to load the module and dump the available tools

// Load the CUA tools directly
const cuaTools = require('../lib/tools/cua');

console.log('CUA Tools:');
Object.keys(cuaTools).forEach(key => {
  if (typeof cuaTools[key] === 'object' && cuaTools[key].schema) {
    const tool = cuaTools[key];
    console.log(`- ${tool.schema.name}: ${tool.schema.description}`);
  }
});