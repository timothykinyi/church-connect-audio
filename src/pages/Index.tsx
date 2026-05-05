import { useEffect, useState } from "react";
import { JoinScreen } from "@/components/JoinScreen";
import { Dashboard } from "@/components/Dashboard";
import { supabase } from "@/integrations/supabase/client";

type Member = { id: string; name: string; role: string; last_seen: string };

const Index = () => {
  const [me, setMe] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("member");
    if (!stored) { setLoading(false); return; }
    try {
      const parsed = JSON.parse(stored) as Member;
      // verify still exists
      supabase.from("team_members").select("*").eq("id", parsed.id).maybeSingle().then(({ data }) => {
        if (data) setMe(data as Member);
        else localStorage.removeItem("member");
        setLoading(false);
      });
    } catch {
      localStorage.removeItem("member");
      setLoading(false);
    }
  }, []);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!me) return <JoinScreen onJoined={setMe} />;
  return <Dashboard me={me} onLeave={() => setMe(null)} />;
};

export default Index;
