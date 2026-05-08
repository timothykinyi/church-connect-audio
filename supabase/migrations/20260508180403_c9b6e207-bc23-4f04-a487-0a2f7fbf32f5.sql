ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS group_key TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_group_key ON public.messages(group_key);