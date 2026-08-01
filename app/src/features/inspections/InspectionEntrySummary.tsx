import { Check, ChevronRight } from "lucide-react";
import type { InspectionEntry, PhotoGroup } from "../../domain/models";

export interface InspectionEntrySummaryProps {
  entry: InspectionEntry;
  groups: PhotoGroup[];
  onOpen(entryId: string): void;
  showContext?: boolean;
}

export function InspectionEntrySummary({ entry, groups, onOpen, showContext = false }: InspectionEntrySummaryProps) {
  const photoCount = groups.reduce((count, group) => count + group.photoIds.length, 0);
  const complete = entry.checkSelections.length > 0 && photoCount > 0;
  const context = [entry.itemSnapshot.part, entry.itemSnapshot.area, entry.itemSnapshot.device]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(" · ");

  return (
    <li className={`inspection-entry-summary${complete ? " is-complete" : ""}`}>
      <button
        type="button"
        className="inspection-entry-summary__button"
        data-inspection-entry-id={entry.id}
        data-photo-count={photoCount}
        data-complete={complete}
        onClick={() => onOpen(entry.id)}
      >
        <span className="inspection-entry-summary__status" aria-hidden="true">
          {complete ? <Check size={18} /> : <span className="inspection-entry-summary__dot" />}
        </span>
        <span className="inspection-entry-summary__content">
          <strong>{entry.itemSnapshot.routeName}</strong>
          {showContext && context ? <span className="inspection-entry-summary__context">{context}</span> : null}
        </span>
        <span className="inspection-entry-summary__label">{complete ? "已完成" : "未完成"}</span>
        <ChevronRight aria-hidden="true" size={19} />
      </button>
    </li>
  );
}
