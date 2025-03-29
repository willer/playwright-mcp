# Playwright MCP Requirements

This document describes the requirements and features of the Playwright MCP application.

## Overview

Playwright MCP is a Model Context Protocol (MCP) server that provides browser automation capabilities using [Playwright](https://playwright.dev). It enables Large Language Models (LLMs) to interact with web pages through structured accessibility snapshots, bypassing the need for screenshots or visually-tuned models.

## Core Features

### 1. Browser Automation Tools

The application provides two modes of operation:

#### Snapshot Mode (Default)
- Uses accessibility snapshots for better performance and reliability
- Includes tools for navigation, interaction, form-filling, and data extraction
- Provides structured and semantic representation of web pages

#### Vision Mode
- Uses screenshots for visual-based interactions
- Ideal for models that can interact with elements using X/Y coordinate space

### 2. Computer Use Agent (CUA)

The CUA feature allows AI agents to interact with web browsers through natural language instructions:

- **Agent Session Management**: Start, monitor, end, and retrieve logs from agent sessions
- **OpenAI Integration**: Connects to OpenAI's "computer-use-preview" model
- **Action Execution**: Translates AI instructions into browser actions (click, type, navigate, scroll)
- **Progress Tracking**: Monitors step completion and provides status updates
- **Error Handling**: Captures errors and provides detailed logs and screenshots

An example use case that should succeed in testing is a natural-language, multi-task request like "go to amazon, find a nice set of dishes, add to cart, and tell me the name and url of the dishes you added".

CUA should be implemented using the latest tech, ie the computer-use tool and the computer-use-preview model, running on the https://api.openai.com/v1/responses endpoint (i.e. not chatcompletion).

### 3. MCP Protocol Support

- Implements Model Context Protocol for standardized tool interactions
- Supports various transport mechanisms including SSE
- Allows programmatic usage with custom transports

## Technical Requirements

### Environment

- Requires Node.js
- Can operate in both headless and headed browser modes
- Support for Windows, macOS, and Linux
- Chrome browser profile management

### Configuration

- Configurable through command-line arguments
- Integration with VS Code through MCP protocol
- Support for custom transport layers
- Environment variable configuration (e.g., OPENAI_API_KEY)

### Development Standards

- Robust error handling without hardcoded workarounds
- Generic, configurable code without service-specific implementations
- Comprehensive testing including basic functionality and edge cases
- Clean codebase with proper promise handling and error management

## Integration Capabilities

- VS Code integration through MCP protocol
- Programmatic usage via JavaScript/TypeScript API
- Command-line usage via NPX
- Supports running on systems with and without display

## Use Cases

- Web navigation and form-filling
- Data extraction from structured content
- Automated testing driven by LLMs
- General-purpose browser interaction for agents
