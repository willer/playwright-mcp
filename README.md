## Playwright MCP

A Model Context Protocol (MCP) server that provides browser automation capabilities using [Playwright](https://playwright.dev). This server enables LLMs to interact with web pages through structured accessibility snapshots, bypassing the need for screenshots or visually-tuned models.

### Key Features

- **Fast and lightweight**: Uses Playwright's accessibility tree, not pixel-based input.
- **LLM-friendly**: No vision models needed, operates purely on structured data.
- **Deterministic tool application**: Avoids ambiguity common with screenshot-based approaches.
- **Computer Use Agent (CUA)**: Supports high-level agent-based browser automation.

### Use Cases

- Web navigation and form-filling
- Data extraction from structured content
- Automated testing driven by LLMs
- General-purpose browser interaction for agents
- Long-running browser automation with Computer Use Agent (CUA)

### Example config

```js
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest"
      ]
    }
  }
}
```


#### Installation in VS Code

Install the Playwright MCP server in VS Code using one of these buttons:

<!--
// Generate using?:
const config = JSON.stringify({ name: 'playwright', command: 'npx', args: ["-y", "@playwright/mcp@latest"] });
const urlForWebsites = `vscode:mcp/install?${encodeURIComponent(config)}`;
// Github markdown does not allow linking to `vscode:` directly, so you can use our redirect:
const urlForGithub = `https://insiders.vscode.dev/redirect?url=${encodeURIComponent(urlForWebsites)}`;
-->

[<img alt="Install in VS Code Insiders" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5">](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522playwright%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540playwright%252Fmcp%2540latest%2522%255D%257D)

Alternatively, you can install the Playwright MCP server using the VS Code CLI:

```bash
# For VS Code
code --add-mcp '{"name":"playwright","command":"npx","args":["@playwright/mcp@latest"]}'
```

```bash
# For VS Code Insiders
code-insiders --add-mcp '{"name":"playwright","command":"npx","args":["@playwright/mcp@latest"]}'
```

After installation, the Playwright MCP server will be available for use with your GitHub Copilot agent in VS Code.

### CLI Options

The Playwright MCP server supports the following command-line options:

- `--browser <browser>`: Browser or chrome channel to use. Possible values:
  - `chrome`, `firefox`, `webkit`, `msedge`
  - Chrome channels: `chrome-beta`, `chrome-canary`, `chrome-dev`
  - Edge channels: `msedge-beta`, `msedge-canary`, `msedge-dev`
  - Default: `chrome`
- `--cdp-endpoint <endpoint>`: CDP endpoint to connect to
- `--executable-path <path>`: Path to the browser executable
- `--headless`: Run browser in headless mode (headed by default)
- `--port <port>`: Port to listen on for SSE transport
- `--user-data-dir <path>`: Path to the user data directory
- `--vision`: Run server that uses screenshots (Aria snapshots are used by default)

### User data directory

Playwright MCP will launch the browser with the new profile, located at

```
- `%USERPROFILE%\AppData\Local\ms-playwright\mcp-chrome-profile` on Windows
- `~/Library/Caches/ms-playwright/mcp-chrome-profile` on macOS
- `~/.cache/ms-playwright/mcp-chrome-profile` on Linux
```

All the logged in information will be stored in that profile, you can delete it between sessions if you'd like to clear the offline state.

### Chrome Extensions Support

Chrome extensions are enabled by default when using a Chromium-based browser in headed mode. This allows you to access the Chrome Web Store and install extensions directly from there.


### Running headless browser (Browser without GUI).

This mode is useful for background or batch operations.

```js
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--headless"
      ]
    }
  }
}
```

### Running headed browser on Linux w/o DISPLAY

When running headed browser on system w/o display or from worker processes of the IDEs,
run the MCP server from environment with the DISPLAY and pass the `--port` flag to enable SSE transport.

```bash
npx @playwright/mcp@latest --port 8931
```

And then in MCP client config, set the `url` to the SSE endpoint:

```js
{
  "mcpServers": {
    "playwright": {
      "url": "http://localhost:8931/sse"
    }
  }
}
```

### Tool Modes

The tools are available in two modes:

1. **Snapshot Mode** (default): Uses accessibility snapshots for better performance and reliability
2. **Vision Mode**: Uses screenshots for visual-based interactions

To use Vision Mode, add the `--vision` flag when starting the server:

```js
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--vision"
      ]
    }
  }
}
```

Vision Mode works best with the computer use models that are able to interact with elements using
X Y coordinate space, based on the provided screenshot.

### Programmatic usage with custom transports

```js
import { createServer } from '@playwright/mcp';

// ...

const server = createServer({
  launchOptions: { headless: true }
});
transport = new SSEServerTransport("/messages", res);
server.connect(transport);
```

### Snapshot Mode

The Playwright MCP provides a set of tools for browser automation. Here are all available tools:

- **browser_navigate**
  - Description: Navigate to a URL
  - Parameters:
    - `url` (string): The URL to navigate to

- **browser_go_back**
  - Description: Go back to the previous page
  - Parameters: None

- **browser_go_forward**
  - Description: Go forward to the next page
  - Parameters: None

- **browser_click**
  - Description: Perform click on a web page
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot

- **browser_hover**
  - Description: Hover over element on page
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot

- **browser_drag**
  - Description: Perform drag and drop between two elements
  - Parameters:
    - `startElement` (string): Human-readable source element description used to obtain permission to interact with the element
    - `startRef` (string): Exact source element reference from the page snapshot
    - `endElement` (string): Human-readable target element description used to obtain permission to interact with the element
    - `endRef` (string): Exact target element reference from the page snapshot

- **browser_type**
  - Description: Type text into editable element
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot
    - `text` (string): Text to type into the element
    - `submit` (boolean): Whether to submit entered text (press Enter after)

- **browser_select_option**
  - Description: Select option in a dropdown
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot
    - `values` (array): Array of values to select in the dropdown.

- **browser_choose_file**
  - Description: Choose one or multiple files to upload
  - Parameters:
    - `paths` (array): The absolute paths to the files to upload. Can be a single file or multiple files.

- **browser_press_key**
  - Description: Press a key on the keyboard
  - Parameters:
    - `key` (string): Name of the key to press or a character to generate, such as `ArrowLeft` or `a`

- **browser_snapshot**
  - Description: Capture accessibility snapshot of the current page (better than screenshot)
  - Parameters: None

- **browser_save_as_pdf**
  - Description: Save page as PDF
  - Parameters: None

- **browser_take_screenshot**
  - Description: Capture screenshot of the page
  - Parameters:
    - `raw` (string): Optionally returns lossless PNG screenshot. JPEG by default.

- **browser_wait**
  - Description: Wait for a specified time in seconds
  - Parameters:
    - `time` (number): The time to wait in seconds (capped at 10 seconds)

- **browser_close**
  - Description: Close the page
  - Parameters: None


### Vision Mode

Vision Mode provides tools for visual-based interactions using screenshots. Here are all available tools:

- **browser_navigate**
  - Description: Navigate to a URL
  - Parameters:
    - `url` (string): The URL to navigate to

- **browser_go_back**
  - Description: Go back to the previous page
  - Parameters: None

- **browser_go_forward**
  - Description: Go forward to the next page
  - Parameters: None

- **browser_screenshot**
  - Description: Capture screenshot of the current page
  - Parameters: None

- **browser_move_mouse**
  - Description: Move mouse to specified coordinates
  - Parameters:
    - `x` (number): X coordinate
    - `y` (number): Y coordinate

- **browser_click**
  - Description: Click at specified coordinates
  - Parameters:
    - `x` (number): X coordinate to click at
    - `y` (number): Y coordinate to click at

- **browser_drag**
  - Description: Perform drag and drop operation
  - Parameters:
    - `startX` (number): Start X coordinate
    - `startY` (number): Start Y coordinate
    - `endX` (number): End X coordinate
    - `endY` (number): End Y coordinate

- **browser_type**
  - Description: Type text at specified coordinates
  - Parameters:
    - `text` (string): Text to type
    - `submit` (boolean): Whether to submit entered text (press Enter after)

- **browser_press_key**
  - Description: Press a key on the keyboard
  - Parameters:
    - `key` (string): Name of the key to press or a character to generate, such as `ArrowLeft` or `a`

- **browser_choose_file**
  - Description: Choose one or multiple files to upload
  - Parameters:
    - `paths` (array): The absolute paths to the files to upload. Can be a single file or multiple files.

- **browser_save_as_pdf**
  - Description: Save page as PDF
  - Parameters: None

- **browser_wait**
  - Description: Wait for a specified time in seconds
  - Parameters:
    - `time` (number): The time to wait in seconds (capped at 10 seconds)

- **browser_close**
  - Description: Close the page
  - Parameters: None

### Computer Use Agent (CUA) Mode

The Playwright MCP also provides a Computer Use Agent (CUA) implementation for high-level, agent-based browser automation. The CUA mode allows for long-running browser sessions controlled by an AI agent.

To use CUA mode, you need to set your OpenAI API key in the `.env` file (see `.env.example`).

#### CUA Tools

- **agent_start**
  - Description: Start a new agent session with given instructions
  - Parameters:
    - `instructions` (string, required): The instructions for the agent to follow

- **agent_status**
  - Description: Check the status of a running agent session
  - Parameters:
    - `sessionId` (string, required): Session ID returned from agent_start
    - `waitSeconds` (number, optional): Time in seconds to wait for completion

- **agent_log**
  - Description: Get the complete log of an agent session
  - Parameters:
    - `sessionId` (string, required): Session ID returned from agent_start
    - `includeImages` (boolean, optional): Whether to include images in the log

- **agent_end**
  - Description: Forcefully end an agent session
  - Parameters:
    - `sessionId` (string, required): Session ID returned from agent_start

- **agent_get_last_image**
  - Description: Get the last screenshot from an agent session
  - Parameters:
    - `sessionId` (string, required): Session ID returned from agent_start

- **agent_reply**
  - Description: Send a reply to a running agent session to continue the conversation
  - Parameters:
    - `sessionId` (string, required): Session ID returned from agent_start
    - `replyText` (string, required): The reply to send to the agent