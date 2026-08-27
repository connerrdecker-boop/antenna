/**
 * fetchLink unit test — loopback server only, no external network. Proves the
 * Part 4a contract (1 req/s, timeout, <500 chars => failed, never block) and
 * the Law 3 refusal of Instagram hosts. Run: npm run test:fetchlink
 */
import { createServer } from 'node:http'
import { fetchLink, htmlToText, isFetchableUrl, JS_SHELL_FLOOR } from '@/pipeline/lib/fetchLink'
import { PipelineHalt } from '@/lib/env'

let fails = 0
const ok = (l: string, c: boolean, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${l}${!c && d ? ` — ${d}` : ''}`); if (!c) fails++ }

async function main() {
  ok('isFetchableUrl: stan.store allowed', isFetchableUrl('https://stan.store/x'))
  ok('isFetchableUrl: instagram.com REFUSED', !isFetchableUrl('https://www.instagram.com/someone/'))
  ok('isFetchableUrl: m.instagram subdomain REFUSED', !isFetchableUrl('https://m.instagram.com/x'))
  ok('isFetchableUrl: instagr.am REFUSED', !isFetchableUrl('https://instagr.am/x'))
  ok('isFetchableUrl: non-http refused', !isFetchableUrl('ftp://stan.store/x'))
  try {
    await fetchLink('https://www.instagram.com/someone/')
    ok('fetchLink throws PipelineHalt on an IG URL', false)
  } catch (e) {
    ok('fetchLink throws PipelineHalt on an IG URL (Law 3)', e instanceof PipelineHalt && e.message.includes('Law 3'))
  }

  const rich = '<html><head><script>junk()</script><style>.x{}</style></head><body>' +
    '<h1>Coach Page</h1><p>' + 'Real coaching content with an offer, $299/mo, DM to apply. '.repeat(15) + '</p></body></html>'
  const shell = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'
  const server = createServer((req, res) => {
    if (req.url === '/rich') { res.end(rich); return }
    if (req.url === '/shell') { res.end(shell); return }
    if (req.url === '/slow') { setTimeout(() => res.end(rich), 1000); return }
    res.statusCode = 404; res.end('nope')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}`
  const fast = { intervalMs: 10, timeoutMs: 5000 }

  const richRes = await fetchLink(`${base}/rich`, fast)
  ok(`rich page (>${JS_SHELL_FLOOR} chars of text) -> ok`, richRes.status === 'ok' && richRes.text.includes('$299/mo'))
  ok('scripts and tags stripped from text', !richRes.text.includes('<') && !richRes.text.includes('junk()'))
  ok(`JS shell (<${JS_SHELL_FLOOR} chars) -> failed, never blocks`, (await fetchLink(`${base}/shell`, fast)).status === 'failed')
  ok('404 -> failed, no throw', (await fetchLink(`${base}/missing`, fast)).status === 'failed')
  ok('timeout -> failed, no throw', (await fetchLink(`${base}/slow`, { intervalMs: 10, timeoutMs: 250 })).status === 'failed')

  const t0 = Date.now()
  await fetchLink(`${base}/rich`, { intervalMs: 400, timeoutMs: 5000 })
  await fetchLink(`${base}/rich`, { intervalMs: 400, timeoutMs: 5000 })
  ok(`politeness interval holds (${Date.now() - t0}ms >= 400ms)`, Date.now() - t0 >= 400)
  ok('htmlToText decodes entities', htmlToText('a &amp; b &quot;c&quot;') === 'a & b "c"')

  server.close()
  console.log(fails === 0 ? '\nFETCHLINK UNIT GREEN' : `\nFETCHLINK UNIT RED — ${fails}`)
  process.exit(fails ? 1 : 0)
}
void main()
