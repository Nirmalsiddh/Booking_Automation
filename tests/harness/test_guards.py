"""Safety guard regression tests; Docker and n8n are not executed here."""
import copy
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import run as harness


def safe_config():
    return {'HostConfig': {'NetworkMode': 'none', 'ReadonlyRootfs': True,
        'CapDrop': ['ALL'], 'SecurityOpt': ['no-new-privileges'], 'Privileged': False,
        'Binds': None, 'PortBindings': {}, 'Tmpfs': {'/data': '', '/tmp': ''}},
        'Config': {'User': '1000:1000', 'Env': ['PATH=/usr/bin'],
                   'Entrypoint': ['/usr/bin/node', '/harness/container.js']}, 'Mounts': []}


class Guards(unittest.TestCase):
    def test_safe_container_accepted(self):
        harness.verify_config(safe_config())

    def test_unsafe_container_rejected(self):
        mutations = [
            ('HostConfig', 'NetworkMode', 'bridge'),
            ('HostConfig', 'ReadonlyRootfs', False),
            ('HostConfig', 'CapDrop', []),
            ('HostConfig', 'SecurityOpt', []),
            ('HostConfig', 'Privileged', True),
            ('HostConfig', 'CapAdd', ['NET_ADMIN']),
            ('HostConfig', 'Devices', [{'PathOnHost': '/dev/sda'}]),
            ('HostConfig', 'PidMode', 'host'),
            ('HostConfig', 'IpcMode', 'host'),
            ('HostConfig', 'Binds', ['/var/run/docker.sock:/socket']),
            ('HostConfig', 'PortBindings', {'5678/tcp': [{}]}),
            ('HostConfig', 'Tmpfs', {'/data': ''}),
            ('Config', 'User', 'root'),
            ('Config', 'Env', ['GEMINI_API_KEY=synthetic-never-use']),
            ('Config', 'Entrypoint', ['/bin/sh']),
        ]
        for section, key, value in mutations:
            with self.subTest(key=key):
                config = copy.deepcopy(safe_config())
                config[section][key] = value
                with self.assertRaises(RuntimeError):
                    harness.verify_config(config)
        config = safe_config()
        config['Mounts'] = [{'Type': 'bind'}]
        with self.assertRaises(RuntimeError):
            harness.verify_config(config)

    def test_results_require_marker(self):
        original = harness.RESULTS
        try:
            with tempfile.TemporaryDirectory() as tmp:
                harness.RESULTS = Path(tmp) / 'unknown'
                harness.RESULTS.mkdir()
                (harness.RESULTS / 'user-file').write_text('preserve')
                with self.assertRaises(RuntimeError):
                    harness.initialize_results()
                self.assertEqual((harness.RESULTS / 'user-file').read_text(), 'preserve')
            with tempfile.TemporaryDirectory() as tmp:
                harness.RESULTS = Path(tmp) / 'new'
                harness.initialize_results()
                harness.initialize_results()
                self.assertEqual((harness.RESULTS / '.harness-marker').read_text(), harness.MARKER)
        finally:
            harness.RESULTS = original

    def test_symlink_results_rejected(self):
        original = harness.RESULTS
        try:
            with tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / 'user-data'
                target.mkdir()
                harness.RESULTS = Path(tmp) / 'link'
                harness.RESULTS.symlink_to(target)
                with self.assertRaises(RuntimeError):
                    harness.initialize_results()
                self.assertTrue(target.exists())
        finally:
            harness.RESULTS = original

    def test_reset_removes_only_marked_disposable_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            results = Path(tmp) / 'results'
            unrelated = Path(tmp) / 'user-data'
            unrelated.write_text('preserve')
            with patch.object(harness, 'RESULTS', results):
                harness.initialize_results()
                (results / 'disposable.json').write_text('{}')
                with patch('sys.argv', ['run.py', 'reset']):
                    self.assertEqual(harness.main(), 0)
            self.assertFalse(results.exists())
            self.assertEqual(unrelated.read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
