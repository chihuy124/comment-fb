const fs = require('fs');
const code = fs.readFileSync('extension/background.js', 'utf8');
let listener = null, nextTabId = 100;
const created = [], removed = [], logs = [];
let harvestCall = 0;

const chrome = {
  storage: { local: { get: async () => ({}) } },
  runtime: { onMessage:{addListener:(f)=>listener=f}, getPlatformInfo:()=>{}, getManifest:()=>({version:'t'}), sendMessage: async()=>({}) },
  scripting: { executeScript: async()=>{} },
  tabs: {
    create: async () => { const t={id:nextTabId++}; created.push(t.id); return t; },
    remove: async (id) => { removed.push(id); },
    sendMessage: async()=>{},
    update: async (id, props) => {
      if (!props?.url || props.url === 'about:blank') return;
      const isReel = /\/reels?\/\d+|\/watch\/\?v=\d+/.test(props.url);
      setTimeout(() => {
        if (!listener) return;
        if (isReel) {
          listener({ type:'SCRAPE_RESULT', comments:['A: xem tiếp'], foundUrls:[] }, {tab:{id}}, ()=>{});
        } else {
          harvestCall++;
          // Stuck on the first two harvests, unstuck only after the tab is replaced
          const stuck = harvestCall <= 2;
          listener({
            type:'HARVEST_RESULT',
            urls: stuck ? [] : Array.from({length:3},(_,i)=>`https://www.facebook.com/reel/91000000000${i}`),
            stuck,
          }, {tab:{id}}, ()=>{});
        }
      }, 5);
    },
  },
};
const oL=console.log,oW=console.warn,oE=console.error;
const cap=f=>(...a)=>{logs.push(a.join(' '));f(...a);};
console.log=cap(oL);console.warn=cap(oW);console.error=cap(oE);
const api = new Function('chrome','console',code+'\n;return {huntReels};')(chrome,console);

(async () => {
  const res = await api.huntReels({ targetCount:1, minIntent:1, maxChecks:5,
    intentKeywords:['xem tiếp'], searchKeywords:[], excludeUrls:[] }, null);
  console.log=oL;console.warn=oW;console.error=oE;
  const usedRenav = logs.some(l=>l.includes('renavigate (1/2)'));
  const usedFresh = logs.some(l=>l.includes('fresh-tab (2/2)'));
  const replaced = logs.some(l=>l.includes('replaced tab'));
  console.log('\n=========== KẾT QUẢ NHÁNH STUCK ===========');
  console.log('bậc 1 renavigate đã thử :', usedRenav ? '✅' : '❌');
  console.log('bậc 2 fresh-tab đã thử  :', usedFresh ? '✅' : '❌');
  console.log('tab được thay thế       :', replaced ? '✅ ' + created.join(' → ') : '❌');
  console.log('tab cũ đã đóng          :', removed.length ? '✅ ' + removed.join(', ') : '❌');
  console.log('stopReason              :', res.stopReason, '| qualified', res.reels.length);
  const ok = usedRenav && usedFresh && replaced && removed.length > 0 && res.reels.length === 1;
  console.log('\n' + (ok ? '✅ PASS' : '❌ FAIL'));
  process.exit(ok?0:1);
})();
