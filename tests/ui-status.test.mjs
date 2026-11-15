import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { inspectListeners, parseSsListeners, parseLsofListeners, main } from '../scripts/check-ui.mjs';

const ss = `State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0 128 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4321,fd=20))
LISTEN 0 128 [::]:5173 [::]:* users:(("node",pid=4321,fd=21))
LISTEN 0 128 *:51730 *:* users:(("other",pid=7654,fd=22))
ESTAB 0 0 127.0.0.1:5173 127.0.0.1:1234
LISTEN 0 128 127.0.0.1:1234 127.0.0.1:5173`;
const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
test('ss parses pid= and exact local port, ignoring nonlisteners and remote ports', () => {
  assert.deepEqual(parseSsListeners(ss, 5173), [{pid:'4321'}, {pid:'4321'}]);
});
test('ss listener without process permissions remains occupied', () => {
  assert.deepEqual(parseSsListeners('LISTEN 0 128 [::]:5173 [::]:*',5173), [{pid:null}]);
});
test('lsof parses and deduplicates only PID records', () => {
  assert.deepEqual(parseLsofListeners('p123\nn*:5173\np123\np0\np456\n'), [{pid:'123'},{pid:'456'}]);
});
test('missing lsof falls back to ss with argument array', async () => {
  const calls=[];
  const result=await inspectListeners(5173,'linux',async (cmd,args) => {
    calls.push([cmd,args]); if(cmd==='lsof') throw missing; return {stdout:ss};
  });
  assert.equal(result[0].pid,'4321');
  assert.deepEqual(calls[1],['ss',['-tlnp','sport = :5173']]);
});
test('missing detection tools produce UNKNOWN, not an empty listener list', async () => {
  await assert.rejects(inspectListeners(5173,'linux',async()=>{throw missing}),/Cannot inspect/);
});
test('lsof no matches plus missing ss is a valid empty result on macOS', async () => {
  assert.deepEqual(await inspectListeners(5173,'darwin',async cmd=>{
    if(cmd==='lsof') throw Object.assign(new Error('none'),{code:1,stdout:'',stderr:''});
    throw missing;
  }),[]);
});
test('lsof permission diagnostic cannot become a free-port report', async () => {
  await assert.rejects(inspectListeners(5173,'darwin',async cmd=>{
    if(cmd==='lsof') throw Object.assign(new Error('denied'),{code:1,stderr:'Permission denied'});
    throw missing;
  }),/Cannot inspect/);
});
test('Windows uses netstat safely and recognizes exact listening endpoint', async () => {
  assert.deepEqual(await inspectListeners(5173,'win32',async (cmd,args)=>{
    assert.equal(cmd,'netstat');assert.deepEqual(args,['-ano']);
    return {stdout:' TCP 127.0.0.1:5173 0.0.0.0:0 LISTENING 123\n TCP 0.0.0.0:51730 0.0.0.0:0 LISTENING 456'};
  }),[{pid:'123'}]);
});
test('invalid environment port fails before inspecting processes', async () => {
  for (const value of ['0','-1','65536','1.5','bad','']) {
    await assert.rejects(main([],{GC_UI_PORT:value},()=>assert.fail('must not inspect')), /integer/);
  }
});
test('explicit port overrides environment port', async () => {
  assert.equal(await main(['--port','8080'],{GC_UI_PORT:'5173'},async port=>{
    assert.equal(port,8080);return [];
  }),1);
});
test('help does not inspect processes', async () => {
  assert.equal(await main(['--help'],{},()=>assert.fail('must not inspect')),0);
});
test('CLI rejects invalid port with UNKNOWN and nonzero exit', () => {
  const result=spawnSync(process.execPath,['scripts/check-ui.mjs','--port=bad'],{encoding:'utf8'});
  assert.equal(result.status,2);assert.match(result.stderr,/Status UNKNOWN/);
  assert.doesNotMatch(result.stdout,/free|RUNNING/);
});
