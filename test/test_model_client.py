"""Linux CPU mocks only: no real HTTP/inference calls."""
import fcntl, importlib.util, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('client',Path(__file__).resolve().parents[1]/'model_client.py')
client=importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class LeaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.parent=Path(self.temp.name);os.chmod(self.parent,0o700)
        self.lock=self.parent/'inference.lock';self.marker=Path(str(self.lock)+'.blocked')
        self.patches=[patch.object(client,'LOCK',self.lock),patch.object(client,'BLOCKED',self.marker),patch.object(client,'HELD',[])]
        [p.start() for p in self.patches]
    def tearDown(self):
        for lease in client.HELD:lease.close()
        [p.stop() for p in reversed(self.patches)];self.temp.cleanup()
    def test_shared_busy_makes_no_http_call(self):
        with self.lock.open('w') as lease:
            os.chmod(self.lock,0o600);fcntl.flock(lease.fileno(),fcntl.LOCK_EX)
            with patch.object(client.urllib.request,'urlopen') as http:
                with self.assertRaisesRegex(RuntimeError,'inference_busy'):client.call({})
                http.assert_not_called()
    def test_blocked_marker_makes_no_http_call(self):
        self.marker.write_text('completion unverified')
        with patch.object(client.urllib.request,'urlopen') as http:
            with self.assertRaisesRegex(RuntimeError,'inference_blocked'):client.call({})
            http.assert_not_called()
    def test_timeout_persists_shared_marker(self):
        with patch.object(client.urllib.request,'urlopen',side_effect=TimeoutError):
            with self.assertRaisesRegex(RuntimeError,'model_timeout'):client.call({})
        self.assertTrue(self.marker.exists());self.assertEqual(os.stat(self.marker).st_mode&0o777,0o600)
    def test_failed_marker_retains_real_flock(self):
        real_open=os.open
        def unsafe_marker(path,*args,**kwargs):
            if path==self.marker.name:raise OSError('simulated ENOSPC')
            return real_open(path,*args,**kwargs)
        with patch.object(client.urllib.request,'urlopen',side_effect=TimeoutError),patch.object(client.os,'open',side_effect=unsafe_marker):
            with self.assertRaisesRegex(RuntimeError,'model_timeout'):client.call({})
        self.assertEqual(len(client.HELD),1)
        with self.lock.open('a') as other:
            with self.assertRaises(BlockingIOError):fcntl.flock(other.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    def test_symlink_lock_is_rejected(self):
        target=self.parent/'other';target.write_text('');self.lock.symlink_to(target)
        with patch.object(client.urllib.request,'urlopen') as http:
            with self.assertRaises(OSError):client.call({})
            http.assert_not_called()
    def test_artifact_failure_cannot_skip_outer_retention(self):
        class StopHolding(BaseException):pass
        client.HELD.append(object())
        try:
            with patch.object(client,'main',side_effect=OSError('artifact disk full')),patch.object(client.time,'sleep',side_effect=StopHolding) as holding:
                with self.assertRaises(StopHolding):client.run()
                holding.assert_called_once_with(30)
        finally:client.HELD.clear()


if __name__=='__main__':unittest.main()
