ALTER TABLE document_chunks ADD COLUMN sensitivity_label TEXT NOT NULL DEFAULT 'Standard' CHECK (sensitivity_label IN ('Standard', 'Confidential'));
ALTER TABLE document_chunks ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0;
