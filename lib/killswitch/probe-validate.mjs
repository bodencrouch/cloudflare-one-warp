import { BOOTSTRAP_V4, BOOTSTRAP_V6, KILLSWITCH_TABLE } from './rules.mjs';
// nft coalesces the adjacent approved .192/24 and .193/24 ranges.
const bootstrap = [...BOOTSTRAP_V4, ...BOOTSTRAP_V6, '162.159.192.0/23'];
const lan = ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','fc00::/7','fe80::/10'];
const values = value => value?.set ? value.set.flatMap(values) : value?.prefix ? [`${value.prefix.addr}/${value.prefix.len}`] : [value];
/** Validate the security-relevant shape of our table, failing closed on unknown expressions. */
export function validateProtectionJson(text, { allowLan } = {}) {
 try {
  const entries = JSON.parse(text).nftables;
  if (!Array.isArray(entries)) return false;
  const owned = value => value.family === 'inet' && value.table === KILLSWITCH_TABLE;
  const chains = entries.filter(entry => entry.chain && owned(entry.chain)).map(entry => entry.chain);
  if (chains.length !== 1 || chains[0].name !== 'output' || chains[0].type !== 'filter' || chains[0].hook !== 'output' || chains[0].policy !== 'drop') return false;
  const rules = entries.filter(entry => entry.rule && owned(entry.rule)).map(entry => entry.rule);
  let loopback = false, tunnel = false;
  for (const rule of rules) {
   if (rule.chain !== 'output' || !Array.isArray(rule.expr)) return false;
   const expressions = rule.expr.filter(expr => !expr.counter);
   if (!expressions.length || !Object.hasOwn(expressions.at(-1), 'accept')) return false;
   const matches = expressions.slice(0,-1);
   if (!matches.length || matches.some(expr => !expr.match || expr.match.op !== '==')) return false;
   const iface = matches.find(expr => expr.match.left?.meta?.key === 'oifname')?.match;
   if (iface) {
    if (matches.length !== 1 || !['lo','CloudflareWARP'].includes(iface.right)) return false;
    loopback ||= iface.right === 'lo'; tunnel ||= iface.right === 'CloudflareWARP'; continue;
   }
   const get = (protocol, field) => matches.find(expr => expr.match.left?.payload?.protocol === protocol && expr.match.left.payload.field === field)?.match;
   const address = get('ip','daddr') || get('ip6','daddr');
   if (address) {
    const destinations = values(address.right);
    const port = get('tcp','dport') || get('udp','dport');
    const sourcePort = get('udp','sport');
    if (destinations.every(value => lan.includes(value)) && matches.length === 1) {
     if (allowLan === false) return false;
     continue;
    }
    if (destinations.every(value => bootstrap.includes(value)) && port && matches.length === 2) {
     const allowed = port.left.payload.protocol === 'tcp' ? [443] : [443,500,1701,2408,4500];
     if (values(port.right).every(value => allowed.includes(value))) continue;
    }
    if (matches.length === 3 && sourcePort && port && port.left.payload.protocol === 'udp' && destinations.length === 1) {
     if (destinations[0] === '255.255.255.255' && sourcePort.right === 68 && port.right === 67) continue;
     if (destinations[0] === 'ff02::1:2' && sourcePort.right === 546 && port.right === 547) continue;
    }
    return false;
   }
   const hop = get('ip6','hoplimit'), type = get('icmpv6','type');
   if (matches.length === 2 && hop?.right === 255 && type && values(type.right).every(value => [133,135,136,'nd-router-solicit','nd-neighbor-solicit','nd-neighbor-advert'].includes(value))) continue;
   return false;
  }
  return loopback && tunnel;
 } catch { return false; }
}
