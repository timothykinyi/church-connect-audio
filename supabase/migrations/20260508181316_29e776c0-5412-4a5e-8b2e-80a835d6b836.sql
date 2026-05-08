-- Stop client-side or stale app sessions from deleting team members.
DROP POLICY IF EXISTS "Anyone can leave" ON public.team_members;

-- Make message records resilient if old foreign keys with cascade-delete still exist.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_recipient_id_fkey;

-- Keep lightweight membership integrity without deleting messages or people accidentally.
ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id)
  REFERENCES public.team_members(id)
  ON DELETE RESTRICT;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_recipient_id_fkey
  FOREIGN KEY (recipient_id)
  REFERENCES public.team_members(id)
  ON DELETE RESTRICT;

-- Ensure realtime still has complete row data for updates.
ALTER TABLE public.team_members REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;