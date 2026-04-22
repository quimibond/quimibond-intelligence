import { LoadingCard } from "@/components/patterns";

export default function Loading() {
  return (
    <div className="p-4 space-y-4">
      <LoadingCard />
      <LoadingCard />
      <LoadingCard />
    </div>
  );
}
