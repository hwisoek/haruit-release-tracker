import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const buildTools = join(sdk, 'build-tools');
const versions = (await readdir(buildTools)).filter(name => /^\d+\.\d+\.\d+$/.test(name));
versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
const tools = join(buildTools, versions[0]);
const windows = process.platform === 'win32';

export async function inspectApk(url, metadata, request) {
  const apk = new URL(url);
  if (apk.origin !== 'https://weekflow-plan-20261014.hwisoek123.chatgpt.site' ||
      !/^\/downloads\/haruit-android-[\d.]+-release\.apk$/.test(apk.pathname)) {
    throw new Error('Unexpected APK source');
  }
  const bytes = Buffer.from(await (await request(apk)).arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== metadata.sha256 || bytes.length !== metadata.size) throw new Error('APK integrity mismatch');

  const dir = await mkdtemp(join(tmpdir(), 'haruit-apk-'));
  try {
    const file = join(dir, 'haruit.apk');
    await writeFile(file, bytes);
    const aapt = join(tools, windows ? 'aapt.exe' : 'aapt');
    const dump = args => execFileSync(aapt, [...args, file], { encoding: 'utf8' });
    const signing = execFileSync('java', ['-jar', join(tools, 'lib', 'apksigner.jar'),
      'verify', '--print-certs', file], { encoding: 'utf8' });
    const certificate = signing.match(/certificate SHA-256 digest: ([0-9a-f]{64})/)?.[1];
    if (certificate !== '78c9b628180f93b866ade03afa16467a029f22ed1d2fca96faa21a7e493680b5') {
      throw new Error('Unexpected APK signing certificate');
    }
    const badging = dump(['dump', 'badging']);
    const pkg = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);
    if (!pkg || pkg[1] !== 'kr.weekflow.app' || Number(pkg[2]) !== metadata.versionCode ||
        pkg[3] !== metadata.versionName) throw new Error('APK package or version mismatch');
    return { sha256, certificate, permissions: [...dump(['dump', 'permissions'])
      .matchAll(/^uses-permission(?:-sdk-\d+)?: name='([^']+)'/gm)].map(match => match[1]) };
  } finally {
    await rm(dir, { recursive: true });
  }
}
