import type { InspectionGraph } from "../../domain/models";
import type { InspectionRepository } from "../../db/inspectionRepository";
import type { ReportProgress } from "./generateDocx";
import type { ReportModel } from "./reportModel";

export interface ReportPackager {
  buildReportModel(graph: InspectionGraph, template: NonNullable<InspectionGraph["template"]>): ReportModel;
  generateDocx(
    model: ReportModel,
    onProgress: (progress: ReportProgress) => void,
  ): Promise<Blob>;
  buildReportFilename(date: string): string;
}

export interface GeneratedReport {
  graph: InspectionGraph;
  blob: Blob;
  filename: string;
}

export async function generateInspectionReport(
  repository: Pick<InspectionRepository, "getReadyGraphForGeneration" | "markGeneratedAfterPackaging">,
  packager: ReportPackager,
  inspectionId: string,
  onProgress: (progress: ReportProgress) => void,
): Promise<GeneratedReport> {
  const readyGraph = await repository.getReadyGraphForGeneration(inspectionId);
  if (!readyGraph.template) throw new Error("巡检引用的报告模板版本不存在。");
  const model = packager.buildReportModel(readyGraph, readyGraph.template);
  const blob = await packager.generateDocx(model, onProgress);
  const graph = await repository.markGeneratedAfterPackaging(inspectionId, readyGraph, blob);
  return {
    graph,
    blob,
    filename: packager.buildReportFilename(graph.inspection.inspectionDate),
  };
}
