export interface ThresholdInput {
  acted: number;
  dismissed: number;
  /** Insights que expiraron sin acción — soft dismiss */
  expired: number;
  total: number;
}

export function computeAdaptiveThreshold(input: ThresholdInput): number {
  const { acted, dismissed, expired, total } = input;

  if (total < 10) return 0.80;

  // Soft dismiss: expired cuenta como 0.5 dismiss (CEO vio la notif pero no actuó)
  const effectiveDismiss = dismissed + expired * 0.5;
  const decided = acted + effectiveDismiss;
  if (decided <= 0) return 0.80;

  const dismissRate = (effectiveDismiss / decided) * 100;
  const actedRate = (acted / decided) * 100;

  if (dismissRate > 60) return 0.92;
  if (dismissRate > 40) return 0.88;
  if (dismissRate > 20) return 0.83;

  if (actedRate < 10) return 0.85;
  if (actedRate < 20) return 0.80;
  if (actedRate > 25) return 0.70;

  return 0.80;
}
