export function NextMonthFocus({ text }: { text: string }) {
  return (
    <div className="rounded border-2 border-foreground/10 bg-muted/20 p-5">
      <p className="text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}
