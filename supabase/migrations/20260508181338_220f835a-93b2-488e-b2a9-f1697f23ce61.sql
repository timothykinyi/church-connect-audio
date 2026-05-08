-- Tighten public policies while preserving no-login service-room workflow.
DROP POLICY IF EXISTS "Anyone can join" ON public.team_members;
DROP POLICY IF EXISTS "Anyone can update presence" ON public.team_members;
DROP POLICY IF EXISTS "Anyone can send messages" ON public.messages;
DROP POLICY IF EXISTS "Anyone can mark played" ON public.messages;

CREATE POLICY "Valid team members can join"
ON public.team_members
FOR INSERT
WITH CHECK (
  length(btrim(name)) BETWEEN 1 AND 50
  AND role IN ('Controller', 'Camera', 'Audio', 'Other')
);

CREATE POLICY "Valid team members can update presence"
ON public.team_members
FOR UPDATE
USING (
  id IS NOT NULL
  AND length(btrim(name)) BETWEEN 1 AND 50
  AND role IN ('Controller', 'Camera', 'Audio', 'Other')
)
WITH CHECK (
  id IS NOT NULL
  AND length(btrim(name)) BETWEEN 1 AND 50
  AND role IN ('Controller', 'Camera', 'Audio', 'Other')
);

CREATE POLICY "Valid messages can be sent"
ON public.messages
FOR INSERT
WITH CHECK (
  sender_id <> recipient_id
  AND length(btrim(body)) BETWEEN 1 AND 500
  AND sender_id IS NOT NULL
  AND recipient_id IS NOT NULL
);

CREATE POLICY "Messages can only be marked played"
ON public.messages
FOR UPDATE
USING (
  id IS NOT NULL
  AND recipient_id IS NOT NULL
)
WITH CHECK (
  played = true
  AND sender_id <> recipient_id
  AND length(btrim(body)) BETWEEN 1 AND 500
);

-- Prevent client updates from changing the sender, recipient, body, or group after creation.
CREATE OR REPLACE FUNCTION public.lock_message_delivery_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
    OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.group_key IS DISTINCT FROM OLD.group_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only message played status can be updated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_message_delivery_fields_trigger ON public.messages;
CREATE TRIGGER lock_message_delivery_fields_trigger
BEFORE UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.lock_message_delivery_fields();