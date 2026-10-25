#!/usr/bin/env python3
"""Owned-volume, network-isolated Milestone 4 runner; never pulls images."""
import argparse
import base64
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import run as baseline

ROOT, HERE = baseline.ROOT, baseline.HERE
IMAGE = 'local/booking-harness:milestone4'
LABEL = 'booking.harness.disposable-inbox'


def verify_volume(volume, name, token):
    if volume.get('Name') != name or volume.get('Driver') != 'local' or volume.get('Options') or volume.get('Labels') != {LABEL: token}:
        raise RuntimeError('Unowned or unsafe test volume')


def verify_container(config, name):
    mounts = config.get('Mounts', [])
    if len(mounts) != 1 or mounts[0].get('Type') != 'volume' or mounts[0].get('Name') != name or mounts[0].get('Destination') != '/inbox' or not mounts[0].get('RW'):
        raise RuntimeError('Only the owned inbox volume may be mounted')
    if config['Config']['Entrypoint'] != ['/usr/bin/node'] or config['Config']['Cmd'][:1] != ['/harness/container-milestone4.js']:
        raise RuntimeError('Unexpected M4 entrypoint')
    # All original security checks still apply; only these explicitly checked differences are allowed.
    checked = copy.deepcopy(config)
    checked['Mounts'] = []
    checked['Config']['Entrypoint'] = ['/usr/bin/node', '/harness/container.js']
    baseline.verify_config(checked)


def build():
    baseline.command(['docker', 'image', 'inspect', baseline.BASE])
    with tempfile.TemporaryDirectory(prefix='booking-m4-build-') as tmp:
        context = Path(tmp)
        (context / 'harness/custom').mkdir(parents=True)
        for file in ['container.js','container-milestone4.js','scenarios.js','scenarios-milestone2.js','scenarios-milestone3.js','scenarios-milestone4.js','warm-runner.js']:
            shutil.copyfile(HERE / file, context / 'harness' / file)
        for file in ['Mock.node.js','M4Mock.node.js','HarnessIngress.node.js']:
            shutil.copyfile(HERE / file, context / 'harness/custom' / file)
        for file in ['Inbox.node.js','SecureWebhook.node.js']:
            shutil.copyfile(ROOT / 'src/n8n' / file, context / 'harness/custom' / file)
        shutil.copytree(ROOT / 'src/inbox', context / 'harness/inbox')
        shutil.copyfile(ROOT / 'src/webhook-boundary.js', context / 'harness/webhook-boundary.js')
        (context / 'baseline').mkdir()
        files = {'baseline':ROOT / 'workflow.json', **{f'milestone{i}':ROOT / f'workflows/milestone{i}.json' for i in [2,3,4]}}
        dockerfile = f'FROM {baseline.BASE}\n'
        for name, file in files.items():
            shutil.copyfile(file, context / 'baseline' / ('workflow.json' if name == 'baseline' else name+'.json'))
            dockerfile += f'LABEL booking.harness.{name}-sha={hashlib.sha256(file.read_bytes()).hexdigest()}\n'
        (context / 'inbox').mkdir()
        (context / 'inbox/.harness-marker').write_text('booking-inbox-disposable-v1')
        dockerfile += 'COPY --chown=1000:1000 --chmod=755 . /\nENTRYPOINT ["/usr/bin/node", "/harness/container.js"]\n'
        (context / 'Dockerfile').write_text(dockerfile)
        baseline.command(['docker','build','--network=none','--pull=false','-t',IMAGE,str(context)])
    print('Built', IMAGE, 'using local files only.')


def export(container, destination):
    script = r'''
const fs=require('fs'),path=require('path'),out={};let total=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 if(dir==='/data'&&(entry.name.startsWith('n8n-')||entry.name.startsWith('state-')||entry.name.startsWith('request-')))continue;
 const file=path.join(dir,entry.name);
 if(entry.isDirectory())walk(file);else if(entry.isFile()){
  const data=fs.readFileSync(file);total+=data.length;if(total>128*1024*1024)throw Error('Artifact limit');
  out[path.relative('/data',file)]=data.toString('base64');
 }else throw Error('Unsafe artifact');
}}walk('/data');process.stdout.write(JSON.stringify(out));'''
    files = json.loads(baseline.command(['docker','exec',container,'/usr/bin/node','-e',script]))
    for relative, encoded in files.items():
        path = destination / relative
        if not path.resolve().is_relative_to(destination.resolve()):
            raise RuntimeError('Unsafe artifact path')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(encoded, validate=True))


def run(scenario):
    baseline.initialize_results()
    token = uuid.uuid4().hex
    name = 'booking-m4-' + token
    destination = baseline.RESULTS / ('m4-' + token[:12])
    destination.mkdir()
    source = ROOT / 'workflows/milestone4.json'
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    image = json.loads(baseline.command(['docker','image','inspect',IMAGE]))[0]
    if image['Config']['Labels'].get('booking.harness.milestone4-sha') != digest:
        raise RuntimeError('Stale image: rebuild')
    baseline.command(['docker','volume','create','--label',LABEL+'='+token,name])
    container = None
    try:
        verify_volume(json.loads(baseline.command(['docker','volume','inspect',name]))[0],name,token)
        container = baseline.command(['docker','create','--pull=never','--network=none','--read-only',
            '--cap-drop=ALL','--security-opt=no-new-privileges','--user=1000:1000','--pids-limit=256','--memory=3g','--cpus=2',
            '--tmpfs=/data:rw,nosuid,nodev,size=768m,uid=1000,gid=1000,mode=0700',
            '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700',
            '--mount',f'type=volume,source={name},target=/inbox','--entrypoint=/usr/bin/node',
            IMAGE,'/harness/container-milestone4.js',scenario]).strip()
        config = json.loads(baseline.command(['docker','inspect',container]))[0]
        verify_container(config,name)
        (destination / 'docker-safety.json').write_text(json.dumps({'network':'none','readOnly':True,'nonRoot':True,'noHostBinds':True,'noPorts':True,'volume':name,'volumeToken':token,'imageId':config['Image'],'sourceSha256':digest},indent=2))
        baseline.command(['docker','start',container])
        restarted = False
        deadline = time.monotonic()+1500
        while time.monotonic()<deadline:
            probe = subprocess.run(['docker','exec',container,'/usr/bin/node','-e','process.stdout.write(require("fs").readFileSync("/data/completion.json"))'],capture_output=True,text=True,timeout=10)
            if probe.returncode:
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
            logs = subprocess.run(['docker','logs',container],capture_output=True,text=True)
            (destination/'container.log').write_text(logs.stdout+'\n'+logs.stderr)
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
