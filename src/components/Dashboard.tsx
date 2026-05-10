import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ROLE_COLORS } from "@/lib/roles";
import { speak, primeSpeech, stopSpeaking, getVoices, detectLang } from "@/lib/speech";
import { QUICK_TEXTS } from "@/lib/quickTexts";
import { useTheme } from "@/lib/theme";
import { toast } from "sonner";
import { LogOut, Send, Volume2, Users, Radio, CheckCheck, Check, VolumeX, Download, UsersRound, Plus, X, Sun, Moon, Monitor, Zap } from "lucide-react";

type Member = { id: string; name: string; role: string; last_seen: string };
type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  played: boolean;
  created_at: string;
  group_key: string | null;
};

interface Props {
  me: Member;
  onLeave: () => void;
}

const AUDIO_READY_KEY = "audio-ready-v1";
const STALE_MS = 10 * 60_000; // 10 min — tolerate mobile/background throttling without hiding teammates
const HEARTBEAT_MS = 8_000;

// Build a stable group_key from a set of member ids (sorted, joined)
const groupKeyOf = (ids: string[]) => [...new Set(ids)].sort().join("|");

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = theme === "system" ? "System" : theme;
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(next)} aria-label={`Theme: ${label}`} title={`Theme: ${label} (tap to switch)`}>
      <Icon className="w-4 h-4" />
    </Button>
  );
};

export const Dashboard = ({ me, onLeave }: Props) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  // active conversation: either a single peer id, or a group key
  const [activeKey, setActiveKey] = useState<string>(""); // member id OR "group:<key>"
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [audioReady, setAudioReady] = useState<boolean>(() => localStorage.getItem(AUDIO_READY_KEY) === "1");
  const [muted, setMuted] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupSelection, setGroupSelection] = useState<Set<string>>(new Set());

  const playedIds = useRef<Set<string>>(new Set());
  const queueRef = useRef<Message[]>([]);
  const playingRef = useRef(false);
  const mutedRef = useRef(muted);
  const membersRef = useRef<Member[]>([]);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { membersRef.current = members; }, [members]);

  useEffect(() => { getVoices(); }, []);

  // Auto-prime speech if previously enabled (works on Chrome; iOS will need one tap anyway)
  useEffect(() => {
    if (audioReady) primeSpeech().catch(() => {});
  }, []); // once

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Heartbeat presence — frequent + on visibility/focus. Never auto-delete; rows persist for the service.
  useEffect(() => {
    const beat = () => {
      const next = { ...me, last_seen: new Date().toISOString() };
      localStorage.setItem("member", JSON.stringify(next));
      return supabase.from("team_members").update({ last_seen: next.last_seen }).eq("id", me.id);
    };
    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    window.addEventListener("focus", beat);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(interval); window.removeEventListener("focus", beat); document.removeEventListener("visibilitychange", onVis); };
  }, [me.id]);

  // Load + subscribe members (wide cutoff so bg-tab teammates don't disappear)
  useEffect(() => {
    const load = async () => {
      const cutoff = new Date(Date.now() - STALE_MS).toISOString();
      const { data } = await supabase.from("team_members").select("*").gte("last_seen", cutoff).order("created_at");
      if (data) setMembers(data);
    };
    load();
    const channel = supabase
      .channel("members-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, load)
      .subscribe();
    const refresh = setInterval(load, 10_000);
    return () => { supabase.removeChannel(channel); clearInterval(refresh); };
  }, []);

  // Sequential speech queue — speaks each message twice, 10s apart
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
      const groupNote = msg.group_key ? " (group message)" : "";
      const prefix = sender ? `Message from ${sender.name}, ${sender.role}${groupNote}. ` : "New message. ";
      const fullText = prefix + msg.body;
      const lang = detectLang(msg.body); // English or Swahili

      setSpeakingId(msg.id);
      await speak(fullText, { lang, onError: (err) => toast.error(`Audio: ${err}`) });
      await supabase.from("messages").update({ played: true }).eq("id", msg.id);
      await new Promise((r) => setTimeout(r, 10_000));
      if (!mutedRef.current) {
        await speak("Repeat. " + fullText, { lang, onError: () => {} });
      }
      setSpeakingId(null);
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
        .limit(500);
      if (data) {
        setMessages(data as Message[]);
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

  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, activeKey]);

  const enableAudio = async () => {
    await primeSpeech();
    localStorage.setItem(AUDIO_READY_KEY, "1");
    setAudioReady(true);
    toast.success("Audio enabled — stays on across refreshes");
  };

  const isGroupKey = activeKey.startsWith("group:");
  const activePeerId = isGroupKey ? "" : activeKey;
  const activeGroupKey = isGroupKey ? activeKey.slice(6) : "";

  const handleSend = async () => {
    const body = text.trim();
    if (!body) return toast.error("Type a message");
    if (body.length > 500) return toast.error("Message too long (max 500)");
    if (!activeKey) return toast.error("Pick a teammate or group");

    setSending(true);
    let error;
    if (isGroupKey) {
      const ids = activeGroupKey.split("|").filter((id) => id !== me.id);
      const rows = ids.map((rid) => ({
        sender_id: me.id,
        recipient_id: rid,
        body,
        group_key: activeGroupKey,
      }));
      const res = await supabase.from("messages").insert(rows);
      error = res.error;
    } else {
      const res = await supabase.from("messages").insert({
        sender_id: me.id,
        recipient_id: activePeerId,
        body,
      });
      error = res.error;
    }
    setSending(false);

    if (error) return toast.error("Failed to send");
    setText("");
  };

  const handleLeave = async () => {
    stopSpeaking();
    // Remove from live team list so others stop seeing this user
    try { await supabase.from("team_members").delete().eq("id", me.id); } catch {}
    localStorage.removeItem("member");
    onLeave();
  };

  const sendQuick = async (body: string) => {
    if (!activeKey) return toast.error("Pick a teammate or group first");
    if (isGroupKey) {
      const ids = activeGroupKey.split("|").filter((id) => id !== me.id);
      const rows = ids.map((rid) => ({ sender_id: me.id, recipient_id: rid, body, group_key: activeGroupKey }));
      const { error } = await supabase.from("messages").insert(rows);
      if (error) toast.error("Failed to send");
    } else {
      const { error } = await supabase.from("messages").insert({ sender_id: me.id, recipient_id: activePeerId, body });
      if (error) toast.error("Failed to send");
    }
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

  // Distinct groups I'm part of (derived from messages)
  const myGroups = useMemo(() => {
    const map = new Map<string, { key: string; memberIds: string[] }>();
    messages.forEach((m) => {
      if (!m.group_key) return;
      const ids = m.group_key.split("|");
      if (!ids.includes(me.id)) return;
      if (!map.has(m.group_key)) map.set(m.group_key, { key: m.group_key, memberIds: ids });
    });
    return [...map.values()];
  }, [messages, me.id]);

  // Per-conversation thread
  const thread = messages.filter((m) => {
    if (isGroupKey) return m.group_key === activeGroupKey;
    if (!activePeerId) return false;
    return !m.group_key && (
      (m.sender_id === me.id && m.recipient_id === activePeerId) ||
      (m.sender_id === activePeerId && m.recipient_id === me.id)
    );
  });

  // De-dupe group messages (one row per recipient — show once to sender)
  const dedupedThread = isGroupKey
    ? thread.filter((m, i, arr) => arr.findIndex((x) => x.created_at === m.created_at && x.sender_id === m.sender_id && x.body === m.body) === i)
    : thread;

  // Unread counts
  const unreadByPeer = new Map<string, number>();
  const unreadByGroup = new Map<string, number>();
  messages.forEach((m) => {
    if (m.recipient_id !== me.id || m.played) return;
    if (m.group_key) unreadByGroup.set(m.group_key, (unreadByGroup.get(m.group_key) || 0) + 1);
    else unreadByPeer.set(m.sender_id, (unreadByPeer.get(m.sender_id) || 0) + 1);
  });

  const peer = members.find((m) => m.id === activePeerId);
  const activeGroup = isGroupKey ? myGroups.find((g) => g.key === activeGroupKey) : undefined;
  const groupMembers = activeGroup ? activeGroup.memberIds.map((id) => members.find((m) => m.id === id)).filter(Boolean) as Member[] : [];

  const toggleGroupPick = (id: string) => {
    setGroupSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startGroup = () => {
    if (groupSelection.size < 2) return toast.error("Pick at least 2 teammates");
    const key = groupKeyOf([me.id, ...groupSelection]);
    setActiveKey("group:" + key);
    setGroupPickerOpen(false);
    setGroupSelection(new Set());
  };

  const headerTitle = isGroupKey
    ? `Group · ${groupMembers.length} people`
    : peer?.name ?? "";

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
            <ThemeToggle />
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
              <strong>Tap to enable voice</strong> — one tap, then it stays on across refreshes.
            </p>
            <Button onClick={enableAudio} size="sm" style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
              Enable audio
            </Button>
          </div>
        )}

        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          {/* Sidebar */}
          <aside className="bg-card border border-border rounded-2xl p-4 h-fit lg:sticky lg:top-4" style={{ boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Team</h2>
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setGroupPickerOpen((v) => !v)}>
                {groupPickerOpen ? <X className="w-3.5 h-3.5" /> : <><Plus className="w-3.5 h-3.5 mr-1" /><span className="text-xs">Group</span></>}
              </Button>
            </div>

            {groupPickerOpen && (
              <div className="mb-3 p-3 rounded-xl border border-primary/30 bg-primary/5 space-y-2">
                <p className="text-xs text-muted-foreground">Pick teammates for the group:</p>
                {others.length === 0 && <p className="text-xs italic">No teammates online</p>}
                {others.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={groupSelection.has(m.id)} onCheckedChange={() => toggleGroupPick(m.id)} />
                    <span className="truncate">{m.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{m.role}</span>
                  </label>
                ))}
                <Button size="sm" className="w-full mt-1" onClick={startGroup} style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
                  Start group ({groupSelection.size})
                </Button>
              </div>
            )}

            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground italic px-2">Waiting for teammates…</p>
            ) : (
              <ul className="space-y-1">
                {others.map((m) => {
                  const unread = unreadByPeer.get(m.id) || 0;
                  const active = activeKey === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => setActiveKey(m.id)}
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

            {myGroups.length > 0 && (
              <>
                <div className="flex items-center gap-2 mt-4 mb-2">
                  <UsersRound className="w-4 h-4 text-primary" />
                  <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Groups</h2>
                </div>
                <ul className="space-y-1">
                  {myGroups.map((g) => {
                    const names = g.memberIds
                      .filter((id) => id !== me.id)
                      .map((id) => members.find((m) => m.id === id)?.name ?? "?")
                      .join(", ");
                    const unread = unreadByGroup.get(g.key) || 0;
                    const active = activeKey === "group:" + g.key;
                    return (
                      <li key={g.key}>
                        <button
                          onClick={() => setActiveKey("group:" + g.key)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all ${
                            active ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary/40"
                          }`}
                        >
                          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-primary)' }}>
                            <UsersRound className="w-4 h-4 text-primary-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{names || "Group"}</p>
                            <p className="text-[10px] text-muted-foreground">{g.memberIds.length} people</p>
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
              </>
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
            {!activeKey ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground p-8 text-center">
                <div>
                  <Radio className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Pick a teammate, or tap <strong>+ Group</strong> to start a group chat.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm shrink-0" style={{ background: 'var(--gradient-primary)', color: 'hsl(var(--primary-foreground))' }}>
                      {isGroupKey ? <UsersRound className="w-4 h-4" /> : peer?.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-tight truncate">{headerTitle}</p>
                      {isGroupKey ? (
                        <p className="text-[10px] text-muted-foreground truncate">{groupMembers.map((m) => m.name).join(" · ")}</p>
                      ) : peer && (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${ROLE_COLORS[peer.role] ?? ROLE_COLORS.Other}`}>
                          {peer.role}
                        </span>
                      )}
                    </div>
                  </div>
                  {speakingId && <span className="text-xs font-mono text-primary animate-pulse shrink-0">● Speaking…</span>}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {dedupedThread.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground italic mt-10">No messages yet.</p>
                  ) : (
                    dedupedThread.map((msg) => {
                      const isMine = msg.sender_id === me.id;
                      const sender = members.find((m) => m.id === msg.sender_id);
                      return (
                        <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 border ${
                            isMine ? "bg-primary/15 border-primary/30 rounded-br-sm" : "bg-secondary/60 border-border rounded-bl-sm"
                          } ${speakingId === msg.id ? "ring-2 ring-primary" : ""}`}>
                            {isGroupKey && !isMine && (
                              <p className="text-[10px] font-semibold text-primary mb-0.5">{sender?.name ?? "Unknown"}</p>
                            )}
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
                      placeholder={isGroupKey ? "Message the group…" : `Message ${peer?.name ?? ""}…`}
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
                    <span className="text-[10px] text-muted-foreground font-mono">
                      🔒 {isGroupKey ? `${groupMembers.length - 1} recipients hear this` : `Only ${peer?.name ?? ""} hears this`} · 🔁 Plays twice
                    </span>
                  </div>

                  {/* Quick texts — role-specific shortcuts */}
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Zap className="w-3.5 h-3.5 text-primary" />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Quick · {me.role}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(QUICK_TEXTS[me.role] ?? QUICK_TEXTS.Other).map((q) => (
                        <button
                          key={q}
                          onClick={() => sendQuick(q)}
                          className="px-3 py-1.5 rounded-full border border-border bg-secondary/60 hover:bg-primary/15 hover:border-primary/40 text-xs font-medium transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
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
