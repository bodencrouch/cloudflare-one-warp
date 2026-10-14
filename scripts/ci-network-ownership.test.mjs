import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildEnableScript } from '../lib/killswitch/rules.mjs';

test('strict firewall permits address acquisition without arbitrary DNS or bootstrap ports', () => {
 const rules = buildEnableScript();
 assert.match(rules, /udp sport 68 udp dport 67/);
 assert.match(rules, /udp sport 546 udp dport 547/);
 assert.match(rules, /ip6 hoplimit 255 icmpv6 type/);
 assert.doesNotMatch(rules, /dport 53\b/);
 for (const line of rules.split('\n').filter(line => line.includes('ip daddr { 162.159'))) assert.match(line, /(?:tcp|udp) dport/);
 assert.match(rules, /tcp dport 443 accept/);
});
test('KDE proxy preserves existing policy and relinquishes externally changed configuration', t => {
 if (process.platform !== 'linux') return t.skip('Linux desktop');
 const dir = mkdtempSync(join(tmpdir(), 'warp-kde-owner-'));
 t.after(() => rmSync(dir, {recursive:true,force:true}));
 const bin = join(dir,'bin'); mkdirSync(bin);
 const config = join(dir,'config'); mkdirSync(config);
 const file = join(config,'kioslaverc');
 writeFileSync(join(bin,'kwriteconfig6'), `#!${process.execPath}\nconst fs=require('fs'),p=require('path'),a=process.argv.slice(2),f=p.join(process.env.XDG_CONFIG_HOME,'kioslaverc');const fail=p.join(process.env.XDG_CONFIG_HOME,'writer-fail');if(fs.existsSync(fail)){const count=Number(fs.readFileSync(fail,'utf8'))+1;fs.writeFileSync(fail,String(count));if(count>=3)process.exit(1)}let values={};for(const l of fs.existsSync(f)?fs.readFileSync(f,'utf8').split('\\n'):[]){let i=l.indexOf('=');if(i>=0)values[l.slice(0,i)]=l.slice(i+1)}let k=a[a.indexOf('--key')+1];if(a.includes('--delete'))delete values[k];else values[k]=a.at(-1);fs.writeFileSync(f,'[Proxy Settings]\\n'+Object.entries(values).map(([k,v])=>k+'='+v).join('\\n')+'\\n');`,{mode:0o755});
 writeFileSync(join(bin,'dbus-send'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 const run = (...args) => spawnSync('bash',['scripts/cloudflare-one-warp-kde-proxy-sync',...args],{env:{...process.env,HOME:dir,XDG_CONFIG_HOME:config,PATH:bin+':'+process.env.PATH},encoding:'utf8'});
 writeFileSync(file,'[Proxy Settings]\nProxyType=2\nhttp_proxy=corporate:8080\n');
 const original=readFileSync(file,'utf8');
 assert.equal(run('off').status,0); assert.equal(readFileSync(file,'utf8'),original);
 assert.equal(run('on','45000').status,3); assert.equal(readFileSync(file,'utf8'),original);
 writeFileSync(file,'[Proxy Settings]\nProxyType=0\nhttp_proxy=saved:8080\n');
 assert.equal(run('on','45000').status,0);
 assert.match(readFileSync(file,'utf8'),/http_proxy=127.0.0.1:45000/);
 // A -> B port change fails after two writes, then rollback also fails.
 writeFileSync(join(config,'writer-fail'),'0');
 assert.notEqual(run('on','47000').status,0);
 assert.equal(JSON.parse(readFileSync(join(config,'cloudflare-one-warp','kde-proxy-owner.json'),'utf8')).previous.applied.http_proxy,'127.0.0.1:45000');
 rmSync(join(config,'writer-fail'));
 assert.equal(run('on','46000').status,0);
 assert.equal(run('off').status,0);
 assert.match(readFileSync(file,'utf8'),/http_proxy=saved:8080/);
 assert.match(readFileSync(file,'utf8'),/ProxyType=0/);
 assert.equal(run('on','45000').status,0);
 writeFileSync(file,original);
 assert.equal(run('off').status,0);assert.equal(readFileSync(file,'utf8'),original);
 assert.equal(existsSync(join(config,'cloudflare-one-warp','kde-proxy-owner.json')),false);
 assert.equal(run('on','65536').status,2);
 // Interrupted activation: only the first key was written; journal preserves originals.
 const owner=join(config,'cloudflare-one-warp','kde-proxy-owner.json');
 const before={ProxyType:'0',http_proxy:'saved:8080',https_proxy:null,ftp_proxy:null,socks_proxy:null,NoProxyFor:null};
 const applied={ProxyType:'1',http_proxy:'127.0.0.1:45000',https_proxy:'127.0.0.1:45000',ftp_proxy:'127.0.0.1:45000',socks_proxy:'127.0.0.1:45000',NoProxyFor:'localhost,127.0.0.0/8,::1'};
 writeFileSync(file,'[Proxy Settings]\nProxyType=1\nhttp_proxy=saved:8080\n');
 writeFileSync(owner,JSON.stringify({original:before,applied,pending:true}));
 assert.equal(run('off').status,0);assert.match(readFileSync(file,'utf8'),/ProxyType=0/);
 assert.match(readFileSync(file,'utf8'),/http_proxy=saved:8080/);
 writeFileSync(join(config,'writer-fail'),'0');
 assert.notEqual(run('on','45000').status,0);
 assert.equal(existsSync(owner),true); // failed rollback must retain recovery journal
 rmSync(join(config,'writer-fail'));
 assert.equal(run('off').status,0);
 assert.match(readFileSync(file,'utf8'),/ProxyType=0/);
 assert.match(readFileSync(file,'utf8'),/http_proxy=saved:8080/);
 writeFileSync(file,'[Proxy Settings][$i]\nProxyType=2\n');
 assert.notEqual(run('on','45000').status,0);
 assert.match(readFileSync(file,'utf8'),/ProxyType=2/);

});

test('NetworkManager dispatcher identifies exported profile rather than interface argument', () => {
 const dispatcher = readFileSync('packaging/networkmanager/99-cloudflare-one-warp','utf8');
 assert.match(dispatcher,/CONNECTION_ID="\$\{CONNECTION_ID:-\}"/);
 assert.doesNotMatch(dispatcher,/HOME\/\.local\/share/);
 assert.match(dispatcher,/stat -c %u/);
 const result=spawnSync('bash',['packaging/networkmanager/99-cloudflare-one-warp','eth0','up'],{env:{...process.env,CONNECTION_ID:'Unrelated corporate connection'},encoding:'utf8'});
 assert.equal(result.status,0);
});

test('NetworkManager reports failed conflicting profile removal instead of claiming success', async t => {
 if (process.platform !== 'linux') return t.skip('Linux desktop');
 const dir=mkdtempSync(join(tmpdir(),'warp-nm-failure-'));
 const originalPath=process.env.PATH;
 t.after(()=>{process.env.PATH=originalPath;rmSync(dir,{recursive:true,force:true});});
 writeFileSync(join(dir,'nmcli'), '#!/bin/sh\nif [ "$1 $2" = "connection show" ] || [ "$1" = "-t" ]; then\n echo "Cloudflare One WARP (WireGuard):activated"\n exit 0\nfi\nif [ "$2" = "down" ]; then echo "policy denied" >&2; exit 1; fi\nexit 0\n',{mode:0o755});
 process.env.PATH=dir+':'+originalPath;
 const { syncNmForWarpState, deactivateCloudflareOneWarpNmProfiles }=await import('../lib/networkmanager/sync.mjs');
 const sync=await syncNmForWarpState({status:{connected:true},settings:{Mode:'warp',Protocol:'MASQUE'}});
 assert.equal(sync.ok,false);assert.match(sync.stderr,/policy denied/);
 const off=await deactivateCloudflareOneWarpNmProfiles();
 assert.equal(off.ok,false);assert.equal(off.failures.length,1);
});

test('firewall status rejects empty, permissive, malformed and unexpected nft rules', async () => {
 const {validateProtectionJson}=await import('../lib/killswitch/probe-validate.mjs');
 const table='cloudflare_one_warp_killswitch';
 const chain={chain:{family:'inet',table,name:'output',type:'filter',hook:'output',policy:'drop'}};
 const rule=name=>({rule:{family:'inet',table,chain:'output',expr:[{match:{op:'==',left:{meta:{key:'oifname'}},right:name}},{accept:null}]}});
 const valid={nftables:[chain,rule('lo'),rule('CloudflareWARP')]};
 assert.equal(validateProtectionJson(JSON.stringify(valid)),true);
 assert.equal(validateProtectionJson('{broken'),false);
 assert.equal(validateProtectionJson(JSON.stringify({nftables:[]})),false);
 assert.equal(validateProtectionJson(JSON.stringify({nftables:[chain]})),false);
 const permissive=structuredClone(valid);permissive.nftables[0].chain.policy='accept';
 assert.equal(validateProtectionJson(JSON.stringify(permissive)),false);
 const bypass=structuredClone(valid);bypass.nftables.push({rule:{family:'inet',table,chain:'output',expr:[{accept:null}]}});
 assert.equal(validateProtectionJson(JSON.stringify(bypass)),false);
 const foreign=structuredClone(valid);foreign.nftables.push(rule('eth0'));
 assert.equal(validateProtectionJson(JSON.stringify(foreign)),false);
});

test('real nftables 1.1.6 JSON including coalesced prefixes validates both LAN modes', async () => {
 const {validateProtectionJson}=await import('../lib/killswitch/probe-validate.mjs');
 for (const mode of ['on','off']) {
  const actual=JSON.parse(readFileSync(new URL(`./fixtures/nft-killswitch-lan-${mode}.json`,import.meta.url),'utf8'));
  assert.equal(validateProtectionJson(JSON.stringify(actual)),true);
  assert.equal(validateProtectionJson(JSON.stringify(actual),{allowLan:false}),mode === 'off');
  const addressRule=actual.nftables.find(row=>row.rule?.expr.some(expr=>expr.match?.right?.set?.some(value=>value.prefix?.addr==='162.159.192.0')));
  assert.ok(addressRule);
  const prefix=addressRule.rule.expr.find(expr=>expr.match?.right?.set)?.match.right.set.find(value=>value.prefix?.addr==='162.159.192.0');
  assert.equal(prefix.prefix.len,23);
  prefix.prefix.len=22;
  assert.equal(validateProtectionJson(JSON.stringify(actual)),false); // widening the approved aggregate must fail
 }
});

test('NetworkManager proxy helper preserves vendor port and only changes an explicit valid port', t => {
 if(process.platform !== 'linux') return t.skip('Linux helper');
 const dir=mkdtempSync(join(tmpdir(),'warp-nm-port-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const bin=join(dir,'bin');mkdirSync(bin);
 const log=join(dir,'commands'),state=join(dir,'port');writeFileSync(state,'41000');
 writeFileSync(join(bin,'warp-cli'),`#!${process.execPath}\nconst fs=require('fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.TEST_COMMANDS,JSON.stringify(args)+'\\n');if(args[0]==='proxy')fs.writeFileSync(process.env.TEST_PORT,args[2]);if(args[0]==='settings')console.log('Proxy port: '+fs.readFileSync(process.env.TEST_PORT,'utf8'));`,{mode:0o755});
 mkdirSync(join(dir,'scripts'));
 writeFileSync(join(dir,'scripts','cloudflare-one-warp-kde-proxy-sync'),`#!/bin/sh\nprintf '%s\\n' "$@" > "$TEST_KDE"\n`,{mode:0o755});
 const env={...process.env,PATH:bin+':'+process.env.PATH,TEST_COMMANDS:log,TEST_PORT:state,TEST_KDE:join(dir,'kde'),CLOUDFLARE_ONE_WARP_HOME:dir};
 delete env.CLOUDFLARE_ONE_WARP_PROXY_PORT;delete env.CLOUDFLARE_ONE_WARP_SKIP_KDE_PROXY;
 const activate=overrides=>spawnSync('bash',['scripts/cloudflare-one-warp-connect','up','Cloudflare One WARP (Local proxy)'],{env:{...env,...overrides},encoding:'utf8'});
 // A dispatcher-style invocation suppresses root KDE writes and retains the saved port.
 assert.equal(activate({CLOUDFLARE_ONE_WARP_SKIP_KDE_PROXY:'1'}).status,0);
 assert.equal(readFileSync(state,'utf8'),'41000');
 assert.equal(readFileSync(log,'utf8').includes('["proxy"'),false);
 assert.equal(activate({}).status,0);assert.equal(readFileSync(join(dir,'kde'),'utf8'),'on\n41000\n');
 assert.equal(activate({CLOUDFLARE_ONE_WARP_PROXY_PORT:'42000'}).status,0);
 assert.equal(readFileSync(state,'utf8'),'42000');
 const before=readFileSync(log,'utf8');
 assert.equal(activate({CLOUDFLARE_ONE_WARP_PROXY_PORT:'65536'}).status,2);
 assert.equal(readFileSync(log,'utf8'),before);
});
