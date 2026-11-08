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
  return release(latest.versionName, latest.versionCode);
}

let status = {};
try {
  status = JSON.parse(await readFile(output, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const sources = [['oneStore', readStore], ['website', readWebsite]];
const results = await Promise.allSettled(sources.map(([, read]) => read()));
for (const [index, result] of results.entries()) {
  const [source] = sources[index];
  if (result.status === 'fulfilled') {
    status[source] = { ...result.value, checkedAt: new Date().toISOString() };
    console.log(`${source}: ${result.value.version} (${result.value.code})`);
  } else {
    console.error(`${source}: ${result.reason.message}; retaining last verified value`);
  }
}
if (results.every(result => result.status === 'rejected')) process.exitCode = 1;
else await writeFile(output, JSON.stringify(status, null, 2) + '\n');
