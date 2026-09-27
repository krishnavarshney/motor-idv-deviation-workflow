import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/skeletons";

// Route-level fallback: shown only until the page shell (header) streams; sections then show their own skeletons.
export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <TableSkeleton cols={["w-28", "w-40", "w-24", "w-20"]} />
    </>
  );
}
