import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Download, Share2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import {
  beginPhotoProcessing,
} from "../../app/photoProcessingSignal";
import type { ChecklistItem, InspectionCheckSelection, InspectionEntry, InspectionGraph, PhotoAsset, PhotoCategory, PhotoGroup, PhotoLayoutMode, PhotosPerRow, ReportTemplate, ReportValidationError, ReviewRouteOrderByCategory } from "../../domain/models";
import { descriptionForCategory, splitPhotoIntoGroup } from "../../domain/inspection";
import { PHOTO_ROW_COUNTS } from "../../domain/photoLayout";
import { PHOTO_CATEGORIES } from "../../domain/photoCategory";
import { sortRouteNamesForReview, sortRouteNamesForReviewByCategory } from "../../domain/reviewRouteOrder";
import { createBrowserUuid } from "../../lib/ids";
import { processImage } from "../../lib/images/compressImage";
import { saveCapturedPhotoToGallery } from "../../platform/nativeFile";
import { InspectionEntryEditor } from "../inspections/InspectionEntryEditor";
import type { PhotoInputSource } from "../photos/PhotoCaptureButtons";
import { validateReportReadiness } from "../../domain/reportValidation";
import type { ReportProgress } from "../reports/generateDocx";
import { ReviewGroupList } from "./ReviewGroupList";
import { ReviewRouteEditDialog } from "./ReviewRouteEditDialog";
import { ReviewRouteSortDialog } from "./ReviewRouteSortDialog";
import { buildReviewSummary } from "./reviewSummary";

const categories = PHOTO_CATEGORIES;

interface SaveBatch {
  generation: number;
  latestSaveVersion: number;
  queue: Promise<void>;
  pending: number;
  failure: Error | null;
}

function checklistItemForEntry(entry: InspectionEntry, graph: InspectionGraph): ChecklistItem {
  return {
    ...entry.itemSnapshot,
    quickPhrases: [...entry.itemSnapshot.quickPhrases],
    enabled: true,
    createdAt: graph.inspection.createdAt,
    updatedAt: graph.inspection.updatedAt,
  };
}

export function ReviewPage() {
  const { id = "" } = useParams();
  const { backupRepository, inspectionRepository, templateRepository, reportGenerator } = useAppDependencies();
  const [graph, setGraph] = useState<InspectionGraph | null | undefined>();
  const [activeCategory, setActiveCategory] = useState<PhotoCategory>("good");
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [templateVersions, setTemplateVersions] = useState<ReportTemplate[]>([]);
  const [generationProgress, setGenerationProgress] = useState<ReportProgress | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<{ blob: Blob; filename: string } | null>(null);
  const [routeSortOpen, setRouteSortOpen] = useState(false);
  const [editingRouteName, setEditingRouteName] = useState<string | null>(null);
  const [editProcessing, setEditProcessing] = useState(false);
  const [editError, setEditError] = useState("");
  const groupElements = useRef(new Map<string, HTMLElement>());
  const tabElements = useRef(new Map<PhotoCategory, HTMLButtonElement>());
  const settingsElement = useRef<HTMLDivElement>(null);
  const globalErrorsElement = useRef<HTMLElement>(null);
  const routeEditElements = useRef(new Map<string, HTMLButtonElement>());
  const sourceFiles = useRef(new Map<string, File>());
  const pageGeneration = useRef(0);
  const activeRouteId = useRef(id);
  activeRouteId.current = id;
  const saveBatch = useRef<SaveBatch>({
    generation: 0,
    latestSaveVersion: 0,
    queue: Promise.resolve(),
    pending: 0,
    failure: null,
  });
  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const generation = pageGeneration.current + 1;
    pageGeneration.current = generation;
    saveBatch.current = {
      generation,
      latestSaveVersion: 0,
      queue: Promise.resolve(),
      pending: 0,
      failure: null,
    };
    setGraph(undefined);
    setTemplateVersions([]);
    setActiveCategory("good");
    setMessage("");
    setSaveError("");
    setGenerationError("");
    setGenerationProgress(null);
    setIsGenerating(false);
    setGeneratedReport(null);
    setRouteSortOpen(false);
    setEditingRouteName(null);
    setEditProcessing(false);
    setEditError("");
    sourceFiles.current.clear();
    let active = true;
    inspectionRepository.getGraph(id).then(async (result) => {
      if (!active || generation !== pageGeneration.current) return;
      setGraph(result);
      if (result) {
        const versions = await templateRepository.listVersions(result.inspection.templateId);
        if (active && generation === pageGeneration.current) setTemplateVersions(versions);
      }
    });
    return () => {
      active = false;
      if (generation === pageGeneration.current) pageGeneration.current += 1;
    };
  }, [id, inspectionRepository, templateRepository]);

  const visibleGroups = useMemo(() => graph?.groups ?? [], [graph]);
  const summary = useMemo(() => buildReviewSummary(visibleGroups), [visibleGroups]);
  const errors = useMemo(() => graph ? validateReportReadiness(graph) : [], [graph]);

  async function persist(action: () => Promise<void>, next: InspectionGraph) {
    const generation = pageGeneration.current;
    const inspectionId = id;
    let batch = saveBatch.current;
    if (batch.failure) {
      batch = {
        generation,
        latestSaveVersion: batch.latestSaveVersion,
        queue: Promise.resolve(),
        pending: 0,
        failure: null,
      };
      saveBatch.current = batch;
    }
    const saveVersion = batch.latestSaveVersion + 1;
    batch.latestSaveVersion = saveVersion;
    const isCurrentSave = () =>
      batch === saveBatch.current &&
      generation === pageGeneration.current &&
      activeRouteId.current === inspectionId;
    batch.pending += 1;
    setGraph(next);
    setSaveError("");
    setGenerationError("");
    setMessage("");
    setGeneratedReport(null);
    const run = async () => {
      if (batch !== saveBatch.current || batch.failure) {
        batch.pending -= 1;
        return;
      }
      try {
        await action();
        if (batch.pending === 1 && isCurrentSave()) {
          const persisted = await inspectionRepository.getGraph(inspectionId);
          if (isCurrentSave() && batch.latestSaveVersion === saveVersion) {
            setGraph(persisted);
          }
        }
      } catch (error) {
        if (isCurrentSave()) {
          const failure = error instanceof Error ? error : new Error("????");
          batch.failure = failure;
          setSaveError(failure.message);
          const restored = await inspectionRepository.getGraph(inspectionId);
          if (isCurrentSave()) setGraph(restored);
        }
      } finally {
        batch.pending -= 1;
      }
    };
    batch.queue = batch.queue.then(run, run);
    await batch.queue;
  }

  async function refreshGraph() {
    const refreshed = await inspectionRepository.getGraph(id);
    if (activeRouteId.current === id) setGraph(refreshed);
  }

  async function saveRouteOrder(routeOrderByCategory: ReviewRouteOrderByCategory) {
    if (!graph) return;
    const next = { ...graph, inspection: { ...graph.inspection, reviewRouteOrderByCategory: routeOrderByCategory } };
    await persist(async () => {
      await inspectionRepository.updateReviewRouteOrderByCategory(id, routeOrderByCategory);
    }, next);
    setRouteSortOpen(false);
  }

  function closeRouteEditor() {
    const routeName = editingRouteName;
    setEditingRouteName(null);
    if (routeName) window.setTimeout(() => routeEditElements.current.get(routeName)?.focus(), 0);
  }

  async function saveNewEditPhoto(entryId: string, file: File, source: PhotoInputSource) {
    const processed = await processImage(file, { highQuality: false });
    const photoId = createBrowserUuid();
    const groupId = createBrowserUuid();
    const photo: PhotoAsset = {
      id: photoId,
      inspectionId: id,
      groupId,
      capturedAt: new Date().toISOString(),
      order: 0,
      ...processed,
      annotationJson: null,
    };
    await backupRepository.assertCanPersistNewPhoto();
    const result = await inspectionRepository.addPhotoToGoodGroup(entryId, photo, groupId);
    sourceFiles.current.set(result.photo.id, file);
    if (source === "camera") {
      try {
        await saveCapturedPhotoToGallery(file);
      } catch {
        setEditError("????????????????????????????????");
      }
    }
    await refreshGraph();
  }

  async function processEditFiles(entryId: string, files: File[], source: PhotoInputSource) {
    if (editProcessing) return;
    setEditProcessing(true);
    setEditError("");
    try {
      for (const file of files) await saveNewEditPhoto(entryId, file, source);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "??????");
    } finally {
      setEditProcessing(false);
    }
  }

  async function saveEditCheckSelections(entryId: string, selections: InspectionCheckSelection[]) {
    setEditError("");
    try {
      await inspectionRepository.updateEntryCheckSelections(id, entryId, selections);
      await refreshGraph();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("????????");
      setEditError(failure.message);
      throw failure;
    }
  }

  async function createEditEvaluationGroup(entryId: string, category: PhotoCategory) {
    setEditError("");
    setEditProcessing(true);
    try {
      await inspectionRepository.addEvaluationGroup(entryId, category, createBrowserUuid());
      await refreshGraph();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("??????");
      setEditError(failure.message);
      throw failure;
    } finally {
      setEditProcessing(false);
    }
  }

  async function saveEditPhotoGroup(group: PhotoGroup) {
    setEditError("");
    try {
      await inspectionRepository.updatePhotoGroup(group);
      await refreshGraph();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("??????");
      setEditError(failure.message);
      throw failure;
    }
  }

  async function splitEditPhoto(group: PhotoGroup, item: ChecklistItem, photoId: string, category: PhotoCategory) {
    setEditError("");
    try {
      const result = splitPhotoIntoGroup(group, photoId, category, item, createBrowserUuid());
      await inspectionRepository.splitPhoto(photoId, result.created);
      await refreshGraph();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("????????");
      setEditError(failure.message);
      throw failure;
    }
  }

  async function saveEditPhotoAnnotation(photo: PhotoAsset) {
    setEditError("");
    try {
      await inspectionRepository.updatePhotoAnnotation(photo.id, photo.annotationJson);
      await refreshGraph();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("????????");
      setEditError(failure.message);
      throw failure;
    }
  }

  async function deleteEditPhoto(photoId: string) {
    setEditError("");
    try {
      await inspectionRepository.deletePhoto(photoId);
      sourceFiles.current.delete(photoId);
      await refreshGraph();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "??????");
    }
  }

  async function replaceEditPhoto(
    photo: PhotoAsset,
    file: File,
    highQuality = photo.highQuality,
    copyToGallery = false,
  ) {
    setEditError("");
    setEditProcessing(true);
    try {
      const processed = await processImage(file, { highQuality });
      await inspectionRepository.replacePhoto({ ...photo, ...processed });
      sourceFiles.current.set(photo.id, file);
      if (copyToGallery) {
        try {
          await saveCapturedPhotoToGallery(file);
        } catch {
          setEditError("????????????????????????????????");
        }
      }
      await refreshGraph();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "??????");
    } finally {
      setEditProcessing(false);
    }
  }

  async function changeEditPhotoHighQuality(photo: PhotoAsset, highQuality: boolean) {
    const file = sourceFiles.current.get(photo.id);
    if (!file) {
      setEditError("???????????????????????");
      return;
    }
    await replaceEditPhoto(photo, file, highQuality);
  }

  function reorderCategory(categoryIds: string[]) {
    if (!graph) return;
    const ordered = [...graph.groups].sort((left, right) => left.order - right.order);
    let index = 0;
    const allIds = ordered.map((group) =>
      group.category === activeCategory ? categoryIds[index++] : group.id,
    );
    const rank = new Map(allIds.map((groupId, order) => [groupId, order]));
    const next: InspectionGraph = {
      ...graph,
      inspection: { ...graph.inspection, entries: graph.inspection.entries.map((entry) => ({ ...entry, groupIds: [...entry.groupIds].sort((a, b) => (rank.get(a) ?? 999999) - (rank.get(b) ?? 999999)) })) },
      groups: graph.groups.map((group) => ({ ...group, order: rank.get(group.id) ?? group.order })).sort((a, b) => a.order - b.order),
    };
    void persist(() => inspectionRepository.reorderGroups(id, allIds), next);
  }

  function moveGroupCategory(groupId: string, category: PhotoCategory) {
    if (!graph) return;
    const ordered = [...graph.groups].sort((left, right) => left.order - right.order);
    const moved = ordered.find((group) => group.id === groupId);
    if (!moved || moved.category === category) return;
    const withoutMoved = ordered.filter((group) => group.id !== groupId);
    const lastTargetIndex = withoutMoved.findLastIndex((group) => group.category === category);
    const insertionIndex = lastTargetIndex >= 0 ? lastTargetIndex + 1 : withoutMoved.length;
    const allIds = [...withoutMoved];
    allIds.splice(insertionIndex, 0, moved);
    const orderedIds = allIds.map((group) => group.id);
    const rank = new Map(orderedIds.map((currentId, order) => [currentId, order]));
    const entry = graph.inspection.entries.find((item) => item.id === moved.entryId);
    const description = entry
      ? descriptionForCategory(checklistItemForEntry(entry, graph), category)
      : moved.description;
    const next: InspectionGraph = {
      ...graph,
      inspection: {
        ...graph.inspection,
        entries: graph.inspection.entries.map((item) => ({
          ...item,
          groupIds: [...item.groupIds].sort(
            (left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
          ),
        })),
      },
      groups: graph.groups.map((group) => ({
        ...(group.id === groupId ? { ...group, category, description, awardAssessment: null } : group),
        order: rank.get(group.id) ?? group.order,
      })).sort((left, right) => left.order - right.order),
    };
    setActiveCategory(category);
    void persist(
      () => inspectionRepository.moveGroupToCategory(id, groupId, category, orderedIds),
      next,
    );
  }

  function groupDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const groupId = String(event.active.id);
    const targetCategory = event.over.data.current?.category as PhotoCategory | undefined;
    if (event.over.data.current?.type === "category" && targetCategory) {
      moveGroupCategory(groupId, targetCategory);
      return;
    }
    if (event.active.id === event.over.id) return;
    const oldIndex = activeGroups.findIndex((group) => group.id === event.active.id);
    const newIndex = activeGroups.findIndex((group) => group.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const ids = [...activeGroups];
    const [moved] = ids.splice(oldIndex, 1);
    ids.splice(newIndex, 0, moved);
    reorderCategory(ids.map((group) => group.id));
  }

  function reorderPhotos(groupId: string, photoIds: string[]) {
    if (!graph) return;
    const next: InspectionGraph = {
      ...graph,
      groups: graph.groups.map((group) => group.id === groupId ? { ...group, photoIds } : group),
      photos: graph.photos.map((photo) => photo.groupId === groupId ? { ...photo, order: photoIds.indexOf(photo.id) } : photo),
    };
    void persist(() => inspectionRepository.reorderPhotos(groupId, photoIds), next);
  }

  function saveAssessment(group: PhotoGroup, people: string, amountInput: string) {
    if (!graph) return;
    const parsedAmount = Number(amountInput);
    const amount = Number.isSafeInteger(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
    const updated = { ...group, awardAssessment: { type: "assessment" as const, people, amount } };
    const next = { ...graph, groups: graph.groups.map((item) => item.id === group.id ? updated : item) };
    void persist(() => inspectionRepository.updatePhotoGroup(updated), next);
  }

  function selectTemplate(version: number) {
    if (!graph) return;
    const template = templateVersions.find((item) => item.version === version);
    if (!template) return;
    const next: InspectionGraph = {
      ...graph,
      inspection: {
        ...graph.inspection,
        templateId: template.id,
        templateVersion: template.version,
      },
      template,
    };
    void persist(
      () => inspectionRepository.updateReviewSettings(
        id,
        template.id,
        template.version,
        graph.inspection.photoLayoutModeOverride,
        graph.inspection.photosPerRowOverride,
      ),
      next,
    );
  }

  function savePhotoLayout(mode: PhotoLayoutMode, photosPerRow: PhotosPerRow) {
    if (!graph) return;
    const next: InspectionGraph = {
      ...graph,
      inspection: {
        ...graph.inspection,
        photoLayoutModeOverride: mode,
        photosPerRowOverride: photosPerRow,
      },
    };
    void persist(
      () => inspectionRepository.updateReviewSettings(
        id,
        graph.inspection.templateId,
        graph.inspection.templateVersion,
        mode,
        photosPerRow,
      ),
      next,
    );
  }

  function focusError(error: ReportValidationError) {
    if (!graph) return;
    const group = error.groupId
      ? graph.groups.find((item) => item.id === error.groupId)
      : undefined;
    if (group) {
      setActiveCategory(group.category);
      window.setTimeout(() => groupElements.current.get(group.id)?.focus(), 0);
    } else if (error.field === "template") {
      settingsElement.current?.focus();
    } else {
      globalErrorsElement.current?.focus();
    }
  }

  function moveTabFocus(category: PhotoCategory, key: string) {
    const index = categories.findIndex((item) => item.id === category);
    let nextIndex = index;
    if (key === "ArrowRight") nextIndex = (index + 1) % categories.length;
    if (key === "ArrowLeft") nextIndex = (index - 1 + categories.length) % categories.length;
    if (key === "Home") nextIndex = 0;
    if (key === "End") nextIndex = categories.length - 1;
    const next = categories[nextIndex].id;
    setActiveCategory(next);
    window.setTimeout(() => tabElements.current.get(next)?.focus(), 0);
  }

  async function completeReview() {
    if (!graph || errors.length || isGenerating) return;
    const batch = saveBatch.current;
    const generation = pageGeneration.current;
    const inspectionId = id;
    const isCurrentCompletion = () =>
      batch === saveBatch.current &&
      generation === pageGeneration.current &&
      activeRouteId.current === inspectionId;
    await batch.queue;
    if (!isCurrentCompletion() || batch.failure) return;
    const saveVersion = batch.latestSaveVersion;
    const isCurrentGeneration = () =>
      isCurrentCompletion() && batch.latestSaveVersion === saveVersion;
    setIsGenerating(true);
    setSaveError("");
    setGenerationError("");
    setMessage("");
    setGeneratedReport(null);
    const activity = beginPhotoProcessing();
    try {
      setGenerationProgress({
        completedImages: 0,
        totalImages: graph.photos.length,
        phase: "images",
      });
      const generatedReport = await reportGenerator.generateReport(inspectionId, (progress) => {
        if (isCurrentGeneration()) setGenerationProgress(progress);
      });
      if (!isCurrentGeneration()) return;
      setGraph(generatedReport.graph);
      setGeneratedReport({ blob: generatedReport.blob, filename: generatedReport.filename });
      setGenerationProgress(null);
      setMessage("Word???????????");
    } catch (error) {
      if (!isCurrentGeneration()) return;
      const failure = error instanceof Error ? error : new Error("????");
      const restored = await inspectionRepository.getGraph(inspectionId);
      if (!isCurrentGeneration()) return;
      setGenerationError(`Word?????????${failure.message ? ` ${failure.message}` : ""}`);
      setGraph(restored);
      setGenerationProgress(null);
      setGeneratedReport(null);
    } finally {
      activity.release();
      if (isCurrentCompletion()) {
        setGenerationProgress(null);
        setIsGenerating(false);
      }
    }
  }

  async function shareGeneratedReport() {
    if (!generatedReport) return;
    const report = generatedReport;
    const batch = saveBatch.current;
    const generation = pageGeneration.current;
    const inspectionId = id;
    const isCurrentShare = () =>
      batch === saveBatch.current &&
      generation === pageGeneration.current &&
      activeRouteId.current === inspectionId &&
      generatedReport === report;
    try {
      const result = await reportGenerator.shareOrDownloadReport(
        report.blob,
        report.filename,
      );
      if (!isCurrentShare()) return;
      setMessage(result === "shared"
        ? "Word?????????????"
        : result === "cancelled"
          ? "??????Word????????"
          : "????????????????Word?");
    } catch {
      if (!isCurrentShare()) return;
      setMessage("????????????????Word?");
    }
  }

  async function downloadGeneratedReport() {
    if (!generatedReport) return;
    try {
      await reportGenerator.downloadReport(generatedReport.blob, generatedReport.filename);
      setMessage("Word?????????????????? ");
    } catch {
      setMessage("Word????????? ");
    }
  }

  if (graph === undefined) return <p className="status-message" role="status">????????...</p>;
  if (graph === null) return <p className="status-message" role="alert">????????</p>;

  const activeGroups = visibleGroups.filter((group) => group.category === activeCategory).sort((a, b) => a.order - b.order);
  const effectiveMode = graph.inspection.photoLayoutModeOverride ?? graph.template?.photoLayoutMode ?? "fixed";
  const effectiveRows = graph.inspection.photosPerRowOverride ?? graph.template?.photosPerRow ?? 3;
  const routeNames = sortRouteNamesForReview(graph);
  const routeNamesByCategory = sortRouteNamesForReviewByCategory(graph);
  const editingEntries = editingRouteName
    ? graph.inspection.entries.filter((entry) => entry.itemSnapshot.routeName === editingRouteName)
    : [];
  return (
    <section className="page-section review-page">
      <div className="section-heading"><p className="eyebrow">{graph.inspection.title}</p><h2>????</h2></div>
      <dl className="review-summary"><div><dt>??</dt><dd>{summary.totalPhotos}?</dd></div><div><dt>??</dt><dd>{summary.rewardAmount}?</dd></div><div><dt>??</dt><dd>{summary.assessmentAmount}?</dd></div></dl>
      <div ref={settingsElement} className="review-settings" data-testid="review-settings" tabIndex={-1}>
        <label className="review-template-field">??????
          <select disabled={isGenerating} className="review-template-select" aria-label="??????" value={graph.inspection.templateVersion} onChange={(event) => selectTemplate(Number(event.currentTarget.value))}>
            {(templateVersions.length > 0 ? templateVersions : graph.template ? [graph.template] : []).map((template) => (
              <option key={`${template.id}-${template.version}`} value={template.version}>{template.name} v{template.version}</option>
            ))}
            {templateVersions.length === 0 && !graph.template ? <option value={graph.inspection.templateVersion}>?? v{graph.inspection.templateVersion}</option> : null}
          </select>
        </label>
        <label>??????<select disabled={isGenerating} aria-label="??????" value={effectiveMode} onChange={(event) => savePhotoLayout(event.currentTarget.value as PhotoLayoutMode, effectiveRows)}><option value="adaptive">???</option><option value="fixed">??</option></select></label>
        <label>?????<select disabled={isGenerating} aria-label="?????" value={effectiveRows} onChange={(event) => savePhotoLayout(effectiveMode, Number(event.currentTarget.value) as PhotosPerRow)}>{PHOTO_ROW_COUNTS.map((count) => <option key={count} value={count}>{count}?</option>)}</select></label>
      </div>
      <section className="review-route-summary" aria-label="?????">
        <div className="review-route-summary__header">
          <h3>?????</h3>
          <button type="button" className="secondary-action" disabled={!routeNames.length || isGenerating} onClick={() => setRouteSortOpen(true)}>??</button>
        </div>
        <div className="review-route-summary__list">
          {routeNames.map((routeName) => (
            <button
              key={routeName}
              ref={(element) => { if (element) routeEditElements.current.set(routeName, element); else routeEditElements.current.delete(routeName); }}
              type="button"
              className="review-route-summary__item"
              aria-label={`?? ${routeName}`}
              disabled={isGenerating}
              onClick={() => { setEditError(""); setEditingRouteName(routeName); }}
            >{routeName}</button>
          ))}
        </div>
      </section>
      <DndContext sensors={groupSensors} collisionDetection={closestCenter} onDragEnd={groupDragEnd}>
        <div className="review-tabs" role="tablist" aria-label="????">
          {categories.map((category) => <CategoryTab key={category.id} category={category} count={summary.photos[category.id]} active={activeCategory === category.id} onSelect={setActiveCategory} onNavigate={moveTabFocus} register={(element) => { if (element) tabElements.current.set(category.id, element); else tabElements.current.delete(category.id); }} />)}
        </div>
        <div id="review-category-panel" role="tabpanel" aria-labelledby={`review-tab-${activeCategory}`}>
          {activeGroups.length ? <ReviewGroupList groups={activeGroups} photos={graph.photos} entries={graph.inspection.entries} errors={errors} registerGroup={(groupId, element) => { if (element) groupElements.current.set(groupId, element); else groupElements.current.delete(groupId); }} onGroupReorder={reorderCategory} onPhotoReorder={reorderPhotos} onAssessmentChange={saveAssessment} /> : <p className="empty-state">????????</p>}
        </div>
      </DndContext>
      {errors.length ? <section ref={globalErrorsElement} className="review-errors" aria-label="????" tabIndex={-1}><h3>?????</h3>{errors.map((item, index) => <button type="button" key={`${item.code}-${item.groupId}-${index}`} onClick={() => focusError(item)}>{item.message}</button>)}</section> : null}
      {saveError ? <p className="inline-error" role="alert">{saveError}</p> : null}
      {generationError ? <p className="inline-error" role="alert">{generationError}</p> : null}
      {generationProgress ? <p className="report-progress" role="status">{generationProgress.phase === "images" ? `?????? ${generationProgress.completedImages}/${generationProgress.totalImages}` : generationProgress.phase === "document" ? "??????" : "??????"}</p> : null}
      <div className="review-command">
        <button type="button" className="primary-action" disabled={errors.length > 0 || Boolean(saveError) || isGenerating} onClick={() => void completeReview()}>{isGenerating ? "????" : "??Word"}</button>
        {generatedReport ? <button type="button" className="secondary-action" onClick={() => void shareGeneratedReport()}><Share2 aria-hidden="true" size={18} />??Word</button> : null}
        {generatedReport ? <button type="button" className="secondary-action" onClick={() => void downloadGeneratedReport()}><Download aria-hidden="true" size={18} />??Word</button> : null}
        {errors[0] ? <span className="inline-error">{errors[0].message}</span> : null}
      </div>
      {message ? <p className="status-message" role="status">{message}</p> : null}
      {routeSortOpen ? <ReviewRouteSortDialog routeNamesByCategory={routeNamesByCategory} onSave={saveRouteOrder} onCancel={() => setRouteSortOpen(false)} /> : null}
      {editingRouteName ? (
        <ReviewRouteEditDialog routeName={editingRouteName} onClose={closeRouteEditor}>
          {editError ? <p className="inline-error" role="alert">{editError}</p> : null}
          <ul className="inspection-entry-list review-route-edit-dialog__entries">
            {editingEntries.map((entry) => {
              const checklistItem = checklistItemForEntry(entry, graph);
              return (
                <InspectionEntryEditor
                  key={entry.id}
                  entry={entry}
                  groups={graph.groups.filter((group) => group.entryId === entry.id)}
                  photos={graph.photos}
                  checklistItem={checklistItem}
                  disabled={editProcessing}
                  onFilesSelected={(files, source) => void processEditFiles(entry.id, files, source)}
                  onSaveCheckSelections={(selections) => saveEditCheckSelections(entry.id, selections)}
                  onCreatePhotoGroup={(category) => createEditEvaluationGroup(entry.id, category)}
                  onSavePhotoGroup={saveEditPhotoGroup}
                  onSplit={(group, photoId, category) => splitEditPhoto(group, checklistItem, photoId, category)}
                  onPhotoSave={saveEditPhotoAnnotation}
                  onDeletePhoto={(photoId) => void deleteEditPhoto(photoId)}
                  onReplacePhoto={(photo, file, source) => void replaceEditPhoto(photo, file, photo.highQuality, source === "camera")}
                  onHighQualityChange={(photo, highQuality) => void changeEditPhotoHighQuality(photo, highQuality)}
                />
              );
            })}
          </ul>
        </ReviewRouteEditDialog>
      ) : null}
    </section>
  );
}

function CategoryTab({ category, count, active, onSelect, onNavigate, register }: {
  category: { id: PhotoCategory; label: string };
  count: number;
  active: boolean;
  onSelect(category: PhotoCategory): void;
  onNavigate(category: PhotoCategory, key: string): void;
  register(element: HTMLButtonElement | null): void;
}) {
  const droppable = useDroppable({
    id: `category-${category.id}`,
    data: { type: "category", category: category.id },
  });
  return (
    <button
      ref={(element) => { droppable.setNodeRef(element); register(element); }}
      id={`review-tab-${category.id}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="review-category-panel"
      tabIndex={active ? 0 : -1}
      data-drop-active={droppable.isOver || undefined}
      onClick={() => onSelect(category.id)}
      onKeyDown={(event) => {
        if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          onNavigate(category.id, event.key);
        }
      }}
    >
      {category.label} {count}?
    </button>
  );
}
