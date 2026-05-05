import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLES, type Role } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Radio } from "lucide-react";

interface Props {
  onJoined: (member: { id: string; name: string; role: string }) => void;
}

export const JoinScreen = ({ onJoined }: Props) => {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("Controller");
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Please enter your name");
    if (trimmed.length > 50) return toast.error("Name too long");

    setLoading(true);
    const { data, error } = await supabase
      .from("team_members")
      .insert({ name: trimmed, role })
      .select()
      .single();
    setLoading(false);

    if (error || !data) return toast.error("Failed to join");
    localStorage.setItem("member", JSON.stringify(data));
    onJoined(data);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 glow" style={{ background: 'var(--gradient-primary)' }}>
            <Radio className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-bold mb-2">
            Service<span className="text-gradient">Comm</span>
          </h1>
          <p className="text-muted-foreground">Voice messages for your church team</p>
        </div>

        <form onSubmit={handleJoin} className="bg-card border border-border rounded-2xl p-8 space-y-6" style={{ boxShadow: 'var(--shadow-card)' }}>
          <div className="space-y-2">
            <Label htmlFor="name" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Your name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah"
              maxLength={50}
              autoFocus
              className="bg-input border-border h-12"
            />
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Your role</Label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`h-12 rounded-xl border text-sm font-medium transition-all ${
                    role === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" disabled={loading} className="w-full h-12 text-base font-semibold" style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
            {loading ? "Joining…" : "Join the team"}
          </Button>
        </form>
      </div>
    </div>
  );
};
