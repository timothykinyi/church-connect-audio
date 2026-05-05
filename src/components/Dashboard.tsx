import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_COLORS } from "@/lib/roles";
import { toast } from "sonner";
import { LogOut, Send, Volume2, Users, Radio } from "lucide-react";

type Member = { id: string; name: string; role: string; last_seen: string };
type Message = { id: string; sender_id: string; recipient_id: string; body: string; played: boolean; created_at: string };

interface Props {
  me: Member;
  onLeave: () => void;
}

export const Dashboard = ({ me, onLeave }: Props) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [recipientId, setRecipientId] = useState<string>("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const playedIds = useRef<Set<string>>(new Set());

  // Heartbeat presence
  useEffect(() => {
    const beat = () => supabase.from("team_members").update({ last_seen: new Date().toISOString() }).eq("id", me.id);
    beat();
    const interval = setInterval(beat, 20000);
    return () => clearInterval(interval);
  }, [me.id]);

  // Load + subscribe members
  useEffect(() => {
    const load = async () => {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data } = await supabase.from("team_members").select("*").gte("last_seen", cutoff).order("created_at");
      if (data) setMembers(data);
    };
    load();
    const channel = supabase
      .channel("members")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, load)
      .subscribe();
    const refresh = setInterval(load, 15000);
    return () => { supabase.removeChannel(channel); clearInterval(refresh); };
  }, []);

  // Load + subscribe messages for me
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .or(`recipient_id.eq.${me.id},sender_id.eq.${me.id}`)
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setMessages(data);
    };
    load();

    const channel = supabase
      .channel("messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        if (msg.recipient_id === me.id || msg.sender_id === me.id) {
          setMessages((prev) => [msg, ...prev]);
          if (msg.recipient_id === me.id && !playedIds.current.has(msg.id)) {
            playedIds.current.add(msg.id);
            speakMessage(msg);
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [me.id]);

  const speakMessage = (msg: Message) => {
    const sender = members.find((m) => m.id === msg.sender_id);
    const prefix = sender ? `Message from ${sender.name}. ` : "New message. ";
    const utterance = new SpeechSynthesisUtterance(prefix + msg.body);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    supabase.from("messages").update({ played: true }).eq("id", msg.id).then(() => {});
  };

  const replay = (msg: Message) => speakMessage(msg);

  const handleSend = async () => {
    const body = text.trim();
    if (!body) return toast.error("Type a message");
    if (body.length > 500) return toast.error("Message too long (max 500)");
    if (!recipientId) return toast.error("Pick a recipient");

    setSending(true);
    const { error } = await supabase.from("messages").insert({
      sender_id: me.id,
      recipient_id: recipientId,
      body,
    });
    setSending(false);

    if (error) return toast.error("Failed to send");
    setText("");
    toast.success("Sent");
  };

  const handleLeave = async () => {
    await supabase.from("team_members").delete().eq("id", me.id);
    localStorage.removeItem("member");
    onLeave();
  };

  const others = members.filter((m) => m.id !== me.id);
  const recipient = members.find((m) => m.id === recipientId);

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-primary)' }}>
              <Radio className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Service<span className="text-gradient">Comm</span></h1>
              <p className="text-xs text-muted-foreground font-mono">Live</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="font-semibold text-sm">{me.name}</p>
              <p className="text-xs text-muted-foreground">{me.role}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLeave} aria-label="Leave">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          {/* Main: send + history */}
          <div className="space-y-6">
            {/* Composer */}
            <section className="bg-card border border-border rounded-2xl p-6" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Send className="w-4 h-4 text-primary" />
                <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Send voice message</h2>
              </div>

              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">To</p>
                {others.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Waiting for teammates to join…</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {others.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setRecipientId(m.id)}
                        className={`px-3 py-2 rounded-xl border text-sm transition-all ${
                          recipientId === m.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary/50 hover:text-foreground"
                        }`}
                      >
                        <span className="font-medium">{m.name}</span>
                        <span className="ml-2 text-xs opacity-70">{m.role}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={recipient ? `Message ${recipient.name}…` : "Pick someone above first"}
                maxLength={500}
                rows={3}
                className="bg-input border-border resize-none mb-3"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono">{text.length}/500 · ⌘↵ to send</span>
                <Button
                  onClick={handleSend}
                  disabled={sending || !recipientId || !text.trim()}
                  className="font-semibold"
                  style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {sending ? "Sending…" : "Send"}
                </Button>
              </div>
            </section>

            {/* Messages */}
            <section className="bg-card border border-border rounded-2xl p-6" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Volume2 className="w-4 h-4 text-accent" />
                <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Conversation log</h2>
              </div>
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No messages yet.</p>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
                  {messages.map((msg) => {
                    const sender = members.find((m) => m.id === msg.sender_id);
                    const recip = members.find((m) => m.id === msg.recipient_id);
                    const isMine = msg.sender_id === me.id;
                    return (
                      <div key={msg.id} className={`p-4 rounded-xl border ${isMine ? "border-border bg-secondary/30" : "border-primary/30 bg-primary/5"}`}>
                        <div className="flex items-center justify-between mb-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{sender?.name ?? "?"}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-semibold">{recip?.name ?? "?"}</span>
                          </div>
                          <span className="text-muted-foreground font-mono">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm leading-relaxed">{msg.body}</p>
                          {!isMine && (
                            <Button size="icon" variant="ghost" className="shrink-0 h-8 w-8" onClick={() => replay(msg)} aria-label="Replay">
                              <Volume2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Sidebar: team */}
          <aside className="bg-card border border-border rounded-2xl p-6 h-fit lg:sticky lg:top-8" style={{ boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">On duty · {members.length}</h2>
            </div>
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm" style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
                      {m.name[0]?.toUpperCase()}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border-2 border-card pulse-ring" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{m.name} {m.id === me.id && <span className="text-muted-foreground text-xs">(you)</span>}</p>
                    <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${ROLE_COLORS[m.role] ?? ROLE_COLORS.Other}`}>
                      {m.role}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
};
