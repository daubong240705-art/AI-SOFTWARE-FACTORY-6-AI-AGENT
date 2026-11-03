# Synthetic validation fixture

These files mirror trusted GitLab project 10 main commit `80e925827d3c91318d6e32c470cf09f7150a86a0` installed through infrastructure MR !2. They are infrastructure smoke assets, not a product template. The generated source is limited to `src/`; the tests, CI and package script are operator-owned.

`ci/package.py` emits a canonical source mapping and manifest tied to project, candidate SHA and pipeline. The root-owned deploy policy stores SHA256 of `.gitlab-ci.yml` and `ci/package.py` as read from GitLab, independently of CI environment variables. Changing these trusted files requires an operator policy update after review. Never use a personal/admin token in this fixture.

The manual job receives file-type SSH variables scoped to `validation_staging`. Its key is restricted to source VM60 and one forced command on VM14. The host asks ASF for a persisted release approval before deploying, so pressing the GitLab manual job alone is insufficient.
