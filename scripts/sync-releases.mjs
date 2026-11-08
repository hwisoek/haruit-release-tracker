import { readFile, writeFile } from 'node:fs/promises';

const output = new URL('../release-status.json', import.meta.url);
const oneStore = 'https://m.onestore.co.kr/v2/ko-kr/app/0001011251/about';
const website = 'https://weekflow-plan-20261014.hwisoek123.chatgpt.site/downloads';
const packageName = 'kr.weekflow.app';

async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function release(version, code) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !Number.isSafeInteger(code) || code < 1) {
    throw new Error('Missing or invalid version');
  }
  return { version, code };
}

async function readStore() {
  const html = await (await request(oneStore)).text();
  const payload = html.replace(/\\+"/g, '"');
  const match = payload.match(/"packageNm"\s*:\s*"kr\.weekflow\.app"\s*,\s*"packageVer"\s*:\s*"(\d+)"\s*,\s*"packageVerNm"\s*:\s*"([^"]+)"/);
  if (!match) throw new Error('ONE store package and version fields not found');
  return release(match[2], Number(match[1]));
}

async function readWebsite() {
  const manifest = await (await request(website + '/android-latest.json')).json();
  if (manifest.package !== packageName) throw new Error('Unexpected APK package');
  const latest = manifest.channels.release;
  const version = release(latest.versionName, latest.versionCode);
  try {
    const { inspectApk } = await import('./inspect-apk.mjs');
    return { ...version, apk: await inspectApk(latest.url, latest, request) };
  } catch (error) {
    console.error('APK verification: ' + error.message);
    return { ...version, apk: null };
  }
}

let status = {};
try {
  status = JSON.parse(await readFile(output, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

async function readIssues() {
  const issues = [];
  for (let page = 1; page <= 10; page++) {
    const url = 'https://api.github.com/repos/hwisoek/haruit-release-tracker/issues?state=all&per_page=100&page=' + page;
    const batch = await (await request(url)).json();
    if (!Array.isArray(batch)) throw new Error('Invalid GitHub issues response');
    issues.push(...batch.filter(item => !item.pull_request).map(item => ({
      number: item.number, title: item.title, state: item.state,
      needsReproduction: item.labels.some(label => label.name === 'needs-reproduction')
    })));
    if (batch.length < 100) return { issues };
  }
  throw new Error('Issue pagination limit reached');
}
const sources = [['oneStore', readStore], ['website', readWebsite], ['github', readIssues]];
const results = await Promise.allSettled(sources.map(([, read]) => read()));
for (const [index, result] of results.entries()) {
  const [source] = sources[index];
  if (result.status === 'fulfilled') {
    status[source] = { ...result.value, checkedAt: new Date().toISOString() };
    console.log(source + ": verified");
  } else {
    console.error(`${source}: ${result.reason.message}; retaining last verified value`);
  }
}
if (results.every(result => result.status === 'rejected')) process.exitCode = 1;
else await writeFile(output, JSON.stringify(status, null, 2) + '\n');
