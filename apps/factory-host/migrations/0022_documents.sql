ALTER TABLE artifact_versions ADD COLUMN origin TEXT NOT NULL DEFAULT 'agent'
  CHECK (origin IN ('agent','upload'));
ALTER TABLE artifact_versions ADD COLUMN file_name TEXT CHECK (file_name IS NULL OR length(file_name) <= 200);
