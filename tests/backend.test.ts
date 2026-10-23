import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexBackend } from "../src/backend";
import { loadState } from "../src/storage";

const temporary: string[] = [];
const previousExecutable = process.env.CODEXOS_CODEX_PATH;
afterEach(() => {
  if (previousExecutable === undefined) delete process.env.CODEXOS_CODEX_PATH;
  else process.env.CODEXOS_CODEX_PATH = previousExecutable;
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true });
});

test("concurrent Codex approval requests are reviewed individually and answered once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codexos-backend-test-"));
  temporary.push(directory);
  const executable = join(directory, "fake-codex");
  writeFileSync(
    executable,
    `#!/usr/bin/env bun
import {createInterface} from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-cli test');process.exit(0)}
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
const answers=[];
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='account/read')send({id:m.id,result:{account:{type:'chatgpt',planType:'test'}}});
 if(m.method==='model/list')send({id:m.id,result:{data:[{id:'test',model:'test',displayName:'Test',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],serviceTiers:[{id:'priority',name:'Fast',description:'Higher usage'}]}]}});
 if(m.method==='config/read')send({id:m.id,result:{config:{model:'test'}}});
 if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'thread-test'}}});
 if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'turn-test'}}});
  if(m.params.input?.[0]?.text.startsWith('settings probe')){send({method:'item/agentMessage/delta',params:{threadId:'thread-test',itemId:'settings',delta:m.params.effort+'|'+m.params.serviceTierForTurn+'\\n'}});send({method:'turn/completed',params:{threadId:'thread-test',turn:{id:'turn-test',status:'completed'}}});return;}
  send({method:'thread/readState/changed',params:{threadId:'thread-test',newField:true}});
  for(const id of ['first','second'])send({id,method:'item/commandExecution/requestApproval',params:{threadId:'thread-test',itemId:id,command:'echo '+id,reason:'Review '+id}});
 }
 if(!m.method && ['first','second'].includes(m.id)){
  answers.push(m.id+':'+m.result.decision);
  if(answers.length===2){send({method:'item/agentMessage/delta',params:{threadId:'thread-test',itemId:'reply',delta:answers.join(',')+'\\n'}});send({method:'turn/completed',params:{threadId:'thread-test',turn:{id:'turn-test',status:'completed'}}});}
 }
});
`,
  );
  chmodSync(executable, 0o700);
  process.env.CODEXOS_CODEX_PATH = executable;
  const backend = new CodexBackend(
    loadState(join(directory, "state.json"), directory),
    () => {},
    () => {},
  );
  const wait = async (check: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await Bun.sleep(10);
    }
    throw new Error("Fake backend timed out");
  };
  try {
    await backend.connect();
    await backend.send("queue approvals");
    await wait(() => Boolean(backend.state.approval));
    expect(backend.state.approval?.id).toBe("first");
    backend.answer(false);
    await wait(() => backend.state.approval?.id === "second");
    expect(backend.state.approval?.id).toBe("second");
    backend.answer(true);
    await wait(() => backend.state.status === "ready");
    expect(backend.workspace.messages.at(-1)?.text.trim()).toBe(
      "first:decline,second:accept",
    );
    expect(backend.state.error).toBeNull();
    backend.setReasoningEffort("high");
    backend.setServiceTier("priority");
    expect(() => backend.setReasoningEffort("imaginary")).toThrow();
    expect(() => backend.setServiceTier("imaginary")).toThrow();
    await backend.send("settings probe fast");
    await wait(() => backend.state.status === "ready");
    expect(backend.workspace.messages.at(-1)?.text.trim()).toBe(
      "high|priority",
    );
    backend.setReasoningEffort("low");
    backend.setServiceTier("default");
    await backend.send("settings probe standard");
    await wait(() => backend.state.status === "ready");
    expect(backend.workspace.messages.at(-1)?.text.trim()).toBe("low|default");
  } finally {
    await backend.stop();
  }
});
