export type TimelineItemType = "alert" | "action" | "email" | "fact" | "event";

export interface TimelineItem {
  id: string;
  rawId: number;
  type: TimelineItemType;
  title: string;
  subtitle: string | null;
  metadata: string | null;
  created_at: string;
  severity?: string;
  priority?: string;
  confidence?: number;
}

export type DateRange = "today" | "7d" | "30d";
