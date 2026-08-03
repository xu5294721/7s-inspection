import { makePhotoGroup } from "../../test/fixtures";
import { buildReviewSummary } from "./reviewSummary";

test("counts groups, photos, rewards, and assessments independently", () => {
  const summary = buildReviewSummary([
    makePhotoGroup({ id: "good-1", photoIds: ["p1", "p2"], awardAssessment: { type: "reward", people: "甲", amount: 30 } }),
    makePhotoGroup({ id: "good-2", photoIds: ["p3"] }),
    makePhotoGroup({ id: "reminder-1", category: "reminder", photoIds: ["p4", "p5", "p6"] }),
    makePhotoGroup({ id: "assessment-1", category: "assessment", photoIds: ["p7"], awardAssessment: { type: "assessment", people: "乙", amount: 50 } }),
  ]);

  expect(summary).toEqual({
    groups: { good: 2, general: 0, reminder: 1, assessment: 1 },
    photos: { good: 3, general: 0, reminder: 3, assessment: 1 },
    rewardAmount: 30,
    assessmentAmount: 50,
    totalPhotos: 7,
  });
});

test("includes general counts in the four-category summary", () => {
  expect(buildReviewSummary([
    makePhotoGroup({ category: "general", photoIds: ["p1", "p2"] }),
  ])).toMatchObject({
    groups: { good: 0, general: 1, reminder: 0, assessment: 0 },
    photos: { good: 0, general: 2, reminder: 0, assessment: 0 },
    totalPhotos: 2,
  });
});

test("reports all 80 photos", () => {
  const photos = Array.from({ length: 80 }, (_, index) => `photo-${index}`);
  expect(buildReviewSummary([makePhotoGroup({ photoIds: photos })]).totalPhotos).toBe(80);
});
