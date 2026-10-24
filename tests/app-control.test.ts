import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(process.platform !== "darwin")(
  "Astra controls real DOM and React fields without pixels or computer use",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-controls-test-"));
    const project = join(import.meta.dir, "..");
    const entry = join(directory, "checks.tsx");
    try {
      symlinkSync(
        join(project, "node_modules"),
        join(directory, "node_modules"),
      );
      writeFileSync(
        entry,
        `
import {controlSurface} from ${JSON.stringify(join(project, "src/app-control.ts"))};
import {useState} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
window.checkControls=()=>{
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const root=document.getElementById("substrate");
 root.innerHTML='<label>Title<input id="title" value="old"></label><button id="next">Next</button><output id="count">0</output><select id="choice"><option>A</option><option>B</option></select><input id="readonly" readonly value="keep"><input id="password" type="password" value="private"><button hidden id="hidden">Hidden</button><button disabled id="disabled">Disabled</button><button id="native" data-astra-native>Native</button><input id="twice"><input id="twice">';
 let clicks=0;
 root.querySelector('#next').onclick=()=>{root.querySelector('#count').textContent=String(++clicks);};
 const inspection=controlSurface(root,{action:'inspect'});
 assert(inspection.controls.some(c=>c.selector==='canvas:#title'&&c.label==='Title'),'Inspectable labelled field');
 assert(!inspection.controls.some(c=>c.selector==='canvas:#hidden'),'Hidden controls excluded');
 assert(!('value' in inspection.controls.find(c=>c.selector==='canvas:#password')),'Password redacted');
 controlSurface(root,{action:'click',selector:'#next'});
 assert(root.querySelector('#count').textContent==='1','Click invokes the app handler');
 controlSurface(root,{action:'fill',selector:'#title',value:'Étoile'});
 assert(root.querySelector('#title').value==='Étoile','Field accepts unicode');
 controlSurface(root,{action:'fill',selector:'#choice',value:'B'});
 assert(root.querySelector('#choice').value==='B','Select updates');
 for(const request of [{action:'click',selector:'#hidden'},{action:'click',selector:'#disabled'},{action:'click',selector:'#native'},{action:'click',selector:'#twice'},{action:'fill',selector:'#readonly',value:'changed'},{action:'fill',selector:'#password',value:'changed'},{action:'fill',selector:'#choice',value:'missing'},{action:'click',selector:'['}]){
   let rejected=false;try{controlSurface(root,request);}catch{rejected=true;}assert(rejected,'Invalid control rejected: '+request.selector);
 }
 function Fields(){const [text,setText]=useState('old');const [on,setOn]=useState(false);return <><input id="react-text" value={text} onChange={event=>setText(event.target.value)}/><input id="react-check" type="checkbox" checked={on} onChange={event=>setOn(event.target.checked)}/><output id="react-state">{text}:{String(on)}</output></>;}
 const reactHost=document.getElementById('react');
 flushSync(()=>createRoot(reactHost).render(<Fields/>));
 flushSync(()=>controlSurface(reactHost,{action:'fill',selector:'#react-text',value:'Lune'}));
 flushSync(()=>controlSurface(reactHost,{action:'fill',selector:'#react-check',value:true}));
 assert(reactHost.querySelector('#react-state').textContent==='Lune:true','React state follows controlled input and checkbox changes');
 return 'DOM_AND_REACT_CONTROLS_VERIFIED';
};
`,
      );
      const bundle = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        format: "iife",
        define: { "process.env.NODE_ENV": '"production"' },
      });
      if (!bundle.success)
        throw new AggregateError(bundle.logs, "Control test bundle failed");
      const script = await bundle.outputs[0].text();
      const app = join(directory, "main.cjs");
      writeFileSync(
        app,
        `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, "profile"))});app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{await window.loadURL('data:text/html,<main id="substrate"></main><div id="react"></div>');await window.webContents.executeJavaScript(${JSON.stringify(script)});console.log(await window.webContents.executeJavaScript('window.checkControls()'));app.quit();}catch(error){console.error(error);app.exit(1);}});`,
      );
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = Bun.spawn(
        [
          join(
            project,
            "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
          ),
          app,
        ],
        { env, stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, error: code ? stderr : null }).toEqual({
        code: 0,
        error: null,
      });
      expect(stdout).toContain("DOM_AND_REACT_CONTROLS_VERIFIED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);
