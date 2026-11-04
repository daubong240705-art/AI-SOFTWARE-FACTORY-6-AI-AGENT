import assert from "node:assert/strict";
import test from "node:test";
import { roles } from "../shared/defaults";
import {
  clampOfficePan,
  officeSeats,
  officeZoom,
} from "../src/features/office/layout";

test("office has exactly one seat per role with room for furniture and clear aisles", () => {
  assert.deepEqual(
    [...officeSeats.map((seat) => seat.role)].sort(),
    [...roles].sort(),
  );
  for (const seat of officeSeats) {
    assert.ok(Math.abs(seat.x) + 1.65 < 7.3);
    assert.ok(Math.abs(seat.z) + 1.65 < 6.6);
    for (const other of officeSeats.filter((item) => item.role !== seat.role))
      assert.ok(Math.hypot(seat.x - other.x, seat.z - other.z) >= 3.8);
  }
});
test("camera fits narrow and short viewports and clamps zoom and pan", () => {
  assert.ok(officeZoom(600, 700) < officeZoom(1200, 700));
  assert.ok(officeZoom(1200, 300) < officeZoom(1200, 700));
  assert.equal(officeZoom(1200, 700, 100), officeZoom(1200, 700, 2.4));
  assert.equal(officeZoom(1200, 700, 0), officeZoom(1200, 700, 0.7));
  assert.ok(officeZoom(0, 0) > 0);
  assert.equal(clampOfficePan(20), 3);
  assert.equal(clampOfficePan(-20), -3);
  assert.equal(clampOfficePan(1), 1);
});
