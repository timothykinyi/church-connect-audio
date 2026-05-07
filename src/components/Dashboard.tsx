import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_COLORS } from "@/lib/roles";
import { speak, primeSpeech, stopSpeaking, getVoices } from "@/lib/speech";
import { toast } from "sonner";
import { LogOut, Send, Volume2, Users, Radio, CheckCheck, Check, VolumeX, Download } from "lucide-react";

type Member = { id: string; name: string; role: string; last_seen: string };
type Message = { id: string; sender_id: string; recipient_id: string; body: string; played: boolean; created_at: string };

interface Props {
  me: Member;
  onLeave: () => void;
}

export const Dashboard = ({ me, onLeave }: Props) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activePeerId, setActivePeerId] = useState<string>("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  const playedIds = useRef<Set<string>>(new Set());
  const queueRef = useRef<Message[]>([]);
  const playingRef = useRef(false);
  const mutedRef = useRef(muted);
  const membersRef = useRef<Member[]>([]);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { membersRef.current = members; }, [members]);

  // Preload voices early
  useEffect(() => { getVoices(); }, []);

  // PWA install prompt capture
  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Heartbeat presence
  useEffect(() => {
    const beat = () => supabase.from("team_members").update({ last_seen: new Date().toISOString() }).eq("id", me.id);
    beat();
    const interval = setInterval(beat, 15000);
    const onUnload = () => { navigator.sendBeacon?.("/"); supabase.from("team_members").delete().eq("id", me.id); };
    window.addEventListener("beforeunload", onUnload);
    return () => { clearInterval(interval); window.removeEventListener("beforeunload", onUnload); };
  }, [me.id]);

  // Load + subscribe members
  useEffect(() => {
    const load = async () => {
      const cutoff = new Date(Date.now() - 45_000).toISOString();
      const { data } = await supabase.from("team_members").select("*").gte("last_seen", cutoff).order("created_at");
      if (data) setMembers(data);
    };
    load();
    const channel = supabase
      .channel("members-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, load)
      .subscribe();
    const refresh = setInterval(load, 12000);
    return () => { supabase.removeChannel(channel); clearInterval(refresh); };
  }, []);

  // Sequential speech queue — ensures audio fully loaded & finished before next plays
  const drainQueue = async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    while (queueRef.current.length) {
      const msg = queueRef.current.shift()!;
      if (mutedRef.current) {
        await supabase.from("messages").update({ played: true }).eq("id", msg.id);
        continue;
      }
      const sender = membersRef.current.find((m) => m.id === msg.sender_id);
      const prefix = sender ? `Message from ${sender.name}, ${sender.role}. ` : "New message. ";
      setSpeakingId(msg.id);
      await speak(prefix + msg.body, {
        onError: (err) => toast.error(`Audio: ${err}`),
      });
      setSpeakingId(null);
      await supabase.from("messages").update({ played: true }).eq("id", msg.id);
    }
    playingRef.current = false;
  };

  const enqueueIncoming = (msg: Message) => {
    if (playedIds.current.has(msg.id)) return;
    playedIds.current.add(msg.id);
    queueRef.current.push(msg);
    drainQueue();
  };

  // Load + subscribe messages
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .or(`recipient_id.eq.${me.id},sender_id.eq.${me.id}`)
        .order("created_at", { ascending: true })
        .limit(200);
      if (data) {
        setMessages(data);
        // Mark already-loaded as "seen" so they don't auto-replay on refresh
        data.forEach((m) => playedIds.current.add(m.id));
      }
    };
    load();

    const channel = supabase
      .channel("messages-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        if (msg.recipient_id !== me.id && msg.sender_id !== me.id) return;
        setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]));
        if (msg.recipient_id === me.id) enqueueIncoming(msg);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        setMessages((prev) => prev.map((p) => (p.id === msg.id ? msg : p)));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [me.id]);

  // Auto-scroll thread
  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, activePeerId]);

  const enableAudio = async () => {
    await primeSpeech();
    setAudioReady(true);
    toast.success("Audio enabled");
  };

  const handleSend = async () => {
    const body = text.trim();
    if (!body) return toast.error("Type a message");
    if (body.length > 500) return toast.error("Message too long (max 500)");
    if (!activePeerId) return toast.error("Pick a teammate to chat with");

    setSending(true);
    const { error } = await supabase.from("messages").insert({
      sender_id: me.id,
      recipient_id: activePeerId,
      body,
    });
    setSending(false);

    if (error) return toast.error("Failed to send");
    setText("");
  };

  const handleLeave = async () => {
    stopSpeaking();
    await supabase.from("team_members").delete().eq("id", me.id);
    localStorage.removeItem("member");
    onLeave();
  };

  const replay = (msg: Message) => {
    queueRef.current.push(msg);
    drainQueue();
  };

  const promptInstall = async () => {
    if (!installPrompt) return toast.info("On iPhone: Share → Add to Home Screen");
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setInstallPrompt(null);
  };

  const others = members.filter((m) => m.id !== me.id);
  const peer = members.find((m) => m.id === activePeerId);

  // Per-peer thread
  const thread = messages.filter(
    (m) => activePeerId && (
      (m.sender_id === me.id && m.recipient_id === activePeerId) ||
      (m.sender_id === activePeerId && m.recipient_id === me.id)
    )
  );

  // Unread counts per peer (incoming, not yet played)
  const unreadByPeer = new Map<string, number>();
  messages.forEach((m) => {
    if (m.recipient_id === me.id && !m.played) {
      unreadByPeer.set(m.sender_id, (unreadByPeer.get(m.sender_id) || 0) + 1);
    }
  });

  return (
    <div className="min-h-screen p-3 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-primary)' }}>
              <Radio className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Service<span className="text-gradient">Comm</span></h1>
              <p className="text-xs text-muted-foreground font-mono">Live · {members.length} on duty</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {installPrompt && (
              <Button variant="ghost" size="sm" onClick={promptInstall} className="hidden sm:flex">
                <Download className="w-4 h-4 mr-1" /> Install
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setMuted((v) => !v)} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <VolumeX className="w-4 h-4 text-destructive" /> : <Volume2 className="w-4 h-4" />}
            </Button>
            <div className="text-right hidden sm:block">
              <p className="font-semibold text-sm">{me.name}</p>
              <p className="text-xs text-muted-foreground">{me.role}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLeave} aria-label="Leave">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        {!audioReady && (
          <div className="mb-4 p-4 rounded-xl border border-primary/40 bg-primary/10 flex items-center justify-between gap-3">
            <p className="text-sm">
              <strong>Tap to enable voice</strong> — your browser needs one tap before audio can auto-play.
            </p>
            <Button onClick={enableAudio} size="sm" style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
              Enable audio
            </Button>
          </div>
        )}

        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          {/* Sidebar: team list with unread */}
          <aside className="bg-card border border-border rounded-2xl p-4 h-fit lg:sticky lg:top-4" style={{ boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Team</h2>
            </div>
            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground italic px-2">Waiting for teammates…</p>
            ) : (
              <ul className="space-y-1">
                {others.map((m) => {
                  const unread = unreadByPeer.get(m.id) || 0;
                  const active = activePeerId === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => setActivePeerId(m.id)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                          active ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary/40"
                        }`}
                      >
                        <div className="relative">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm shrink-0" style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
                            {m.name[0]?.toUpperCase()}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary border-2 border-card pulse-ring" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{m.name}</p>
                          <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${ROLE_COLORS[m.role] ?? ROLE_COLORS.Other}`}>
                            {m.role}
                          </span>
                        </div>
                        {unread > 0 && (
                          <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                            {unread}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground px-2">
              <p>You: <span className="text-foreground font-medium">{me.name}</span></p>
              <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${ROLE_COLORS[me.role] ?? ROLE_COLORS.Other}`}>
                {me.role}
              </span>
            </div>
          </aside>

          {/* Conversation */}
          <section className="bg-card border border-border rounded-2xl flex flex-col min-h-[70vh]" style={{ boxShadow: 'var(--shadow-card)' }}>
            {!peer ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center">
                <div>
                  <Radio className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Pick a teammate from the list to start a conversation.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm" style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
                      {peer.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-sm leading-tight">{peer.name}</p>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${ROLE_COLORS[peer.role] ?? ROLE_COLORS.Other}`}>
                        {peer.role}
                      </span>
                    </div>
                  </div>
                  {speakingId && <span className="text-xs font-mono text-primary animate-pulse">● Speaking…</span>}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {thread.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground italic mt-10">No messages yet. Say hi.</p>
                  ) : (
                    thread.map((msg) => {
                      const isMine = msg.sender_id === me.id;
                      return (
                        <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 border ${
                            isMine ? "bg-primary/15 border-primary/30 rounded-br-sm" : "bg-secondary/60 border-border rounded-bl-sm"
                          } ${speakingId === msg.id ? "ring-2 ring-primary" : ""}`}>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                            <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] font-mono text-muted-foreground">
                              <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              {isMine ? (
                                msg.played ? <CheckCheck className="w-3 h-3 text-primary" /> : <Check className="w-3 h-3" />
                              ) : (
                                <button onClick={() => replay(msg)} className="hover:text-primary" aria-label="Replay">
                                  <Volume2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={threadEndRef} />
                </div>

                {/* Composer */}
                <div className="border-t border-border p-3">
                  <div className="flex gap-2 items-end">
                    <Textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={`Message ${peer.name}…`}
                      maxLength={500}
                      rows={1}
                      className="bg-input border-border resize-none min-h-[44px] max-h-32"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                      }}
                    />
                    <Button
                      onClick={handleSend}
                      disabled={sending || !text.trim()}
                      className="h-11 px-4 shrink-0"
                      style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between mt-1.5 px-1">
                    <span className="text-[10px] text-muted-foreground font-mono">{text.length}/500 · Enter to send · Shift+Enter newline</span>
                    <span className="text-[10px] text-muted-foreground font-mono">🔒 Only {peer.name} hears this</span>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
