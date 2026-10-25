import copy
import importlib.util
from pathlib import Path
import unittest
from test_guards import safe_config
spec=importlib.util.spec_from_file_location('m6',Path(__file__).with_name('run-milestone6.py'))
m6=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m6)
class M6Guards(unittest.TestCase):
    def test_only_exact_owned_volume_accepted(self):
        v={'Name':'owned','Driver':'local','Options':None,'Labels':{m6.LABEL:'token'}}
        m6.verify_volume(v,'owned','token')
        for field,value in [('Name','other'),('Driver','nfs'),('Options',{'device':'/production'}),('Labels',{})]:
            changed={**v,field:value}
            with self.assertRaises(RuntimeError):m6.verify_volume(changed,'owned','token')
    def test_isolation_and_mount_safety(self):
        c=safe_config();c['Config']['Entrypoint']=['/usr/bin/node'];c['Config']['Cmd']=['/harness/container-milestone6.js','all']
        c['Mounts']=[{'Type':'volume','Name':'owned','Destination':'/inbox','RW':True}]
        m6.verify_container(c,'owned')
        for changes in [{'Type':'bind'},{'Name':'other'},{'Destination':'/data'},{'RW':False}]:
            bad=copy.deepcopy(c);bad['Mounts'][0].update(changes)
            with self.assertRaises(RuntimeError):m6.verify_container(bad,'owned')
        bad=copy.deepcopy(c);bad['HostConfig']['NetworkMode']='bridge'
        with self.assertRaises(RuntimeError):m6.verify_container(bad,'owned')
        bad=copy.deepcopy(c);bad['Mounts'].append(c['Mounts'][0])
        with self.assertRaises(RuntimeError):m6.verify_container(bad,'owned')
    def test_insufficient_inodes_fail_closed(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        with patch.object(m6.os, 'statvfs', return_value=SimpleNamespace(f_favail=0)):
            with self.assertRaisesRegex(RuntimeError, 'inodes'):
                m6.resources(200000)
