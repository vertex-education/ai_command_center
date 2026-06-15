ALTER TABLE risks ADD COLUMN title TEXT NOT NULL DEFAULT 'Untitled risk';

UPDATE risks
SET title = substr(trim(description), 1, 140)
WHERE title = 'Untitled risk'
  AND trim(description) <> '';
