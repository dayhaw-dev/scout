UPDATE channels
SET
  title = REPLACE(REPLACE(title, 'â„¢', '™'), 'â¢', '™'),
  description = REPLACE(REPLACE(description, 'â„¢', '™'), 'â¢', '™'),
  raw_json = REPLACE(REPLACE(raw_json, 'â„¢', '™'), 'â¢', '™')
WHERE
  title LIKE '%â%¢%'
  OR description LIKE '%â%¢%'
  OR raw_json LIKE '%â%¢%';
