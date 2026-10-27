/** 真实bridge + 本机OneBot + 假模型；验证隔离和兼容，不访问真实QQ。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'life-bridge-'));
const dump = path.join(data, 'prompts.jsonl');
const fake = path.join(data, 'fake.mjs');
fs.writeFileSync(fake, `import fs from 'node:fs'; const p=process.argv.at(-1); fs.appendFileSync(${JSON.stringify(dump)},JSON.stringify(p)+'\\n'); console.log(JSON.stringify({type:'session',sessionId:'fake-life'})); console.log(JSON.stringify({type:'final',text:'正常回复'}));`);
fs.mkdirSync(path.join(data, 'memory'));
fs.writeFileSync(path.join(data, 'memory/u10001.facts.json'), JSON.stringify({ facts: [{ t: 'SECRET_A喜欢猫' }] }));
fs.writeFileSync(path.join(data, 'memory/u10002.facts.json'), JSON.stringify({ facts: [{ t: 'SECRET_B喜欢狗' }] }));
fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ _closenessSeeded: 1, '10001': { sulk: 2, ignored: 2, affection: 0, turns: 0, days: 0 } }));
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
let socket, id = 1;
const sent = [];
server.on('connection', ws => { socket = ws; ws.on('message', raw => { const m = JSON.parse(raw); if (/send_(private|group)_msg/.test(m.action)) sent.push(m.params); ws.send(JSON.stringify({ echo: m.echo, status: 'ok', retcode: 0, data: { message_id: ++id } })); }); });
const child = spawn(process.execPath, [path.join(root, 'bridge.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: {
  ...process.env, ONEBOT_WS: `ws://127.0.0.1:${server.address().port}`, ONEBOT_TOKEN: '', ALLOWED_QQ: '10001,10002', ALLOWED_GROUPS: '20001', PROACTIVE_QQ: '10001', PC_OWNER: '10001', DSH_CLI: fake, DSH_HOME: path.join(data,'dsh'), BRIDGE_DATA: data, AGENT_CWD: root,
  CHRONOLIFE: 'true', CHRONOLIFE_PROACTIVE: 'false', PHONE_MONITOR: 'false', AUTONOMY: 'true', PROACTIVE: 'true', FACTS: 'false', REFLECT: 'false', JOURNAL: 'false', WEATHER: 'false', ONLINE_STATUS: 'false', MOOD_AVATAR: 'false', LONGNICK: 'false', PC_BUDDY: 'false', DREAM: 'false', LETTER: 'false', SPEAKER: 'false', NOTES: 'false', DRAWER: 'false', PLAY_MUSIC: 'false', POSTCARD: 'false', QZONE: 'false', DIY_STATUS: 'false', SLEEP_DRIFT: 'false', ANNIVERSARY: 'false', PHOTO: 'false', VOICE: 'false', RADIO: 'false', RHYTHM: 'false', MIMIC: 'false', POKE_SELF: 'true', CHASE: 'true', REACT: 'false', CLOSENESS_SET: '', TYPING_MS_PER_CHAR: '0', TYPO_PROB: '0', SLEEP_DELAY_PROB: '0', MERGE_MS: '0', DEEPSEEK_API_KEY: 'test',
} });
let errors=''; child.stderr.on('data', b => { errors += b; });
const wait = async fn => { const end=Date.now()+15000; while(!fn()){ if(Date.now()>end) throw new Error(errors.slice(-700)||'timeout'); await new Promise(r=>setTimeout(r,40)); } };
const texts = () => sent.flatMap(m=>m.message).map(m=>m.data?.text||'');
const prompts = () => fs.existsSync(dump) ? fs.readFileSync(dump,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const say = (text,user=10001,group=false) => socket.send(JSON.stringify({post_type:'message',message_type:group?'group':'private',self_id:99999,user_id:user,group_id:group?20001:undefined,message_id:++id,time:Math.floor(Date.now()/1000),sender:{nickname:'测试'},message:group?[{type:'at',data:{qq:'99999'}},{type:'text',data:{text}}]:[{type:'text',data:{text}}]}));
try {
  await wait(()=>socket);
  say('你好'); await wait(()=>prompts().length===1 && texts().includes('正常回复'));
  assert.ok(prompts()[0].includes('你自己小屋里的近况'));
  assert.ok(!prompts()[0].includes('现在才冒出来'));
  say('另一个人',10002); await wait(()=>prompts().length===2);
  assert.ok(!prompts()[1].includes('SECRET_A'));
  say('群里说一句',10001,true); await wait(()=>prompts().length===3);
  assert.ok(!prompts()[2].includes('SECRET_A') && !prompts()[2].includes('SECRET_B'));
  say('/生活 记住 TEST_UNIQUE'); await wait(()=>texts().some(t=>t.includes('已记录：note:')));
  const note=texts().find(t=>t.includes('已记录：note:')).split('已记录：')[1];
  say(`/生活 删除 ${note}`); await wait(()=>texts().some(t=>t.includes('已更新')));
  say('/生活 停用'); await wait(()=>texts().some(t=>t.includes('已停用')));
  say('停用后继续聊'); await wait(()=>prompts().length===4);
  assert.ok(!prompts()[3].includes('你自己小屋里的近况'));
  assert.ok(!prompts()[3].includes('TEST_UNIQUE'));
  await new Promise(r=>setTimeout(r,1500)); // 等“停用后继续聊”那句回复发完，别算进后面
  const n=sent.length; say('未授权',33333); await new Promise(r=>setTimeout(r,200)); assert.equal(sent.length,n);
  // 旧主动问候首次20秒触发也必须被接管，不能绕开ChronoLife关闭开关。
  const start=Date.now(); while(Date.now()-start<20500) await new Promise(r=>setTimeout(r,250));
  assert.equal(sent.length,n);
  console.log('PASS ChronoLife e2e：普通回复、无责怪提示、群私隔离、记忆删除、停用兼容、白名单、旧主动入口停发');
} finally { child.kill(); await once(child,'exit'); for(const ws of server.clients) ws.terminate(); server.close(); fs.rmSync(data,{recursive:true,force:true}); }
