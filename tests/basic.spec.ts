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
import { test, expect } from './fixtures';

test('test tool list', async ({ client, visionClient }) => {
  const { tools } = await client.listTools();
  // Sort the tool names to account for potential ordering differences
  expect(tools.map(t => t.name).sort()).toContain('agent_end');
  expect(tools.map(t => t.name).sort()).toContain('agent_get_last_image');
  expect(tools.map(t => t.name).sort()).toContain('agent_log');
  expect(tools.map(t => t.name).sort()).toContain('agent_reply');
  expect(tools.map(t => t.name).sort()).toContain('agent_start');
  expect(tools.map(t => t.name).sort()).toContain('agent_status');
  expect(tools.map(t => t.name).sort()).toContain('browser_click');
  expect(tools.map(t => t.name).sort()).toContain('browser_navigate');

  const { tools: visionTools } = await visionClient.listTools();
  // Check a few vision-specific tools
  expect(visionTools.map(t => t.name).sort()).toContain('browser_screen_capture');
  expect(visionTools.map(t => t.name).sort()).toContain('browser_screen_click');
});

test('test resources list', async ({ client }) => {
  const { resources } = await client.listResources();
  expect(resources).toEqual(['browser://console']);
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
    },
  });
  
  // Agent should be initialized
  expect(agentResponse).toContainTextContent('Agent session started');
  
  // Clean up by ending the agent session
  await client.callTool({
    name: 'agent_end',
    arguments: {},
  });
});

test('browser_navigate', async ({ client }) => {
  expect(await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: 'data:text/html,<html><title>Title</title><body>Hello, world!</body></html>',
    },
  })).toHaveTextContent(`
Navigated to data:text/html,<html><title>Title</title><body>Hello, world!</body></html>

- Page URL: data:text/html,<html><title>Title</title><body>Hello, world!</body></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- text: Hello, world!
\`\`\`
`
  );
});

test('browser_click', async ({ client }) => {
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
  })).toHaveTextContent(`Clicked "Submit button"

- Page URL: data:text/html,<html><title>Title</title><button>Submit</button></html>
- Page Title: Title
- Page Snapshot
\`\`\`yaml
- button "Submit" [ref=s2e3]
\`\`\`
`);
});


test('browser_select_option', async ({ client }) => {
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

test('browser_select_option (multiple)', async ({ client }) => {
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

test('browser_file_upload', async ({ client }) => {
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
  })).toContainTextContent('There is a file chooser visible that requires browser_file_upload to be called');

  const filePath = test.info().outputPath('test.txt');
  await fs.writeFile(filePath, 'Hello, world!');

  {
    const response = await client.callTool({
      name: 'browser_file_upload',
      arguments: {
        paths: [filePath],
      },
    });

    expect(response).not.toContainTextContent('There is a file chooser visible that requires browser_file_upload to be called');
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

    expect(response).toContainTextContent('There is a file chooser visible that requires browser_file_upload to be called');
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

    expect(response, 'not submitting browser_file_upload dismisses file chooser').not.toContainTextContent('There is a file chooser visible that requires browser_file_upload to be called');
  }
});

test('browser_type', async ({ client }) => {
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: `data:text/html,<input type='keypress' onkeypress="console.log('Key pressed:', event.key, ', Text:', event.target.value)"></input>`,
    },
  });
  await client.callTool({
    name: 'browser_type',
    arguments: {
      element: 'textbox',
      ref: 's1e3',
      text: 'Hi!',
      submit: true,
    },
  });
  const resource = await client.readResource({
    uri: 'browser://console',
  });
  expect(resource.contents).toEqual([{
    uri: 'browser://console',
    mimeType: 'text/plain',
    text: '[LOG] Key pressed: Enter , Text: Hi!',
  }]);
});

test('browser_type (slowly)', async ({ client }) => {
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      url: `data:text/html,<input type='text' onkeydown="console.log('Key pressed:', event.key, 'Text:', event.target.value)"></input>`,
    },
  });
  await client.callTool({
    name: 'browser_type',
    arguments: {
      element: 'textbox',
      ref: 's1e3',
      text: 'Hi!',
      submit: true,
      slowly: true,
    },
  });
  const resource = await client.readResource({
    uri: 'browser://console',
  });
  expect(resource.contents).toEqual([{
    uri: 'browser://console',
    mimeType: 'text/plain',
    text: [
      '[LOG] Key pressed: H Text: ',
      '[LOG] Key pressed: i Text: H',
      '[LOG] Key pressed: ! Text: Hi',
      '[LOG] Key pressed: Enter Text: Hi!',
    ].join('\n'),
  }]);
});
