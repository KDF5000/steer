DELETE FROM artifacts
WHERE type ILIKE '%instruction%'
   OR type ILIKE '%final_message%'
   OR name ILIKE '%-last-message.%';
