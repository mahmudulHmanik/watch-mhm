const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'index.json');
const output = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = output.items || [];
const VIDEO = /\.(mkv|mp4|m4v|avi|webm|mov|ts)$/i;
const SUB = /\.(srt|vtt|ass|ssa)$/i;
const limit = Math.max(1, +(process.argv[2] || 12));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function list(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const html = await response.text();
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  return links.map(([, href, text]) => {
    const clean = text.replace(/<[^>]+>/g, '').trim();
    return { name: clean || decodeURIComponent(href), url: new URL(href, url).href, dir: href.endsWith('/') };
  }).filter(x => x.name && x.name !== '..' && x.name !== 'Parent Directory');
}

async function playlist(url) {
  const root = await list(url);
  const groups = [{ name: '', list: root }];
  for (const folder of root.filter(x => x.dir)) {
    const children = await list(folder.url).catch(() => []);
    groups.push({ name: folder.name, list: children });
  }
  return groups.flatMap(group => {
    const videos = group.list.filter(x => !x.dir && VIDEO.test(x.name));
    const subtitles = group.list.filter(x => !x.dir && SUB.test(x.name));
    return videos.map(video => ({
      group: group.name,
      name: video.name,
      url: video.url,
      size: '',
      subs: subtitles
        .filter(s => videos.length === 1 || s.name.toLowerCase().startsWith(video.name.replace(/\.[^.]+$/, '').toLowerCase()))
        .map(s => ({ name: s.name, url: s.url }))
    }));
  });
}

async function worker(queue) {
  while (queue.length) {
    const item = queue.shift();
    if (item.files) continue;
    try {
      item.files = await playlist(item.url);
      process.stdout.write(`ok ${items.indexOf(item) + 1}/${items.length}\r`);
    } catch (error) {
      item.files = [];
      process.stdout.write(`skip ${items.indexOf(item) + 1}/${items.length}: ${error.message}\n`);
    }
    if (items.indexOf(item) % 100 === 0) fs.writeFileSync(file, JSON.stringify(output));
  }
}

(async () => {
  const queue = items.filter(item => !item.files).slice();
  console.log(`Enriching ${queue.length} titles with ${limit} workers.`);
  await Promise.all(Array.from({ length: limit }, () => worker(queue)));
  fs.writeFileSync(file, JSON.stringify(output));
  console.log('\nCatalog enrichment complete.');
})();
