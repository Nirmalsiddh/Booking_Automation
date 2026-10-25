#!/usr/bin/env python3
"""Offline Docker/n8n baseline harness. Python standard library only."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
RESULTS = ROOT / '.harness-results'
BASE = 'local/booking-harness-runtime:2.44.6-lean'
IMAGE = 'local/booking-harness:milestone1'
IMAGE_M2 = 'local/booking-harness:milestone2'
IMAGE_M3 = 'local/booking-harness:milestone3'
SCENARIOS = ['new-inquiry', 'existing-inquiry', 'multi-turn-qualification', 'new-booking',
             'reschedule', 'cancellation', 'decline', 'invalid-ai', 'calendar-failure',
             'duplicate-webhook', 'reply-during-follow-up']
EXTENDED = SCENARIOS + ['validated-partial-profile','invalid-profile-patch','null-profile-patch',
    'confirmed-inquiries','decline-with-booking','invalid-booking-transitions','unknown-state',
    'reengage','cancelled-rebooking']
M3 = EXTENDED + ['ai-without-authorization','ai-date-mismatch','ai-extra-field','ai-wrong-type','impossible-date','past-date','outside-hours','cancel-without-confirmation','cancel-stale-confirmation','cancel-confirmation-conversation','safe-response','invalid-inbound']
MARKER = 'booking-harness-disposable-v1'


def command(args, **kwargs):
    # Docker client config may silently inject host proxy bindings into new containers.
    # An empty, temporary config prevents both that injection and registry credentials.
    with tempfile.TemporaryDirectory(prefix='booking-harness-docker-') as docker_config:
        if args[0] == 'docker' and 'env' not in kwargs:
            kwargs['env'] = {**os.environ, 'DOCKER_CONFIG': docker_config}
        result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {args}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def initialize_results():
    if RESULTS.is_symlink():
        raise RuntimeError('Refusing symlinked result directory')
    if RESULTS.exists():
        if not (RESULTS / '.harness-marker').is_file() or (RESULTS / '.harness-marker').read_text() != MARKER:
            raise RuntimeError('Unrecognized results directory; refusing to overwrite')
    else:
        RESULTS.mkdir()
        (RESULTS / '.harness-marker').write_text(MARKER)


def add_bytes(tar, name, value):
    data = value.encode()
    info = tarfile.TarInfo(name)
    info.size, info.mode, info.uid, info.gid = len(data), 0o644, 0, 0
    tar.addfile(info, io.BytesIO(data))


def build(runtime, node):
    """Create a local rootfs without registry pulls, package installs, or build RUN steps."""
    runtime = runtime.resolve()
    package = runtime / 'node_modules/n8n/package.json'
    if json.loads(package.read_text())['version'] != '2.44.6':
        raise RuntimeError('Expected locally provisioned n8n 2.44.6')
    node = node.resolve()
    node_version = command([str(node), '--version']).strip()
    if not node_version.startswith('v24.') or platform.system() != 'Linux':
        raise RuntimeError('Image bootstrap requires Linux and Node 24')
    # Refuse runtime symlinks that could import unrelated host data.
    for directory, dirs, files in os.walk(runtime):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink() and not path.resolve().is_relative_to(runtime):
                raise RuntimeError(f'Runtime symlink escapes dependency tree: {path}')
    native = runtime / 'node_modules/sqlite3/build/Release/node_sqlite3.node'
    libraries = set()
    for binary in (node, native):
        output = command(['ldd', str(binary)])
        if 'not found' in output:
            raise RuntimeError(f'Missing native dependency: {binary}')
        libraries.update(re.findall(r'(/[^\s()]+)', output))
    print('Building local runtime image from provisioned files; no network access used.', flush=True)
    proc = subprocess.Popen(['docker', 'import', '--change', 'ENV PATH=/usr/bin', '-', BASE],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def readable(info):
        # Compiled JS is executed here, never TypeScript compilation. Omitting only
        # source maps and declaration files halves inode use on Docker's vfs driver.
        if info.name.endswith(('.map', '.d.ts', '.d.cts', '.d.mts')):
            return None
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        if info.isdir():
            info.mode = 0o755
        elif info.isfile():
            info.mode = 0o755 if info.mode & 0o111 else 0o644
        return info
    try:
        with tarfile.open(fileobj=proc.stdin, mode='w|') as tar:
            tar.add(node, arcname='usr/bin/node', filter=readable)
            for lib in sorted(libraries):
                tar.add(Path(lib).resolve(), arcname=lib.lstrip('/'), filter=readable)
            # Never import runtime-root .env/.npmrc files, caches, or unrelated user data.
            tar.add(runtime / 'node_modules', arcname='opt/runtime/node_modules', filter=readable)
            add_bytes(tar, 'etc/passwd', 'root:x:0:0:root:/root:/usr/bin/node\nharness:x:1000:1000:Harness:/data:/usr/bin/node\n')
            add_bytes(tar, 'etc/group', 'root:x:0:\nharness:x:1000:\n')
            add_bytes(tar, 'etc/os-release', 'ID=offline-harness\nNAME=OfflineHarness\n')
        proc.stdin.close()
        proc.stdin = None
        stdout, stderr = proc.communicate()
        if proc.returncode:
            raise RuntimeError(stderr.decode())
        print(stdout.decode().strip(), flush=True)
    finally:
        if proc.poll() is None:
            proc.kill()
    build_image()


def build_image():
    # Only the exact baseline and harness files enter the test image, never the checkout or secrets.
    command(['docker', 'image', 'inspect', BASE])  # Local-only check; never resolve a missing base remotely.
    with tempfile.TemporaryDirectory(prefix='booking-harness-build-') as temporary:
        context = Path(temporary)
        (context / 'harness/custom').mkdir(parents=True)
        for file in ('container.js', 'scenarios.js', 'scenarios-milestone2.js', 'scenarios-milestone3.js'):
            shutil.copyfile(HERE / file, context / 'harness' / file)
        shutil.copyfile(HERE / 'Mock.node.js', context / 'harness/custom/Mock.node.js')
        (context / 'baseline').mkdir()
        shutil.copyfile(ROOT / 'workflow.json', context / 'baseline/workflow.json')
        shutil.copyfile(ROOT / 'workflows/milestone2.json', context / 'baseline/milestone2.json')
        shutil.copyfile(ROOT / 'workflows/milestone3.json', context / 'baseline/milestone3.json')
        shutil.copyfile(HERE / 'Dockerfile', context / 'Dockerfile')
        print(command(['docker', 'build', '--network=none', '--pull=false',
                       '--build-arg', f'RUNTIME_IMAGE={BASE}', '--build-arg',
                       'BASELINE_SHA=' + hashlib.sha256((ROOT / 'workflow.json').read_bytes()).hexdigest(),
                       '--build-arg', 'MILESTONE2_SHA=' + hashlib.sha256((ROOT / 'workflows/milestone2.json').read_bytes()).hexdigest(),
                       '--build-arg', 'MILESTONE3_SHA=' + hashlib.sha256((ROOT / 'workflows/milestone3.json').read_bytes()).hexdigest(),
                       '-t', IMAGE_M3, str(context)]))
    print('Initialized offline test image:', IMAGE_M3)
    try:
        command(['docker', 'image', 'inspect', IMAGE_M2])
    except RuntimeError:
        command(['docker', 'image', 'tag', IMAGE_M3, IMAGE_M2])
    # Preserve an existing Milestone 1 image. A fresh install can use the extended
    # runner in its backward-compatible baseline mode for the original 11 cases.
    try:
        command(['docker', 'image', 'inspect', IMAGE])
    except RuntimeError:
        command(['docker', 'image', 'tag', IMAGE_M2, IMAGE])


def verify_config(config):
    host, image = config['HostConfig'], config['Config']
    checks = [
        (host['NetworkMode'] == 'none', 'network must be none'),
        (host['ReadonlyRootfs'], 'root filesystem must be read-only'),
        (host['CapDrop'] == ['ALL'], 'all capabilities must be dropped'),
        ('no-new-privileges' in host['SecurityOpt'], 'no-new-privileges required'),
        (image['User'] == '1000:1000', 'non-root user required'),
        (not host['Privileged'] and not host.get('Binds'), 'privileged/bind mounts forbidden'),
        (not host.get('CapAdd') and not host.get('Devices'), 'additional capabilities/devices forbidden'),
        (host.get('PidMode') != 'host' and host.get('IpcMode') != 'host', 'host namespaces forbidden'),
        (not config.get('Mounts'), 'host volumes forbidden'),
        (not host.get('PortBindings'), 'published ports forbidden'),
        (set(host['Tmpfs']) == {'/data', '/tmp'}, 'only disposable tmpfs mounts allowed'),
        (image['Entrypoint'] == ['/usr/bin/node', '/harness/container.js'], 'unexpected entrypoint'),
        (all(e.split('=', 1)[0] in {'PATH', 'HOME', 'HOSTNAME'} for e in image['Env']), 'unexpected environment variable'),
    ]
    for valid, reason in checks:
        if not valid:
            raise RuntimeError('Unsafe container: ' + reason)


def run(ids, allow_baseline, variant='baseline', extended=False):
    initialize_results()
    run_dir = RESULTS / ('run-' + uuid.uuid4().hex[:12])
    run_dir.mkdir()
    source = ROOT / ('workflow.json' if variant == 'baseline' else f'workflows/{variant}.json')
    image = IMAGE_M3 if variant == 'milestone3' else IMAGE_M2 if extended or variant == 'milestone2' else IMAGE
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    image_config = json.loads(command(['docker', 'image', 'inspect', image]))[0]
    if image_config['Config'].get('Labels', {}).get('booking.harness.' + variant + '-sha') != digest:
        raise RuntimeError('Image baseline differs from checkout; rerun build before execution')
    summaries = []
    jobs = ['all'] if ids in (SCENARIOS, EXTENDED, M3) else ids
    for scenario in jobs:
        dest = run_dir / scenario
        dest.mkdir()
        container = command(['docker', 'create', '--pull=never', '--network=none', '--read-only',
          '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=1000:1000',
          '--pids-limit=256', '--memory=3g', '--cpus=2',
          '--tmpfs=/data:rw,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=0700',
          '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700',
          image, scenario, *([variant, 'extended' if extended else 'original'] if image in (IMAGE_M2, IMAGE_M3) else [])]).strip()
        try:
            config = json.loads(command(['docker', 'inspect', container]))[0]
            verify_config(config)  # Must pass before docker start.
            (dest / 'docker-safety.json').write_text(json.dumps({
                'networkMode': config['HostConfig']['NetworkMode'], 'readOnly': True,
                'noHostMounts': True, 'noPorts': True, 'nonRoot': True,
                'imageId': config['Image'], 'sourceSha256': digest,
            }, indent=2))
            command(['docker', 'start', container])
            deadline = time.monotonic() + (900 if scenario == 'all' else 240)
            completion = None
            while time.monotonic() < deadline:
                probe = subprocess.run(['docker', 'exec', container, '/usr/bin/node', '-e',
                    'process.stdout.write(require("fs").readFileSync("/data/completion.json"))'],
                    text=True, capture_output=True, timeout=10)
                if probe.returncode == 0:
                    completion = json.loads(probe.stdout)
                    break
                if command(['docker', 'inspect', '--format={{.State.Running}}', container]).strip() != 'true':
                    break
                time.sleep(1)
            logs = subprocess.run(['docker', 'logs', container], text=True, capture_output=True)
            (dest / 'container.log').write_text(logs.stdout + '\n' + logs.stderr)
            # Docker cp can see the underlying empty directory rather than a running
            # container's tmpfs on some daemons. Export through the live mount namespace.
            export_js = r'''
const fs=require('fs'), path=require('path'), out={};let total=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(dir==='/data' && entry.name==='n8n')continue;
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())walk(file);
  else if(entry.isFile()){
    const data=fs.readFileSync(file);total+=data.length;
    if(total>32*1024*1024)throw Error('Artifact export exceeds size limit');
    out[path.relative('/data',file)]=data.toString('base64');
  }else throw Error('Unexpected non-file artifact');
}}
walk('/data');process.stdout.write(JSON.stringify(out));
'''
            files = json.loads(command(['docker', 'exec', container, '/usr/bin/node', '-e', export_js]))
            for relative, encoded in files.items():
                path = dest / relative
                if not path.resolve().is_relative_to(dest.resolve()):
                    raise RuntimeError('Unsafe artifact export path')
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(base64.b64decode(encoded, validate=True))
            if completion is None or completion['exitCode'] or not (dest / 'result.json').exists():
                raise RuntimeError(f'{scenario}: harness failed; inspect {dest}/container.log and turn logs')
            manifest = json.loads((dest / 'transform-manifest.json').read_text())
            if manifest['sourceSha256'] != digest:
                raise RuntimeError('Image baseline differs from checkout; rerun init')
            reports = json.loads((dest / 'result.json').read_text())['scenarios']
            expected_ids = ids if scenario == 'all' else [scenario]
            if [report['scenario'] for report in reports] != expected_ids:
                raise RuntimeError('Missing, duplicate, or unexpected scenario results')
            if any(run['exitCode'] != 0 for report in reports for run in report['runs']):
                raise RuntimeError('An underlying n8n command returned a nonzero exit status')
            summaries.extend(reports)
            for report in reports:
                print(f"{report['status']:4} {report['scenario']}", flush=True)
                for check in report['checks']:
                    known = ' [known baseline defect]' if check['knownBaselineDefect'] else ''
                    print(f"     {check['status']} {check['name']}{known if check['status']=='FAIL' else ''}", flush=True)
        finally:
            subprocess.run(['docker', 'rm', '-f', container], capture_output=True)
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise RuntimeError('Original workflow changed during execution')
    unsupported = manifest['unsupported']
    summary = {'variant': variant, 'sourceSha256': digest, 'scenarios': summaries, 'unsupported': unsupported}
    (run_dir / 'summary.json').write_text(json.dumps(summary, indent=2))
    lines = ['# Mocked n8n baseline results', '', f'Original workflow SHA-256: `{digest}`', '',
             '| Scenario | Result |', '|---|---|']
    lines += [f"| {r['scenario']} | {r['status']} |" for r in summaries]
    lines += ['', '## Failed assertions', '']
    lines += [f"- {r['scenario']}: {c['name']}" for r in summaries for c in r['checks'] if c['status']=='FAIL']
    lines += ['', '## Unsupported / unverified', ''] + ['- ' + s for s in unsupported]
    (run_dir / 'summary.md').write_text('\n'.join(lines) + '\n')
    print('Artifacts:', run_dir)
    failures = [c for r in summaries for c in r['checks'] if c['status']=='FAIL']
    return 1 if failures and (not allow_baseline or any(not c['knownBaselineDefect'] for c in failures)) else 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    init = sub.add_parser('init', help='Build only from already-installed local dependencies')
    init.add_argument('--runtime', type=Path, required=True, help='Directory containing node_modules/n8n')
    init.add_argument('--node', type=Path, default=Path(shutil.which('node') or '/missing/node'))
    listing = sub.add_parser('list')
    listing.add_argument('--workflow', choices=['baseline', 'milestone2', 'milestone3'], default='baseline')
    sub.add_parser('build', help='Rebuild test layer using the already-initialized local runtime image')
    sub.add_parser('reset', help='Delete only marked disposable test results')
    test = sub.add_parser('run')
    test.add_argument('scenario', choices=['all'] + M3, default='all', nargs='?')
    test.add_argument('--workflow', choices=['baseline','milestone2','milestone3'], default='baseline')
    test.add_argument('--extended', action='store_true')
    test.add_argument('--allow-baseline-failures', action='store_true')
    args = p.parse_args()
    if args.action == 'list':
        print('\n'.join(M3 if args.workflow == 'milestone3' else EXTENDED if args.workflow == 'milestone2' else SCENARIOS)); return 0
    if args.action == 'init':
        build(args.runtime, args.node); return 0
    if args.action == 'build':
        build_image(); return 0
    if args.action == 'reset':
        initialize_results()
        shutil.rmtree(RESULTS)
        print('Removed only marked .harness-results; no containers, images, or user stores reset.')
        return 0
    extended = args.extended or args.workflow in ('milestone2','milestone3') or args.scenario in EXTENDED[len(SCENARIOS):]
    return run((M3 if args.workflow == 'milestone3' else EXTENDED if extended else SCENARIOS) if args.scenario == 'all' else [args.scenario], args.allow_baseline_failures, args.workflow, extended)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt) as exc:
        print(f'ERROR (fail closed): {exc}', file=sys.stderr)
        sys.exit(2)
