#!/usr/bin/env python3
"""Owned-volume, network-isolated Milestone 6 runner; never pulls images."""
import argparse
import os
import importlib.util
import base64
import copy
import hashlib
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import run as baseline

ROOT, HERE = baseline.ROOT, baseline.HERE
IMAGE = 'local/booking-harness:milestone7-stage2'
LABEL = 'booking.harness.disposable-inbox'


def code_digest():
    paths = [ROOT / 'workflows/milestone7-stage2.json', ROOT / 'scripts/build-milestone7-stage2.js',
             ROOT / 'config/recovery.json', ROOT / 'config/operations.json', ROOT / 'src/n8n/Operations.node.js', ROOT / 'config/followups.json', ROOT / 'src/n8n/Outreach.node.js', ROOT / 'config/validation.json', ROOT / 'config/reservations.json',
             ROOT / 'src/n8n/Booking.node.js', ROOT / 'src/n8n/Inbox.node.js',
             ROOT / 'src/n8n/SecureWebhook.node.js', ROOT / 'src/inbox/sqlite.js',
             ROOT / 'src/action-authorization.js', ROOT / 'src/state-profile.js',
             ROOT / 'src/webhook-boundary.js'] + list((ROOT / 'src/booking').glob('*.js')) + list((ROOT / 'src/outreach').glob('*.js')) + list((ROOT / 'src/operations').glob('*.js')) + list((ROOT / 'src/recovery').glob('*.js'))
    paths += [HERE / name for name in ['run-milestone7-stage2.py','container-milestone7-stage2.js',
              'scenarios-milestone7-stage2.js','private-export.js','M4Mock.node.js','HarnessIngress.node.js','BookingProvider.js','warm-runner.js','container-milestone4.js','OutreachProvider.js','OutreachControl.node.js','RecoveryHarness.node.js']]
    paths += [HERE/name for name in ['scenarios-milestone6.js','scenarios-milestone7.js','container-milestone7.js']]
    paths += [ROOT/'workflows/milestone7.json',ROOT/'scripts/build-milestone7.js']
    digest = hashlib.sha256()
    for file in sorted(paths):
        digest.update(str(file.relative_to(ROOT)).encode() + b'\0' + file.read_bytes() + b'\0')
    return digest.hexdigest()


def verify_volume(volume, name, token):
    if volume.get('Name') != name or volume.get('Driver') != 'local' or volume.get('Options') or volume.get('Labels') != {LABEL: token}:
        raise RuntimeError('Unowned or unsafe test volume')


def verify_container(config, name):
    if config.get('HostConfig',{}).get('Init') is not True:
        raise RuntimeError('A verified init process is required to reap stopped worker descendants')
    mounts = config.get('Mounts', [])
    if len(mounts) != 1 or mounts[0].get('Type') != 'volume' or mounts[0].get('Name') != name or mounts[0].get('Destination') != '/inbox' or not mounts[0].get('RW'):
        raise RuntimeError('Only the owned inbox volume may be mounted')
    if config['Config']['Entrypoint'] != ['/usr/bin/node'] or config['Config']['Cmd'][:1] != ['/harness/container-milestone7-stage2.js']:
        raise RuntimeError('Unexpected M4 entrypoint')
    # All original security checks still apply; only these explicitly checked differences are allowed.
    checked = copy.deepcopy(config)
    checked['Mounts'] = []
    checked['Config']['Entrypoint'] = ['/usr/bin/node', '/harness/container.js']
    baseline.verify_config(checked)


def resources(minimum):
    if os.statvfs(ROOT).f_favail < minimum:
        raise RuntimeError('Insufficient free inodes; run builds/tests sequentially and preserve image archives')


def build():
    resources(400000)
    baseline.command(['node', str(ROOT / 'scripts/build-milestone7-stage2.js'), '--check'])
    baseline.command(['docker', 'image', 'inspect', baseline.BASE])
    with tempfile.TemporaryDirectory(prefix='booking-m7s2-build-') as tmp:
        context = Path(tmp)
        (context / 'harness/custom').mkdir(parents=True)
        for file in ['private-export.js','container.js','container-milestone7.js','scenarios-milestone7.js','container-milestone6.js','scenarios-milestone6.js','container-milestone7-stage2.js','scenarios.js','scenarios-milestone2.js','scenarios-milestone3.js','scenarios-milestone4.js','scenarios-milestone7-stage2.js','container-milestone4.js','container-milestone5.js','scenarios-milestone5.js','warm-runner.js']:
            shutil.copyfile(HERE / file, context / 'harness' / file)
        for file in ['Mock.node.js','M4Mock.node.js','HarnessIngress.node.js','OutreachControl.node.js','RecoveryHarness.node.js']:
            shutil.copyfile(HERE / file, context / 'harness/custom' / file)
        for file in ['Inbox.node.js','SecureWebhook.node.js','Booking.node.js','Outreach.node.js','Operations.node.js']:
            shutil.copyfile(ROOT / 'src/n8n' / file, context / 'harness/custom' / file)
        shutil.copytree(ROOT / 'src/inbox', context / 'harness/inbox')
        shutil.copytree(ROOT / 'src/booking', context / 'harness/booking')
        shutil.copytree(ROOT / 'src/outreach', context / 'harness/outreach')
        shutil.copytree(ROOT / 'src/operations', context / 'harness/operations')
        shutil.copytree(ROOT / 'src/recovery', context / 'harness/recovery')
        (context / 'config').mkdir()
        for name in ['recovery.json','reservations.json']:
            shutil.copyfile(ROOT/'config'/name,context/'config'/name)
        (context / 'tests/harness').mkdir(parents=True)
        shutil.copyfile(HERE / 'BookingProvider.js', context / 'tests/harness/BookingProvider.js')
        shutil.copyfile(HERE / 'OutreachProvider.js', context / 'harness/OutreachProvider.js')
        shutil.copyfile(ROOT / 'src/action-authorization.js', context / 'harness/action-authorization.js')
        shutil.copyfile(ROOT / 'src/state-profile.js', context / 'harness/state-profile.js')
        shutil.copyfile(HERE / 'BookingProvider.js', context / 'harness/BookingProvider.js')
        shutil.copyfile(ROOT / 'src/webhook-boundary.js', context / 'harness/webhook-boundary.js')
        (context / 'baseline').mkdir()
        files = {'baseline':ROOT / 'workflow.json', **{f'milestone{i}':ROOT / f'workflows/milestone{i}.json' for i in [2,3,4,5,6,7]}}
        files['milestone7-stage2']=ROOT/'workflows/milestone7-stage2.json'
        dockerfile = f'FROM {baseline.BASE}\n'
        for name, file in files.items():
            shutil.copyfile(file, context / 'baseline' / ('workflow.json' if name == 'baseline' else name+'.json'))
            dockerfile += f'LABEL booking.harness.{name}-sha={hashlib.sha256(file.read_bytes()).hexdigest()}\n'
        (context / 'inbox').mkdir()
        (context / 'inbox/.harness-marker').write_text('booking-inbox-disposable-v1')
        spec = importlib.util.spec_from_file_location('preserved_m5', HERE / 'run-milestone5.py')
        m5 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m5)
        dockerfile += 'LABEL booking.harness.milestone5-code-sha=' + m5.code_digest() + '\n'
        spec6 = importlib.util.spec_from_file_location('preserved_m6', HERE / 'run-milestone6.py')
        m6 = importlib.util.module_from_spec(spec6)
        spec6.loader.exec_module(m6)
        dockerfile += 'LABEL booking.harness.milestone6-code-sha=' + m6.code_digest() + '\n'
        spec7 = importlib.util.spec_from_file_location('preserved_m7', HERE / 'run-milestone7.py')
        m7 = importlib.util.module_from_spec(spec7)
        spec7.loader.exec_module(m7)
        dockerfile += 'LABEL booking.harness.milestone7-code-sha=' + m7.code_digest() + '\n'
        dockerfile += 'LABEL booking.harness.milestone7-stage2-code-sha=' + code_digest() + '\n'
        dockerfile += 'COPY --chown=1000:1000 --chmod=755 . /\nENTRYPOINT ["/usr/bin/node", "/harness/container.js"]\n'
        (context / 'Dockerfile').write_text(dockerfile)
        baseline.command(['docker','build','--network=none','--pull=false','-t',IMAGE,str(context)])
        for i in range(1,8):
            baseline.command(['docker','tag',IMAGE,f'local/booking-harness:milestone{i}'])
    print('Built', IMAGE, 'using local files only.')


def export(container, destination):
    # The in-container collector checks current authority/worker secrets and all
    # artifact paths atomically before serializing any bytes to the host.
    try:
        response = json.loads(baseline.command(['docker','exec',container,'/usr/bin/node','/harness/private-export.js']))
        if response.get('validated') is not True or not isinstance(response.get('files'), dict):
            raise ValueError('Unvalidated export')
        decoded = []
        total = 0
        for relative, encoded in response['files'].items():
            path = destination / relative
            if (not relative or Path(relative).is_absolute() or
                    Path(relative).parts[0] not in {'privacy.json','failure.json','evidence','completion.json','summary.json','isolation.json','transform-manifest.json'} or
                    not path.resolve().is_relative_to(destination.resolve()) or
                    not relative.endswith('.json') or re.search(r'CANARY|1555555|example\.test|source_key', relative)):
                raise ValueError('Unsafe artifact path')
            data = base64.b64decode(encoded, validate=True)
            total += len(data)
            if total > 128*1024*1024 or re.search(rb'CANARY|1555555|example\.test|source_key', data):
                raise ValueError('Unsafe artifact content')
            decoded.append((path, data))
    except (Exception, KeyboardInterrupt):
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'export-failure.json').write_text('{"error":"EXPORT_PRIVACY_FAILURE"}\n')
        raise RuntimeError('Artifact export blocked; sanitized diagnostic only') from None
    # Validate the whole response before writing even its first file.
    for path, data in decoded:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def run(scenario):
    resources(200000)
    baseline.initialize_results()
    token = uuid.uuid4().hex
    name = 'booking-m7s2-' + token
    destination = baseline.RESULTS / ('m7s2-' + token[:12])
    destination.mkdir()
    source = ROOT / 'workflows/milestone7-stage2.json'
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    code_sha = code_digest()
    image = json.loads(baseline.command(['docker','image','inspect',IMAGE]))[0]
    if image['Config']['Labels'].get('booking.harness.milestone7-stage2-sha') != digest:
        raise RuntimeError('Stale image: rebuild')
    if image['Config']['Labels'].get('booking.harness.milestone7-stage2-code-sha') != code_sha:
        raise RuntimeError('Stale booking/harness modules: rebuild')
    baseline.command(['docker','volume','create','--label',LABEL+'='+token,name])
    container = None
    try:
        verify_volume(json.loads(baseline.command(['docker','volume','inspect',name]))[0],name,token)
        container = baseline.command(['docker','create','--pull=never','--init','--network=none','--read-only',
            '--cap-drop=ALL','--security-opt=no-new-privileges','--user=1000:1000','--pids-limit=256','--memory=3g','--cpus=2',
            '--tmpfs=/data:rw,nosuid,nodev,size=768m,uid=1000,gid=1000,mode=0700',
            '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700',
            '--mount',f'type=volume,source={name},target=/inbox','--entrypoint=/usr/bin/node',
            IMAGE,'/harness/container-milestone7-stage2.js',scenario]).strip()
        config = json.loads(baseline.command(['docker','inspect',container]))[0]
        verify_container(config,name)
        (destination / 'docker-safety.json').write_text(json.dumps({'network':'none','init':True,'readOnly':True,'nonRoot':True,'noHostBinds':True,'noPorts':True,'volume':name,'volumeToken':token,'imageId':config['Image'],'sourceSha256':digest,'codeSha256':code_sha},indent=2))
        baseline.command(['docker','start',container])
        restarted = False
        deadline = time.monotonic()+2400
        while time.monotonic()<deadline:
            probe = subprocess.run(['docker','exec',container,'/usr/bin/node','-e','process.stdout.write(require("fs").readFileSync("/data/completion.json"))'],capture_output=True,text=True,timeout=10)
            if probe.returncode:
                state=json.loads(baseline.command(['docker','inspect',container]))[0]['State']
                if not state['Running']:
                    raise RuntimeError('Disposable harness stopped unexpectedly; no success can be verified')
                time.sleep(1);continue
            done = json.loads(probe.stdout)
            if done['exitCode']:
                export(container,destination)
                raise RuntimeError('Container test failure; inspect container.log and evidence')
            if done['restart']:
                if restarted:
                    time.sleep(1);continue
                export(container,destination / 'before-restart')
                baseline.command(['docker','exec',container,'/usr/bin/node','-e','require("fs").unlinkSync("/data/completion.json")'])
                verify_container(json.loads(baseline.command(['docker','inspect',container]))[0],name)
                verify_volume(json.loads(baseline.command(['docker','volume','inspect',name]))[0],name,token)
                baseline.command(['docker','restart',container])
                restarted = True
                continue
            if not restarted:
                raise RuntimeError('Missing container restart verification')
            export(container,destination)
            report = json.loads((destination/'summary.json').read_text())
            if code_digest()!=code_sha:
                raise RuntimeError('Booking/harness modules changed during execution')
            report['codeSha256']=code_sha
            (destination/'summary.json').write_text(json.dumps(report,indent=2))
            if report['sourceSha256'] != digest or hashlib.sha256(source.read_bytes()).hexdigest()!=digest:
                raise RuntimeError('Workflow hash mismatch')
            failures = [c for s in report['scenarios'] for c in s['checks'] if c['status']=='FAIL']
            for s in report['scenarios']:
                print(s['status'], s['scenario'])
                for c in s['checks']:
                    if c['status']=='FAIL': print('    FAIL',c['name'])
            print('Artifacts:',destination)
            return 1 if failures else 0
        raise RuntimeError('Test deadline exceeded')
    finally:
        if container:
            (destination/'container.log').write_text('Container logs withheld: raw runtime output is not an approved diagnostic artifact.\n')
            baseline.command(['docker','rm','-f',container])
        verify_volume(json.loads(baseline.command(['docker','volume','inspect',name]))[0],name,token)
        baseline.command(['docker','volume','rm',name])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['build','run'])
    parser.add_argument('scenario',nargs='?',default='all')
    args=parser.parse_args()
    try:
        sys.exit(build() or 0 if args.action=='build' else run(args.scenario))
    except (Exception,KeyboardInterrupt) as exc:
        print('ERROR (fail closed):',exc,file=sys.stderr)
        sys.exit(2)
