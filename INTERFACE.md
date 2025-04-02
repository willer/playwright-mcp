# Playwright MCP Interface

This document defines the Model Context Protocol (MCP) server interface and available tools implemented in this project.

## Available Tools

### Agent Tools

- **agent_start**
  - Start a new agent session with given instructions
  - Parameters:
    - `instructions` (string, required): Instructions for the agent to follow
    - `startUrl` (string, optional): Optional URL to navigate to before starting the agent

- **agent_status**
  - Check the status of a running agent session
  - Parameters:
    - `waitSeconds` (number, optional): Time in seconds to wait for completion

- **agent_log**
  - Get the complete log of an agent session
  - Parameters:
    - `includeImages` (boolean, optional): Whether to include images in the log

- **agent_end**
  - Forcefully end an agent session
  - Parameters: None

- **agent_get_last_image**
  - Get the last screenshot from an agent session
  - Parameters: None

- **agent_reply**
  - Send a reply to a running agent session to continue the conversation
  - Parameters:
    - `replyText` (string, required): Text to send to the agent as a reply

### Browser Navigation Tools

- **browser_navigate**
  - Navigate to a URL
  - Parameters:
    - `url` (string, required): The URL to navigate to

- **browser_go_back**
  - Go back to the previous page
  - Parameters: None

- **browser_go_forward**
  - Go forward to the next page
  - Parameters: None

- **browser_close**
  - Close the page
  - Parameters: None

- **browser_install**
  - Install the browser specified in the config
  - Parameters: None

### Browser Interaction Tools

- **browser_click**
  - Perform click on a web page
  - Parameters:
    - `element` (string, required): Human-readable element description
    - `ref` (string, required): Exact target element reference from the page snapshot

- **browser_hover**
  - Hover over element on page
  - Parameters:
    - `element` (string, required): Human-readable element description
    - `ref` (string, required): Exact target element reference from the page snapshot

- **browser_type**
  - Type text into editable element
  - Parameters:
    - `element` (string, required): Human-readable element description
    - `ref` (string, required): Exact target element reference from the page snapshot
    - `text` (string, required): Text to type into the element
    - `submit` (boolean, required): Whether to submit entered text (press Enter after)

- **browser_select_option**
  - Select an option in a dropdown
  - Parameters:
    - `element` (string, required): Human-readable element description
    - `ref` (string, required): Exact target element reference from the page snapshot
    - `values` (array of strings, required): Array of values to select in the dropdown

- **browser_press_key**
  - Press a key on the keyboard
  - Parameters:
    - `key` (string, required): Name of the key to press or a character to generate

- **browser_choose_file**
  - Choose one or multiple files to upload
  - Parameters:
    - `paths` (array of strings, required): The absolute paths to the files to upload

### Browser Information Tools

- **browser_snapshot**
  - Capture accessibility snapshot of the current page
  - Parameters: None

- **browser_take_screenshot**
  - Take a screenshot of the current page
  - Parameters:
    - `raw` (boolean, optional): Whether to return without compression (in PNG format)

- **browser_console**
  - View the page console messages
  - Parameters: None

- **browser_save_as_pdf**
  - Save page as PDF
  - Parameters: None

- **browser_wait**
  - Wait for a specified time in seconds
  - Parameters:
    - `time` (number, required): The time to wait in seconds

## Computer Use Agent (CUA)

The Playwright MCP implements a Computer Use Agent (CUA) that facilitates browser control through natural language commands, providing a secure and controlled interface for LLMs to navigate web content.

## Server Implementation

The server follows the standard Model Context Protocol interface with:

- Tools registered via the `ToolSchema` interface
- Resources registered via the `ResourceSchema` interface
- Standard MCP request handlers for listing and executing tools and resources