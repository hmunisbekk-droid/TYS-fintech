// Gradient-boosted tree inference in the browser (XGBoost JSON dump) + one-at-a-time attributions.
import { FEATURE_NAMES, type FeatureName, type Features, featureVector } from "./features";

interface XgbNode {
  nodeid: number; depth?: number; split?: string; split_condition?: number; yes?: number; no?: number;
  missing?: number; children?: XgbNode[]; leaf?: number;
}
export interface RiskModel {
  feature_names: string[]; base_margin: number; n_trees: number; trees: XgbNode[]; objective: string; version: string;
}
export interface FeatureStats { [k: string]: { median: number; p5: number; p95: number; mean: number } }

function evalTree(node: XgbNode, x: number[], names: string[]): number {
  let n = node;
  for (;;) {
    if (n.leaf !== undefined) return n.leaf;
    const fi = n.split!.startsWith("f") && !names.includes(n.split!) ? Number(n.split!.slice(1)) : names.indexOf(n.split!);
    const v = x[fi];
    let next: number;
    if (v === undefined || Number.isNaN(v)) next = n.missing!;
    else next = v < n.split_condition! ? n.yes! : n.no!;
    const child = n.children!.find((c) => c.nodeid === next);
    if (!child) throw new Error("bad tree");
    n = child;
  }
}

export function predictMargin(model: RiskModel, x: number[]): number {
  let m = model.base_margin;
  for (const t of model.trees) m += evalTree(t, x, model.feature_names);
  return m;
}
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function predictProbability(model: RiskModel, f: Features): number {
  return sigmoid(predictMargin(model, featureVector(f)));
}

export interface Attribution { feature: FeatureName; value: number; reference: number; deltaMargin: number; deltaProb: number }

/**
 * One-at-a-time attribution: replace each feature with the population median and measure the change in
 * the predicted probability. Transparent and cheap; the production design uses SHAP (TreeExplainer) on the server.
 */
export function attributions(model: RiskModel, f: Features, stats: FeatureStats): Attribution[] {
  const x = featureVector(f);
  const p0 = sigmoid(predictMargin(model, x));
  const m0 = predictMargin(model, x);
  const out: Attribution[] = [];
  FEATURE_NAMES.forEach((name, i) => {
    const ref = stats[name]?.median ?? 0;
    const x2 = [...x]; x2[i] = ref;
    const m2 = predictMargin(model, x2);
    out.push({ feature: name, value: x[i], reference: ref, deltaMargin: m0 - m2, deltaProb: p0 - sigmoid(m2) });
  });
  return out.sort((a, b) => Math.abs(b.deltaProb) - Math.abs(a.deltaProb));
}

export function riskBand(p: number): { band: "low" | "medium" | "high"; label: string } {
  if (p < 0.15) return { band: "low", label: "Low" };
  if (p < 0.4) return { band: "medium", label: "Elevated" };
  return { band: "high", label: "High" };
}
