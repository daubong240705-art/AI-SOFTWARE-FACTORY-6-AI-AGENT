import assert from "node:assert/strict";
import test from "node:test";
import { roles } from "../shared/defaults";
import {
  clampOfficePan,
  officeSeats,
  officeZoom,
  placeOfficeLabels,
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
test("readable labels separate overlapping projections and stay inside a short scene", () => {
  const input = officeSeats.map(({ role }, i) => ({
    role,
    x: 200 + (i % 3) * 40,
    y: 40 + Math.floor(i / 3) * 45,
    visible: true,
    width: 120,
    height: 44,
  }));
  const placed = placeOfficeLabels(input, 500, 400);
  assert.equal(placed.length, 7);
  assert.ok(
    placed.every(
      (p) =>
        p.visible &&
        p.x - p.width / 2 >= 4 &&
        p.x + p.width / 2 <= 496 &&
        p.y - p.height >= 4 &&
        p.y <= 396,
    ),
  );
  for (const a of placed)
    for (const b of placed)
      if (a.role !== b.role)
        assert.ok(
          a.x + a.width / 2 <= b.x - b.width / 2 ||
            a.x - a.width / 2 >= b.x + b.width / 2 ||
            a.y <= b.y - b.height ||
            a.y - a.height >= b.y,
        );
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
