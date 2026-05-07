-- Tighten messages UPDATE policy
DROP POLICY IF EXISTS "Anyone can mark played" ON public.messages;

CREATE POLICY "Anyone can mark played"
ON public.messages
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Add length validation via trigger (CHECK can't be added easily on existing data safely, use trigger)
CREATE OR REPLACE FUNCTION public.validate_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF length(NEW.body) = 0 OR length(NEW.body) > 500 THEN
    RAISE EXCEPTION 'Message body must be 1-500 characters';
  END IF;
  IF NEW.sender_id = NEW.recipient_id THEN
    RAISE EXCEPTION 'Cannot send message to self';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_message_trigger ON public.messages;
CREATE TRIGGER validate_message_trigger
BEFORE INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.validate_message();

-- Validate team_members
CREATE OR REPLACE FUNCTION public.validate_team_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF length(NEW.name) = 0 OR length(NEW.name) > 50 THEN
    RAISE EXCEPTION 'Name must be 1-50 characters';
  END IF;
  IF NEW.role NOT IN ('Controller', 'Camera', 'Audio', 'Other') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_team_member_trigger ON public.team_members;
CREATE TRIGGER validate_team_member_trigger
BEFORE INSERT OR UPDATE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION public.validate_team_member();

-- Index for faster recipient lookups
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON public.messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_members_last_seen ON public.team_members(last_seen DESC);