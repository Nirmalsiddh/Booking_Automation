import copy
import importlib.util
from pathlib import Path
import unittest
from test_guards import safe_config
spec=importlib.util.spec_from_file_location('m5',Path(__file__).with_name('run-milestone5.py'))
m5=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m5)
class M5Guards(unittest.TestCase):
    def test_only_exact_owned_volume_accepted(self):
        v={'Name':'owned','Driver':'local','Options':None,'Labels':{m5.LABEL:'token'}}
        m5.verify_volume(v,'owned','token')
        for field,value in [('Name','other'),('Driver','nfs'),('Options',{'device':'/production'}),('Labels',{})]:
            changed={**v,field:value}
            with self.assertRaises(RuntimeError):m5.verify_volume(changed,'owned','token')
    def test_isolation_and_mount_safety(self):
        c=safe_config();c['Config']['Entrypoint']=['/usr/bin/node'];c['Config']['Cmd']=['/harness/container-milestone5.js','all']
        c['Mounts']=[{'Type':'volume','Name':'owned','Destination':'/inbox','RW':True}]
        m5.verify_container(c,'owned')
        for changes in [{'Type':'bind'},{'Name':'other'},{'Destination':'/data'},{'RW':False}]:
            bad=copy.deepcopy(c);bad['Mounts'][0].update(changes)
            with self.assertRaises(RuntimeError):m5.verify_container(bad,'owned')
        bad=copy.deepcopy(c);bad['HostConfig']['NetworkMode']='bridge'
        with self.assertRaises(RuntimeError):m5.verify_container(bad,'owned')
        bad=copy.deepcopy(c);bad['Mounts'].append(c['Mounts'][0])
        with self.assertRaises(RuntimeError):m5.verify_container(bad,'owned')
