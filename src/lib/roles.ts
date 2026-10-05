export const ROLES = ["Controller", "Camera", "Audio", "Other"] as const;
export type Role = typeof ROLES[number];

export const ROLE_COLORS: Record<string, string> = {
  Controller: "bg-primary/20 text-primary border-primary/40",
  Camera: "bg-accent/20 text-accent border-accent/40",
  Audio: "bg-secondary text-secondary-foreground border-border",
  Other: "bg-muted text-muted-foreground border-border",
};
