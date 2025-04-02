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

import fs from 'fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { test, expect } from './fixtures';

test('test tool list', async ({ client, visionClient }) => {
  const { tools } = await client.listTools();
  // Sort the tool names to account for potential ordering differences
  expect(tools.map(t => t.name).sort()).toEqual([
    'agent_end',
    'agent_get_last_image',
    'agent_log',
    'agent_reply',
    'agent_start',
    'agent_status',
    'browser_choose_file',
    'browser_click',
    'browser_close',
    'browser_console',
    'browser_go_back',
    'browser_go_forward',
    'browser_hover',
    'browser_install',
    'browser_navigate',
    'browser_press_key',
    'browser_save_as_pdf',
    'browser_select_option',
    'browser_snapshot',
    'browser_take_screenshot',
    'browser_type',
    'browser_wait',
  ].sort());

  const { tools: visionTools } = await visionClient.listTools();
  // Sort the tool names to account for potential ordering differences
  expect(visionTools.map(t => t.name).sort()).toEqual([
    'agent_end',
    'agent_get_last_image',
    'agent_log',
    'agent_reply',
    'agent_start',
    'agent_status',
    'browser_choose_file',
    'browser_click',
    'browser_close',
    'browser_console',
    'browser_drag',
    'browser_go_back',
    'browser_go_forward',
    'browser_install',
    'browser_move_mouse',
    'browser_navigate',
    'browser_press_key',
    'browser_save_as_pdf',
    'browser_screenshot',
    'browser_type',
    'browser_wait',
  ].sort());
});

test('test resources list', async ({ client }) => {
  const { resources } = await client.listResources();
  expect(resources).toEqual([]);
});

test('agent uses same session as browser', async ({ client }) => {
  // Navigate using browser_navigate
  const navigateResponse = await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'about:blank',
    },
  });
  // With snapshot on, we get a different response
  expect(navigateResponse).toContainTextContent('Page URL: about:blank');
  
  // Start agent session
  const agentResponse = await client.callTool({
    name: 'agent_start',
    arguments: {
      instructions: 'Check the current page',
      apiKey: 'fake-api-key',
    },
  });
  
  // Agent should be able to use the existing page
  expect(agentResponse).not.toContainTextContent('No active browser session');
  
  // Clean up by ending the agent session
  await client.callTool({
    name: 'agent_end',
    arguments: {},
  });
});

test('test browser_navigate', async ({ client }) => {
  expect(await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><body>Hello, world!</body></html>',
    },
  })).toHaveTextContent(`
- Page URL: data:text/html,<html><title>Title</title><body>Hello, world!</body></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- text: Hello, world!
\`\`\`
`
  );
});

test('test browser_click', async ({ client }) => {
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><button>Submit</button></html>',
    },
  });

  expect(await client.callTool({
    name: 'browser_click',
    arguments: {
      element: 'Submit button',
      ref: 's1e3',
    },
  })).toHaveTextContent(`"Submit button" clicked

- Page URL: data:text/html,<html><title>Title</title><button>Submit</button></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- button "Submit" [ref=s2e3]
\`\`\`
`);
});

test('test reopen browser', async ({ client }) => {
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><body>Hello, world!</body></html>',
    },
  });

  expect(await client.callTool({
    name: 'browser_close',
  })).toHaveTextContent('Page closed');

  expect(await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><body>Hello, world!</body></html>',
    },
  })).toHaveTextContent(`
- Page URL: data:text/html,<html><title>Title</title><body>Hello, world!</body></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- text: Hello, world!
\`\`\`
`);
});

test('single option', async ({ client }) => {
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><select><option value="foo">Foo</option><option value="bar">Bar</option></select></html>',
    },
  });

  expect(await client.callTool({
    name: 'browser_select_option',
    arguments: {
      element: 'Select',
      ref: 's1e3',
      values: ['bar'],
    },
  })).toHaveTextContent(`Selected option in "Select"

- Page URL: data:text/html,<html><title>Title</title><select><option value="foo">Foo</option><option value="bar">Bar</option></select></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- combobox [ref=s2e3]:
    - option "Foo" [ref=s2e4]
    - option "Bar" [selected] [ref=s2e5]
\`\`\`
`);
});

test('multiple option', async ({ client }) => {
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><select multiple><option value="foo">Foo</option><option value="bar">Bar</option><option value="baz">Baz</option></select></html>',
    },
  });

  expect(await client.callTool({
    name: 'browser_select_option',
    arguments: {
      element: 'Select',
      ref: 's1e3',
      values: ['bar', 'baz'],
    },
  })).toHaveTextContent(`Selected option in "Select"

- Page URL: data:text/html,<html><title>Title</title><select multiple><option value="foo">Foo</option><option value="bar">Bar</option><option value="baz">Baz</option></select></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- listbox [ref=s2e3]:
    - option "Foo" [ref=s2e4]
    - option "Bar" [selected] [ref=s2e5]
    - option "Baz" [selected] [ref=s2e6]
\`\`\`
`);
});

test('browser_console', async ({ client }) => {
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><script>console.log("Hello, world!");console.error("Error"); </script></html>',
    },
  });

  const result = await client.callTool({
    name: 'browser_console',
    arguments: {},
  });
  expect(result.content).toEqual([{
    type: 'text',
    text: '[LOG] Hello, world!\n[ERROR] Error',
  }]);
});

test('stitched aria frames', async ({ client }) => {
  expect(await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: `data:text/html,<h1>Hello</h1><iframe src="data:text/html,<button>World</button><main><iframe src='data:text/html,<p>Nested</p>'></iframe></main>"></iframe><iframe src="data:text/html,<h1>Should be invisible</h1>" style="display: none;"></iframe>`,
    },
  })).toContainTextContent(`
\`\`\`yaml
- heading "Hello" [level=1] [ref=s1e3]
- iframe [ref=s1e4]:
    - button "World" [ref=f1s1e3]
    - main [ref=f1s1e4]:
        - iframe [ref=f1s1e5]:
            - paragraph [ref=f2s1e3]: Nested
\`\`\`
`);

  expect(await client.callTool({
    name: 'browser_click',
    arguments: {
      element: 'World',
      ref: 'f1s1e3',
    },
  })).toContainTextContent('"World" clicked');
});

test('browser_choose_file', async ({ client }) => {
  expect(await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><input type="file" /><button>Button</button></html>',
    },
  })).toContainTextContent('- textbox [ref=s1e3]');

  expect(await client.callTool({
    name: 'browser_click',
    arguments: {
      element: 'Textbox',
      ref: 's1e3',
    },
  })).toContainTextContent('There is a file chooser visible that requires browser_choose_file to be called');

  const filePath = test.info().outputPath('test.txt');
  await fs.writeFile(filePath, 'Hello, world!');

  {
    const response = await client.callTool({
      name: 'browser_choose_file',
      arguments: {
        paths: [filePath],
      },
    });

    expect(response).not.toContainTextContent('There is a file chooser visible that requires browser_choose_file to be called');
    expect(response).toContainTextContent('textbox [ref=s3e3]: C:\\fakepath\\test.txt');
  }

  {
    const response = await client.callTool({
      name: 'browser_click',
      arguments: {
        element: 'Textbox',
        ref: 's3e3',
      },
    });

    expect(response).toContainTextContent('There is a file chooser visible that requires browser_choose_file to be called');
    expect(response).toContainTextContent('button "Button" [ref=s4e4]');
  }

  {
    const response = await client.callTool({
      name: 'browser_click',
      arguments: {
        element: 'Button',
        ref: 's4e4',
      },
    });

    expect(response, 'not submitting browser_choose_file dismisses file chooser').not.toContainTextContent('There is a file chooser visible that requires browser_choose_file to be called');
  }
});

test('sse transport', async () => {
  const cp = spawn('node', [path.join(__dirname, '../cli.js'), '--port', '0'], { stdio: 'pipe' });
  try {
    let stdout = '';
    const url = await new Promise<string>(resolve => cp.stdout?.on('data', data => {
      stdout += data.toString();
      const match = stdout.match(/Listening on (http:\/\/.*)/);
      if (match)
        resolve(match[1]);
    }));

    // need dynamic import b/c of some ESM nonsense
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const transport = new SSEClientTransport(new URL(url));
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    await client.ping();
  } finally {
    cp.kill();
  }
});

test('cdp server', async ({ cdpEndpoint, startClient }) => {
  const client = await startClient({ args: [`--cdp-endpoint=${cdpEndpoint}`] });
  expect(await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><body>Hello, world!</body></html>',
    },
  })).toHaveTextContent(`
- Page URL: data:text/html,<html><title>Title</title><body>Hello, world!</body></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- text: Hello, world!
\`\`\`
`
  );
});

test('save as pdf', async ({ client }) => {
  expect(await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><body>Hello, world!</body></html>',
    },
  })).toHaveTextContent(`
- Page URL: data:text/html,<html><title>Title</title><body>Hello, world!</body></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- text: Hello, world!
\`\`\`
`
  );

  const response = await client.callTool({
    name: 'browser_save_as_pdf',
  });
  expect(response).toHaveTextContent(/^Saved as.*page-[^:]+.pdf$/);
});

test('executable path', async ({ startClient }) => {
  const client = await startClient({ args: [`--executable-path=bogus`] });
  const response = await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><body>Hello, world!</body></html>',
    },
  });
  expect(response).toContainTextContent(`executable doesn't exist`);
});
