import unittest
from app import add
from ui import label
class Acceptance(unittest.TestCase):
    def test_positive(self): self.assertEqual(add(2,3),5)
    def test_negative(self): self.assertEqual(add(-2,-3),-5)
    def test_mixed(self): self.assertEqual(add(-2,3),1)
    def test_label(self): self.assertEqual(label(5),"Result: 5")
    def test_empty_label(self): self.assertEqual(label(""),"Result: ")
