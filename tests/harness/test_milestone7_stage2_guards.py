import copy
import importlib.util
from pathlib import Path
import unittest
from test_guards import safe_config
spec=importlib.util.spec_from_file_location('m7',Path(__file__).with_name('run-milestone7-stage2.py'))
m7=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m7)
class M7Guards(unittest.TestCase):
    def test_only_exact_owned_volume_accepted(self):
        v={'Name':'owned','Driver':'local','Options':None,'Labels':{m7.LABEL:'token'}}
        m7.verify_volume(v,'owned','token')
        for field,value in [('Name','other'),('Driver','nfs'),('Options',{'device':'/production'}),('Labels',{})]:
            changed={**v,field:value}
            with self.assertRaises(RuntimeError):m7.verify_volume(changed,'owned','token')
    def test_isolation_and_mount_safety(self):
        c=safe_config();c['HostConfig']['Init']=True;c['Config']['Entrypoint']=['/usr/bin/node'];c['Config']['Cmd']=['/harness/container-milestone7-stage2.js','all']
        c['Mounts']=[{'Type':'volume','Name':'owned','Destination':'/inbox','RW':True}]
        m7.verify_container(c,'owned')
        noinit=copy.deepcopy(c);noinit['HostConfig']['Init']=False
        with self.assertRaises(RuntimeError):m7.verify_container(noinit,'owned')
        for changes in [{'Type':'bind'},{'Name':'other'},{'Destination':'/data'},{'RW':False}]:
            bad=copy.deepcopy(c);bad['Mounts'][0].update(changes)
            with self.assertRaises(RuntimeError):m7.verify_container(bad,'owned')
        bad=copy.deepcopy(c);bad['HostConfig']['NetworkMode']='bridge'
        with self.assertRaises(RuntimeError):m7.verify_container(bad,'owned')
        bad=copy.deepcopy(c);bad['Mounts'].append(c['Mounts'][0])
        with self.assertRaises(RuntimeError):m7.verify_container(bad,'owned')
    def test_insufficient_inodes_fail_closed(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        with patch.object(m7.os, 'statvfs', return_value=SimpleNamespace(f_favail=0)):
            with self.assertRaisesRegex(RuntimeError, 'inodes'):
                m7.resources(200000)

class M7ExportPrivacy(unittest.TestCase):
    """Invoke the actual container collector against disposable synthetic trees."""
    def test_every_exit_path_is_scanned_before_any_bytes_leave(self):
        import tempfile, json, subprocess
        from unittest.mock import patch
        collector=Path(__file__).with_name('private-export.js').resolve()
        for phase in ['success','failure','interrupted','before-restart','after-restart']:
            for marker in ['CANARY_PRIVATE','15555550101','synthetic@example.test','source_key','synthetic-authority-secret','synthetic-worker-secret']:
                with self.subTest(phase=phase, marker_type=marker.split('-')[0]), tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp); data=root/'data'; inbox=root/'inbox'; dest=root/'host'
                    (data/'evidence').mkdir(parents=True);inbox.mkdir()
                    (inbox/'.recovery-authority.json').write_text(json.dumps({'token':'synthetic-authority-secret'}))
                    # Populate a real worker secret table so dynamic-secret checks run.
                    import sqlite3
                    with sqlite3.connect(inbox/'booking-synthetic.sqlite') as db:
                        db.execute('CREATE TABLE ops_recovery_workers(secret TEXT)')
                        db.execute('INSERT INTO ops_recovery_workers VALUES(?)',('synthetic-worker-secret',))
                    (data/'evidence'/'safe.json').write_text('{"status":"failed"}')
                    target=data/('failure.json' if phase=='failure' else 'completion.json' if phase=='interrupted' else 'evidence/private.json')
                    target.write_text(json.dumps({'detail':marker}))
                    script='process.stdout.write(JSON.stringify(require(process.argv[1]).envelope(process.argv[2],process.argv[3])))'
                    result=subprocess.run(['node','-e',script,str(collector),str(data),str(inbox)],capture_output=True,text=True,check=True)
                    self.assertNotIn(marker,result.stdout)
                    self.assertFalse(json.loads(result.stdout)['validated'])
                    with patch.object(m7.baseline,'command',return_value=result.stdout):
                        with self.assertRaisesRegex(RuntimeError,'sanitized diagnostic only'):m7.export('synthetic-container',dest)
                    self.assertEqual([p.name for p in dest.iterdir()],['export-failure.json'])
                    self.assertEqual(json.loads((dest/'export-failure.json').read_text()),{'error':'EXPORT_PRIVACY_FAILURE'})

    def test_safe_failure_and_restart_diagnostics_are_preserved(self):
        import tempfile, json, subprocess
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); data=root/'data';inbox=root/'inbox';dest=root/'host'
            data.mkdir();inbox.mkdir();(inbox/'.recovery-authority.json').write_text('{"token":"synthetic-authority"}')
            (data/'failure.json').write_text('{"error":"M7_HARNESS_FAILED"}')
            (data/'completion.json').write_text('{"exitCode":2,"restart":false}')
            script='process.stdout.write(JSON.stringify(require(process.argv[1]).envelope(process.argv[2],process.argv[3])))'
            result=subprocess.run(['node','-e',script,str(Path(__file__).with_name('private-export.js').resolve()),str(data),str(inbox)],capture_output=True,text=True,check=True)
            with patch.object(m7.baseline,'command',return_value=result.stdout):m7.export('synthetic-container',dest)
            self.assertEqual((dest/'failure.json').read_bytes(),(data/'failure.json').read_bytes())
            # Validate the entire response before writing an otherwise safe first file.
            import base64
            envelope={'validated':True,'files':{'failure.json':base64.b64encode(b'{}').decode(),'evidence/private.json':base64.b64encode(b'CANARY_PRIVATE').decode()}}
            blocked=root/'blocked'
            with patch.object(m7.baseline,'command',return_value=json.dumps(envelope)):
                with self.assertRaises(RuntimeError):m7.export('synthetic-container',blocked)
            self.assertFalse((blocked/'failure.json').exists())

    def test_actual_runner_routes_all_exit_paths_through_safe_export(self):
        import tempfile,json,hashlib,subprocess
        from unittest.mock import patch
        from contextlib import ExitStack
        real_run=subprocess.run
        collector=Path(__file__).with_name('private-export.js').resolve()
        for phase in ['success','failure','interrupted','before-restart','after-restart']:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); data=root/'data';inbox=root/'inbox';results=root/'results'
                (data/'evidence').mkdir(parents=True);inbox.mkdir();results.mkdir()
                (inbox/'.recovery-authority.json').write_text('{"token":"synthetic-secret"}')
                exports=[];probes=[]
                def command(args):
                    if args[:3]==['docker','image','inspect']:
                        digest=hashlib.sha256((m7.ROOT/'workflows/milestone7-stage2.json').read_bytes()).hexdigest()
                        return json.dumps([{'Config':{'Labels':{'booking.harness.milestone7-stage2-sha':digest,'booking.harness.milestone7-stage2-code-sha':'synthetic-digest'}}}])
                    if args[:2]==['docker','create']:return 'synthetic-container'
                    if args[:2]==['docker','inspect']:return json.dumps([{'Image':'synthetic-image','State':{'Running':False}}])
                    if args[:2]==['docker','exec'] and args[-1]=='/harness/private-export.js':
                        exports.append(1)
                        # The first restart export is clean only for after-restart.
                        if phase!='after-restart' or len(exports)>1:(data/'evidence/private.json').write_text('{"detail":"CANARY_PRIVATE"}')
                        return real_run(['node','-e','process.stdout.write(JSON.stringify(require(process.argv[1]).envelope(process.argv[2],process.argv[3])))',str(collector),str(data),str(inbox)],capture_output=True,text=True,check=True).stdout
                    if args[:3]==['docker','volume','inspect']:return '[{}]'
                    return ''
                def probe(*args,**kwargs):
                    probes.append(1)
                    if phase=='interrupted':return subprocess.CompletedProcess(args,1,'','')
                    done={'exitCode':2 if phase=='failure' else 0,'restart':phase in ['success','before-restart','after-restart'] and len(probes)==1}
                    return subprocess.CompletedProcess(args,0,json.dumps(done),'')
                with ExitStack() as stack:
                    for owner,name,value in [(m7,'resources',lambda *_:None),(m7.baseline,'initialize_results',lambda:None),(m7,'verify_container',lambda *_:None),(m7,'verify_volume',lambda *_:None),(m7,'code_digest',lambda:'synthetic-digest'),(m7.baseline,'RESULTS',results),(m7.baseline,'command',command),(m7.subprocess,'run',probe)]:stack.enter_context(patch.object(owner,name,value))
                    with self.assertRaises(RuntimeError):m7.run('all')
                contents=b''.join(p.read_bytes() for p in results.rglob('*') if p.is_file())
                self.assertNotIn(b'CANARY_PRIVATE',contents)
                if phase!='interrupted':self.assertIn(b'EXPORT_PRIVACY_FAILURE',contents)
                self.assertEqual(len(exports),0 if phase=='interrupted' else 2 if phase=='after-restart' else 1)
