export const browserInputFixture = `<!doctype html><html><head><style>
      body { margin: 0; height: 1500px }
      #text { position: absolute; left: 20px; top: 20px; font: 20px/30px monospace; white-space: pre }
      button { position: absolute; left: 20px; top: 80px; width: 120px; height: 30px; cursor: pointer }
      button:hover { background: green }
      input { position: absolute; left: 20px; top: 130px; width: 250px; height: 30px }
      #editor { position: absolute; left: 20px; top: 190px; width: 250px; height: 40px; border: 1px solid }
    </style></head><body><span id="text">Alpha beta gamma delta.</span><button>Hover me</button>
    <input aria-label="Editor"><div id="editor" contenteditable="true">Editable</div>
    <div role="grid" aria-label="Embedded table" style="position:absolute;top:250px">
      <div role="row" aria-rowindex="1"><span role="columnheader">Name</span><span role="columnheader">Status</span></div>
      <div role="row" aria-rowindex="2"><span role="gridcell">Alice</span><span role="gridcell">Done</span></div>
    </div>
    <div role="group" style="position:absolute;top:270px">
      <span data-visual-context-sensitive>fixture-secret</span>
      <input type="password" aria-label="Secret password" value="fixture-password">
      <input autocomplete="one-time-code" aria-label="Secret OTP" value="fixture-otp">
    </div>
    <script>
      const state = { selection: '', value: '', edit: '', hover: false, double: 0, context: 0, buttons: 0, shift: false };
      const button = document.querySelector('button');
      function update() {
        state.selection = String(getSelection()); state.value = document.querySelector('input').value;
        state.edit = document.querySelector('#editor').textContent;
        document.title = JSON.stringify(state);
      }
      button.addEventListener('mouseenter', () => { state.hover = true; update(); });
      button.addEventListener('mouseleave', () => { state.hover = false; update(); });
      button.addEventListener('dblclick', () => { state.double++; update(); });
      button.addEventListener('contextmenu', e => { e.preventDefault(); state.context++; update(); });
      document.addEventListener('mousedown', e => { state.buttons = e.buttons; state.shift = e.shiftKey; update(); });
      document.addEventListener('mouseup', e => { state.buttons = e.buttons; update(); });
      document.addEventListener('selectionchange', update);
      document.addEventListener('input', update); update();
    </script></body></html>`
