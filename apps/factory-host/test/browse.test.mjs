import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BROWSE_MAX_ENTRIES, browseDirectory, BrowseError } from "../dist/workspace/browse.js";

function tree(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-browse-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["alpha", "beta/inner", ".hidden", "repo/.git"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "file.txt"), "x");
  return root;
}
const code = (fn) => { try { fn(); } catch (error) { return error instanceof BrowseError ? error.code : "other"; } return "none"; };

test("browse lists only visible sub-directories, flags git repositories and sorts by name", (t) => {
  const root = tree(t); const result = browseDirectory([root]);
  assert.equal(result.path, root); assert.equal(result.parent, null); assert.equal(result.truncated, false);
  assert.deepEqual(result.entries, [{ name: "alpha", isGit: false }, { name: "beta", isGit: false }, { name: "repo", isGit: true }]);
});
test("browse defaults to the first root and navigates down with a parent link", (t) => {
  const root = tree(t); const down = browseDirectory([root], join(root, "beta"));
  assert.deepEqual(down.entries, [{ name: "inner", isGit: false }]); assert.equal(down.parent, root);
  assert.equal(browseDirectory([root], root).parent, null);
});
test("browse refuses paths outside the roots, traversal, relative and odd paths", (t) => {
  const root = tree(t); const other = realpathSync(tmpdir());
  assert.equal(code(() => browseDirectory([root], other)), "outside-roots");
  assert.equal(code(() => browseDirectory([root], `${root}/beta/../..`)), "invalid-path");
  assert.equal(code(() => browseDirectory([root], "relative/path")), "invalid-path");
  if (process.platform !== "win32") assert.equal(code(() => browseDirectory([root], `${root}\\beta`)), "invalid-path");
  assert.equal(code(() => browseDirectory([root], `${root}/nope`)), "not-found");
  assert.equal(code(() => browseDirectory([root], join(root, "file.txt"))), "not-directory");
  assert.equal(code(() => browseDirectory([join(root, "missing")])), "outside-roots");
});
test("browse does not follow a symbolic link out of the root", (t) => {
  const root = tree(t); const outside = realpathSync(mkdtempSync(join(tmpdir(), "factory-browse-out-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  try { symlinkSync(outside, join(root, "link"), "dir"); } catch { t.skip("symlinks unavailable"); return; }
  assert.equal(browseDirectory([root]).entries.some((entry) => entry.name === "link"), false);
  assert.equal(code(() => browseDirectory([root], join(root, "link"))), "outside-roots");
});
test("browse truncates very large directories", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-browse-many-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < BROWSE_MAX_ENTRIES + 5; i++) mkdirSync(join(root, `d${String(i).padStart(4, "0")}`));
  const result = browseDirectory([root]); assert.equal(result.entries.length, BROWSE_MAX_ENTRIES); assert.equal(result.truncated, true);
});
test("default browse root is the Host user's home", () => {
  const home = realpathSync(homedir()); assert.equal(browseDirectory([home]).path, home);
});
