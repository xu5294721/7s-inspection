import { ChevronDown, ChevronUp, ClipboardCheck, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppDependencies } from "../../app/useAppDependencies";
import type { PhotoAppendResult } from "../../db/inspectionRepository";
import type {
  ChecklistItem,
  InspectionCheckSelection,
  InspectionEntry,
  InspectionGraph,
  PhotoAsset,
  PhotoCategory,
  PhotoGroup,
} from "../../domain/models";
import { splitPhotoIntoGroup } from "../../domain/inspection";
import { createBrowserUuid } from "../../lib/ids";
import { processImage } from "../../lib/images/compressImage";
import {
  beginPhotoProcessing,
  type PhotoProcessingActivity,
} from "../../app/photoProcessingSignal";
import { CustomRouteDialog } from "./CustomRouteDialog";
import { InspectionEntryEditor } from "./InspectionEntryEditor";
import {
  formatInspectionCheckSummary,
} from "../../domain/inspectionCheckContents";

function matchesSearch(entry: InspectionEntry, query: string): boolean {
  const item = entry.itemSnapshot;
  return [
    item.routeName,
    item.area,
    item.device,
    item.part,
    item.standard,
    formatInspectionCheckSummary(entry.checkSelections ?? []),
    ...entry.checkSelections.map((selection) => selection.value),
  ]
    .join("\n")
    .toLocaleLowerCase("zh-CN")
    .includes(query.toLocaleLowerCase("zh-CN"));
}

function routeIsComplete(entries: InspectionEntry[], groups: PhotoGroup[]): boolean {
  return entries.length > 0 && entries.every((entry) =>
    entry.checkSelections.length > 0 && groups.some(
      (group) => group.entryId === entry.id && group.photoIds.length > 0,
    ));
}

interface FailedPhoto {
  id: string;
  entryId: string;
  file: File;
  message: string;
}

interface PhotoOperation {
  controller: AbortController;
  generation: number;
  inspectionId: string;
  activity: PhotoProcessingActivity;
}

function abortError(): DOMException {
  return new DOMException("照片处理已取消", "AbortError");
}

function isCurrentInspectionRoute(inspectionId: string): boolean {
  return window.location.hash.split("?")[0] === `#/inspections/${inspectionId}`;
}

function appendPhotoToGraph(
  graph: InspectionGraph,
  result: PhotoAppendResult,
): InspectionGraph {
  return {
    ...graph,
    inspection: {
      ...graph.inspection,
      entries: graph.inspection.entries.map((entry) =>
        entry.id === result.entry.id ? result.entry : entry),
    },
    groups: graph.groups.some((group) => group.id === result.group.id)
      ? graph.groups.map((group) => group.id === result.group.id ? result.group : group)
      : [...graph.groups, result.group],
    photos: [...graph.photos, result.photo],
  };
}

function replacePhotoInGraph(graph: InspectionGraph, photo: PhotoAsset): InspectionGraph {
  return {
    ...graph,
    photos: graph.photos.map((current) => current.id === photo.id ? photo : current),
  };
}

function deletePhotoFromGraph(graph: InspectionGraph, photoId: string): InspectionGraph {
  const photo = graph.photos.find((current) => current.id === photoId);
  if (!photo) return graph;
  const group = graph.groups.find((current) => current.id === photo.groupId);
  if (!group) return { ...graph, photos: graph.photos.filter((current) => current.id !== photoId) };
  const remainingIds = group.photoIds.filter((id) => id !== photoId);
  const remainingOrder = new Map(remainingIds.map((id, order) => [id, order]));
  const removesGroup = remainingIds.length === 0;
  return {
    ...graph,
    inspection: removesGroup ? {
      ...graph.inspection,
      entries: graph.inspection.entries.map((entry) => entry.id === group.entryId ? {
        ...entry,
        groupIds: entry.groupIds.filter((id) => id !== group.id),
      } : entry),
    } : graph.inspection,
    groups: removesGroup
      ? graph.groups.filter((current) => current.id !== group.id)
      : graph.groups.map((current) => current.id === group.id
        ? { ...current, photoIds: remainingIds }
        : current),
    photos: graph.photos
      .filter((current) => current.id !== photoId)
      .map((current) => current.groupId === group.id
        ? { ...current, order: remainingOrder.get(current.id) ?? current.order }
        : current),
  };
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

function replaceGroupInGraph(graph: InspectionGraph, group: PhotoGroup): InspectionGraph {
  return {
    ...graph,
    groups: graph.groups.map((current) => current.id === group.id ? group : current),
  };
}

function splitPhotoInGraph(
  graph: InspectionGraph,
  source: PhotoGroup,
  created: PhotoGroup,
  photoId: string,
): InspectionGraph {
  const sourceOrder = new Map(source.photoIds.map((id, order) => [id, order]));
  const entry = graph.inspection.entries.find((current) => current.id === source.entryId);
  const groupIds = entry ? [...entry.groupIds] : [source.id];
  const entrySourceIndex = groupIds.indexOf(source.id);
  groupIds.splice(entrySourceIndex + 1, 0, created.id);
  const groupOrder = new Map(groupIds.map((id, order) => [id, order]));
  const sourceIndex = graph.groups.findIndex((group) => group.id === source.id);
  const groups = graph.groups.filter((group) => group.id !== source.id);
  groups.splice(Math.max(0, sourceIndex), 0, source, created);
  return {
    ...graph,
    inspection: {
      ...graph.inspection,
      entries: graph.inspection.entries.map((entry) => {
        if (entry.id !== source.entryId) return entry;
        return { ...entry, groupIds };
      }),
    },
    groups: groups.map((group) => group.entryId === source.entryId
      ? { ...group, order: groupOrder.get(group.id) ?? group.order }
      : group),
    photos: graph.photos.map((photo) => {
      if (photo.id === photoId) return { ...photo, groupId: created.id, order: 0 };
      if (photo.groupId === source.id) {
        return { ...photo, order: sourceOrder.get(photo.id) ?? photo.order };
      }
      return photo;
    }),
  };
}

export function InspectionPage() {
  const { id = "" } = useParams();
  const currentInspectionId = useRef(id);
  currentInspectionId.current = id;
  const navigate = useNavigate();
  const { backupRepository, inspectionRepository } = useAppDependencies();
  const [graph, setGraph] = useState<InspectionGraph | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<FailedPhoto[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [expandedRouteName, setExpandedRouteName] = useState<string | null>(null);
  const [temporaryDialogOpen, setTemporaryDialogOpen] = useState(false);
  const [temporarySaving, setTemporarySaving] = useState(false);
  const [savingEntryIds, setSavingEntryIds] = useState<Set<string>>(() => new Set());
  const temporaryOpenerRef = useRef<HTMLButtonElement>(null);
  const sourceFiles = useRef(new Map<string, File>());
  const inspectionGeneration = useRef(0);
  const activeOperation = useRef<PhotoOperation | null>(null);

  useEffect(() => {
    const generation = inspectionGeneration.current + 1;
    inspectionGeneration.current = generation;
    activeOperation.current?.controller.abort();
    activeOperation.current?.activity.release();
    activeOperation.current = null;
    sourceFiles.current.clear();
    const inspectionSourceFiles = sourceFiles.current;
    setGraph(undefined);
    setProcessing(false);
    setProgress(null);
    setFailedPhotos([]);
    setPhotoError("");
    setExpandedRouteName(null);
    setTemporaryDialogOpen(false);
    setTemporarySaving(false);
    setSavingEntryIds(new Set());
    let active = true;
    inspectionRepository.getGraph(id).then(
      (result) => active && generation === inspectionGeneration.current && setGraph(result),
      () => active && generation === inspectionGeneration.current && setGraph(null),
    );
    return () => {
      active = false;
      if (generation === inspectionGeneration.current) {
        inspectionGeneration.current += 1;
        activeOperation.current?.controller.abort();
        activeOperation.current?.activity.release();
        activeOperation.current = null;
        inspectionSourceFiles.clear();
      }
    };
  }, [id, inspectionRepository]);

  function beginOperation(): PhotoOperation {
    activeOperation.current?.controller.abort();
    activeOperation.current?.activity.release();
    const operation = {
      controller: new AbortController(),
      generation: inspectionGeneration.current,
      inspectionId: id,
      activity: beginPhotoProcessing(),
    };
    activeOperation.current = operation;
    setProcessing(true);
    return operation;
  }

  function isCurrent(operation: PhotoOperation): boolean {
    return !operation.controller.signal.aborted &&
      operation.generation === inspectionGeneration.current &&
      operation.inspectionId === id &&
      activeOperation.current === operation;
  }

  function requireCurrent(operation: PhotoOperation): void {
    if (!isCurrent(operation)) throw abortError();
  }

  function finishOperation(operation: PhotoOperation): void {
    operation.activity.release();
    if (!isCurrent(operation)) return;
    activeOperation.current = null;
    setProcessing(false);
  }

  async function saveNewPhoto(
    operation: PhotoOperation,
    entryId: string,
    file: File,
    highQuality = false,
  ) {
    const processed = await processImage(file, {
      highQuality,
      signal: operation.controller.signal,
    });
    requireCurrent(operation);
    const photoId = createBrowserUuid();
    const groupId = createBrowserUuid();
    const photo: PhotoAsset = {
      id: photoId,
      inspectionId: operation.inspectionId,
      groupId,
      capturedAt: new Date().toISOString(),
      order: 0,
      ...processed,
      annotationJson: null,
    };
    await backupRepository.assertCanPersistNewPhoto();
    requireCurrent(operation);
    const result = await inspectionRepository.addPhotoToGoodGroup(entryId, photo, groupId);
    requireCurrent(operation);
    sourceFiles.current.set(result.photo.id, file);
    setGraph((current) => current && current.inspection.id === operation.inspectionId
      ? appendPhotoToGraph(current, result)
      : current);
  }

  async function processFiles(entryId: string, files: File[]) {
    const operation = beginOperation();
    setPhotoError("");
    setProgress({ done: 0, total: files.length });
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        try {
          await saveNewPhoto(operation, entryId, file);
        } catch (error) {
          if (!isCurrent(operation)) break;
          const message = error instanceof Error ? error.message : "照片处理失败";
          setFailedPhotos((current) => [
            ...current,
            { id: createBrowserUuid(), entryId, file, message },
          ]);
        }
        if (!isCurrent(operation)) break;
        setProgress({ done: index + 1, total: files.length });
      }
    } finally {
      finishOperation(operation);
    }
  }

  async function retryPhoto(failed: FailedPhoto) {
    const operation = beginOperation();
    setPhotoError("");
    setProgress({ done: 0, total: 1 });
    try {
      try {
        await saveNewPhoto(operation, failed.entryId, failed.file);
        requireCurrent(operation);
        setFailedPhotos((current) => current.filter((item) => item.id !== failed.id));
      } catch (error) {
        if (!isCurrent(operation)) return;
        const message = error instanceof Error ? error.message : "照片处理失败";
        setFailedPhotos((current) => current.map((item) =>
          item.id === failed.id ? { ...item, message } : item,
        ));
      }
      if (!isCurrent(operation)) return;
      setProgress({ done: 1, total: 1 });
    } finally {
      finishOperation(operation);
    }
  }

  async function replacePhoto(photo: PhotoAsset, file: File, highQuality = photo.highQuality) {
    const operation = beginOperation();
    setPhotoError("");
    try {
      const processed = await processImage(file, {
        highQuality,
        signal: operation.controller.signal,
      });
      requireCurrent(operation);
      const replacement = { ...photo, ...processed };
      await inspectionRepository.replacePhoto(replacement);
      requireCurrent(operation);
      sourceFiles.current.set(photo.id, file);
      setGraph((current) => current && current.inspection.id === operation.inspectionId
        ? replacePhotoInGraph(current, replacement)
        : current);
    } catch (error) {
      if (!isCurrent(operation)) return;
      setPhotoError(error instanceof Error ? error.message : "照片处理失败");
    } finally {
      finishOperation(operation);
    }
  }

  async function changeHighQuality(photo: PhotoAsset, highQuality: boolean) {
    const file = sourceFiles.current.get(photo.id);
    if (!file) {
      setPhotoError("原图已不在当前页面，请通过替换或重拍重新选择。");
      return;
    }
    await replacePhoto(photo, file, highQuality);
  }

  async function deletePhoto(photoId: string) {
    const operation = beginOperation();
    setPhotoError("");
    try {
      await inspectionRepository.deletePhoto(photoId);
      requireCurrent(operation);
      sourceFiles.current.delete(photoId);
      setGraph((current) => current && current.inspection.id === operation.inspectionId
        ? deletePhotoFromGraph(current, photoId)
        : current);
    } catch (error) {
      if (isCurrent(operation)) {
        setPhotoError(error instanceof Error ? error.message : "照片删除失败");
      }
    } finally {
      finishOperation(operation);
    }
  }

  async function savePhotoGroup(group: PhotoGroup) {
    setPhotoError("");
    try {
      await inspectionRepository.updatePhotoGroup(group);
      setGraph((current) => current && current.inspection.id === group.inspectionId
        ? replaceGroupInGraph(current, group)
        : current);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "评价保存失败");
      throw error;
    }
  }

  async function splitGroupPhoto(
    group: PhotoGroup,
    item: ChecklistItem,
    photoId: string,
    category: PhotoCategory,
  ) {
    setPhotoError("");
    const result = splitPhotoIntoGroup(
      group,
      photoId,
      category,
      item,
      createBrowserUuid(),
    );
    try {
      await inspectionRepository.splitPhoto(photoId, result.created);
      setGraph((current) => current && current.inspection.id === group.inspectionId
        ? splitPhotoInGraph(current, result.source, result.created, photoId)
        : current);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "照片分类调整失败");
      throw error;
    }
  }

  async function savePhotoAnnotation(photo: PhotoAsset) {
    setPhotoError("");
    try {
      await inspectionRepository.updatePhotoAnnotation(photo.id, photo.annotationJson);
      setGraph((current) => current && current.inspection.id === photo.inspectionId
        ? replacePhotoInGraph(current, photo)
        : current);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "照片标注保存失败");
      throw error;
    }
  }

  async function addTemporaryEntry(name: string) {
    if (temporarySaving) return;
    const generation = inspectionGeneration.current;
    const inspectionId = id;
    setTemporarySaving(true);
    try {
      const result = await inspectionRepository.addTemporaryEntry(
        inspectionId,
        name,
        `temporary-entry-${createBrowserUuid()}`,
        `temporary-item-${createBrowserUuid()}`,
      );
      if (
        generation !== inspectionGeneration.current ||
        inspectionId !== currentInspectionId.current ||
        !isCurrentInspectionRoute(inspectionId)
      ) return;
      setGraph((current) => {
        if (!current || current.inspection.id !== inspectionId) return current;
        if (current.inspection.entries.some((entry) => entry.id === result.entry.id)) return current;
        return {
          ...current,
          inspection: {
            ...current.inspection,
            status: "draft",
            updatedAt: result.updatedAt,
            entries: [...current.inspection.entries, result.entry],
          },
        };
      });
      setExpandedRouteName(result.entry.itemSnapshot.routeName);
      setQuery("");
      setTemporaryDialogOpen(false);
    } finally {
      if (
        generation === inspectionGeneration.current &&
        inspectionId === currentInspectionId.current &&
        isCurrentInspectionRoute(inspectionId)
      ) {
        setTemporarySaving(false);
      }
    }
  }

  async function saveEntryCheckSelections(
    entryId: string,
    selections: InspectionCheckSelection[],
  ) {
    if (processing || savingEntryIds.has(entryId)) return;
    const generation = inspectionGeneration.current;
    const inspectionId = id;
    setSavingEntryIds((current) => new Set(current).add(entryId));
    try {
      const result = await inspectionRepository.updateEntryCheckSelections(
        inspectionId,
        entryId,
        selections,
      );
      if (
        generation !== inspectionGeneration.current ||
        inspectionId !== currentInspectionId.current ||
        !isCurrentInspectionRoute(inspectionId)
      ) return;
      setGraph((current) => {
        if (!current || current.inspection.id !== inspectionId) return current;
        return {
          ...current,
          inspection: {
            ...current.inspection,
            status: "draft",
            updatedAt: result.updatedAt,
            entries: current.inspection.entries.map((entry) =>
              entry.id === entryId ? result.entry : entry),
          },
        };
      });
    } finally {
      if (
        generation === inspectionGeneration.current &&
        inspectionId === currentInspectionId.current &&
        isCurrentInspectionRoute(inspectionId)
      ) {
        setSavingEntryIds((current) => {
          const next = new Set(current);
          next.delete(entryId);
          return next;
        });
      }
    }
  }

  const routes = useMemo(() => {
    const grouped = new Map<string, Map<string, InspectionEntry[]>>();
    if (!graph) return grouped;
    for (const entry of graph.inspection.entries.filter((item) => matchesSearch(item, query))) {
      const route = grouped.get(entry.itemSnapshot.routeName) ?? new Map();
      const area = entry.itemSnapshot.area || entry.itemSnapshot.device || "未标注区域";
      const areaEntries = route.get(area) ?? [];
      areaEntries.push(entry);
      route.set(area, areaEntries);
      grouped.set(entry.itemSnapshot.routeName, route);
    }
    return grouped;
  }, [graph, query]);

  if (graph === undefined) return <p className="status-message" role="status">正在读取巡检草稿...</p>;
  if (graph === null) return <p className="status-message" role="alert">未找到巡检记录。</p>;

  return (
    <section className="page-section inspection-page">
      <div className="section-heading inspection-title">
        <p className="eyebrow">巡检草稿</p>
        <h2>{graph.inspection.title}</h2>
      </div>
      <div className="inspection-search-toolbar">
        <label className="search-control">
          <Search aria-hidden="true" size={19} />
          <span className="sr-only">搜索巡检项点</span>
          <input
            type="search"
            aria-label="搜索巡检项点"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索路线、区域、设备、部位或标准"
          />
        </label>
        <button
          ref={temporaryOpenerRef}
          type="button"
          className="secondary-action"
          disabled={processing || temporarySaving || temporaryDialogOpen}
          onClick={() => setTemporaryDialogOpen(true)}
        >
          <Plus aria-hidden="true" size={18} />
          新增检查项
        </button>
      </div>
      {progress ? <p className="photo-progress" role="status">已处理 {progress.done}/{progress.total}</p> : null}
      {photoError ? <p className="inline-error" role="alert">{photoError}</p> : null}
      {failedPhotos.length > 0 ? (
        <ul className="failed-photo-list">
          {failedPhotos.map((failed) => (
            <li key={failed.id}>
              <span>{failed.file.name}：{failed.message}</span>
              <button
                type="button"
                disabled={processing}
                aria-label={`重试 ${failed.file.name}`}
                onClick={() => void retryPhoto(failed)}
              >
                重试
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {routes.size === 0 ? <p className="empty-state">没有匹配的巡检项点。</p> : null}
      {Array.from(routes, ([routeName, areas]) => {
        const entries = Array.from(areas.values()).flat();
        const isExpanded = expandedRouteName === routeName;
        const isComplete = routeIsComplete(entries, graph.groups);
        const panelId = `inspection-route-panel-${entries[0]?.id ?? routeName}`;
        return (
          <section
            className={`inspection-route${isExpanded ? " is-expanded" : ""}${isComplete ? " is-complete" : ""}`}
            key={routeName}
            data-route-name={routeName}
          >
            <h3>
              <button
                type="button"
                className="inspection-route__toggle"
                aria-expanded={isExpanded}
                aria-controls={panelId}
                data-complete={isComplete}
                onClick={() => setExpandedRouteName((current) => current === routeName ? null : routeName)}
              >
                <span>{routeName}</span>
                <span className="inspection-route__status" aria-hidden="true">{isComplete ? "已检查" : "未完成"}</span>
                {isExpanded ? <ChevronUp aria-hidden="true" size={19} /> : <ChevronDown aria-hidden="true" size={19} />}
              </button>
            </h3>
            {isExpanded ? (
              <div id={panelId} className="inspection-route__panel">
                {Array.from(areas, ([area, areaEntries]) => (
                  <div className="inspection-area" key={area}>
                    <h4>{area}</h4>
                    <ul className="inspection-entry-list">
                      {areaEntries.map((entry) => {
                        const groups = graph.groups.filter((group) => group.entryId === entry.id);
                        const checklistItem = checklistItemForEntry(entry, graph);
                        return (
                          <InspectionEntryEditor
                            key={entry.id}
                            entry={entry}
                            groups={groups}
                            photos={graph.photos}
                            checklistItem={checklistItem}
                            disabled={processing || savingEntryIds.has(entry.id)}
                            onFilesSelected={(files) => void processFiles(entry.id, files)}
                            onSaveCheckSelections={(selections) => saveEntryCheckSelections(entry.id, selections)}
                            onSavePhotoGroup={savePhotoGroup}
                            onSplit={(group, photoId, category) =>
                              splitGroupPhoto(group, checklistItem, photoId, category)}
                            onPhotoSave={savePhotoAnnotation}
                            onDeletePhoto={(photoId) => void deletePhoto(photoId)}
                            onReplacePhoto={(photo, file) => void replacePhoto(photo, file)}
                            onHighQualityChange={(photo, highQuality) =>
                              void changeHighQuality(photo, highQuality)}
                          />
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      <div className="page-actions inspection-review-command">
        <button
          type="button"
          className="primary-action"
          disabled={processing}
          onClick={() => navigate(`/inspections/${id}/review`)}
        >
          <ClipboardCheck aria-hidden="true" size={19} />
          完成检查，进入复核
        </button>
      </div>
      {temporaryDialogOpen ? (
        <CustomRouteDialog
          openerRef={temporaryOpenerRef}
          title="新增本次检查项"
          fieldLabel="检查项名称"
          onCancel={() => {
            if (!temporarySaving) setTemporaryDialogOpen(false);
          }}
          onSave={addTemporaryEntry}
        />
      ) : null}
    </section>
  );
}
