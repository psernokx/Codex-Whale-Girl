import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('job', Path(__file__).with_name('frame-rate-job.py'))
job = importlib.util.module_from_spec(spec)
spec.loader.exec_module(job)


class TimelineTests(unittest.TestCase):
    def test_loop_seam_and_fractional_interpolation(self):
        frames = job.timeline(241, 42, True, 60)
        self.assertEqual(len(frames), 608)
        self.assertEqual(frames[0], (0, 1, 0))
        self.assertGreater(frames[1][2], 0)
        self.assertEqual(frames[-1][:2], (240, 0))
        self.assertLess(len(frames) * 1000 / 60 - 241 * 42, 1000 / 60)

    def test_nonloop_holds_last_pose(self):
        frames = job.timeline(49, 42, False, 60)
        self.assertEqual(frames[-1], (48, 48, 0))
        self.assertTrue(all(a <= b for a, b, _ in frames))

    def test_static_is_not_duplicated(self):
        self.assertEqual(job.timeline(1, 42, True, 60), [(0, 0, 0)])

    def test_30fps_plan_keeps_duration(self):
        frames = job.timeline(96, 42, False, 30)
        self.assertLess(abs(len(frames) * 1000 / 30 - 96 * 42), 1000 / 30)
        self.assertTrue(all(0 <= t < 1 for _, _, t in frames))


if __name__ == '__main__':
    unittest.main()
