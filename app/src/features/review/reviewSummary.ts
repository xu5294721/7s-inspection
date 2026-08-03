import type { PhotoCategory, PhotoGroup } from "../../domain/models";

export interface ReviewSummary {
  groups: Record<PhotoCategory, number>;
  photos: Record<PhotoCategory, number>;
  rewardAmount: number;
  assessmentAmount: number;
  totalPhotos: number;
}

export function buildReviewSummary(groups: PhotoGroup[]): ReviewSummary {
  const summary: ReviewSummary = {
    groups: { good: 0, general: 0, reminder: 0, assessment: 0 },
    photos: { good: 0, general: 0, reminder: 0, assessment: 0 },
    rewardAmount: 0,
    assessmentAmount: 0,
    totalPhotos: 0,
  };

  for (const group of groups) {
    summary.groups[group.category] += 1;
    summary.photos[group.category] += group.photoIds.length;
    summary.totalPhotos += group.photoIds.length;
    if (group.awardAssessment?.type === "reward") {
      summary.rewardAmount += group.awardAssessment.amount;
    } else if (group.awardAssessment?.type === "assessment") {
      summary.assessmentAmount += group.awardAssessment.amount;
    }
  }

  return summary;
}
