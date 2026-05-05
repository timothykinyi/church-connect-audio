export const ROLES = ["Controller", "Camera", "Audio", "Other"] as const;
export type Role = typeof ROLES[number];

export const ROLE_COLORS: Record<string, string> = {
  Controller: "bg-primary/20 text-primary border-primary/40",
  Camera: "bg-accent/20 text-accent border-accent/40",
  Audio: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  Other: "bg-muted text-muted-foreground border-border",
};
