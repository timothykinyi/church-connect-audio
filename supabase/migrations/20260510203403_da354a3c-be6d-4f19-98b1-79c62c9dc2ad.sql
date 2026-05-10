CREATE POLICY "Members can leave"
ON public.team_members
FOR DELETE
USING (true);