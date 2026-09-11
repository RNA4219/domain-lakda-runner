import io
import unittest
from run_tests import EvidenceResult, result_counts


class EvidenceTests(unittest.TestCase):
    def run_fixture(self, case):
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(case)
        return unittest.TextTestRunner(stream=io.StringIO(), resultclass=EvidenceResult).run(suite)

    def test_multiple_failed_subtests_count_as_one_failed_case(self):
        class Fixture(unittest.TestCase):
            def test_steps(self):
                for value in (1, 2):
                    with self.subTest(value=value):
                        self.fail("fixture failure")
        result = self.run_fixture(Fixture)
        self.assertFalse(result.wasSuccessful())
        self.assertEqual(result_counts(result), dict(tests=1, failures=1, errors=0, skipped=0))

    def test_error_subtest_is_an_error_even_if_an_assertion_fails_later(self):
        class Fixture(unittest.TestCase):
            def test_steps(self):
                with self.subTest(value=1):
                    raise RuntimeError("fixture error")
                with self.subTest(value=2):
                    self.fail("fixture assertion")
        result = self.run_fixture(Fixture)
        self.assertEqual(result_counts(result), dict(tests=1, failures=0, errors=1, skipped=0))

    def test_no_tests_and_all_skipped_do_not_create_passed_cases(self):
        class Fixture(unittest.TestCase):
            @unittest.skip("fixture skip")
            def test_skipped(self):
                pass
        self.assertEqual(result_counts(self.run_fixture(Fixture)), dict(tests=1, failures=0, errors=0, skipped=1))
        self.assertEqual(result_counts(self.run_fixture(unittest.TestCase)), dict(tests=0, failures=0, errors=0, skipped=0))
