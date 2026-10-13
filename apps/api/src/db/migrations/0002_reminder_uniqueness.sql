-- A reminder can be marked as sent once. The index makes that true even when two people click at the same moment.
create unique index message_log_reminder_unique
  on message_log (appointment_id)
  where kind = 'appointment_reminder' and status = 'marked_sent';
