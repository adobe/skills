"use strict";
window.__visualTree = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/content/visual-tree.ts
  var visual_tree_exports = {};
  __export(visual_tree_exports, {
    assignPositionalIds: () => assignPositionalIds,
    captureVisualTree: () => captureVisualTree,
    collapseSingleChildren: () => collapseSingleChildren,
    deltaE: () => deltaE,
    detectRootBackground: () => detectRootBackground,
    enrichOverlayMetadata: () => enrichOverlayMetadata,
    formatTreeAsText: () => formatTreeAsText,
    isContainedIn: () => isContainedIn,
    isDefaultBackground: () => isDefaultBackground,
    parseRgb: () => parseRgb,
    promoteEscapedNodes: () => promoteEscapedNodes,
    pruneZeroHeightLeaves: () => pruneZeroHeightLeaves,
    resolvePageBackground: () => resolvePageBackground,
    rgbToLab: () => rgbToLab
  });

  // src/content/css-selector.ts
  function getCssSelector(element, options = {}) {
    const { optimized = true } = options;
    if (!(element instanceof Element)) {
      return "";
    }
    const steps = [];
    let currentElement = element;
    while (currentElement) {
      const step = getCssSelectorStep(currentElement, optimized, currentElement === element);
      if (!step) {
        break;
      }
      steps.push(step);
      if (step.optimized) {
        break;
      }
      currentElement = currentElement.parentElement;
    }
    steps.reverse();
    return steps.map((s) => s.value).join(" > ");
  }
  function getCssSelectorStep(element, optimized, isTargetNode) {
    if (!(element instanceof Element)) {
      return null;
    }
    const id = element.id;
    const nodeName = element.localName;
    if (optimized && id) {
      return { value: idSelector(id), optimized: true };
    }
    if (optimized && (nodeName === "body" || nodeName === "head" || nodeName === "html")) {
      return { value: nodeName, optimized: true };
    }
    if (id) {
      return { value: nodeName + idSelector(id), optimized: true };
    }
    const parent = element.parentElement;
    if (!parent || element.parentNode === document) {
      return { value: nodeName, optimized: true };
    }
    const ownClassNames = getClassNames(element);
    let needsClassNames = false;
    let needsNthChild = false;
    let ownIndex = -1;
    let elementIndex = -1;
    const siblings = parent.children;
    for (let i = 0; i < siblings.length && (ownIndex === -1 || !needsNthChild); i++) {
      const sibling = siblings[i];
      elementIndex++;
      if (sibling === element) {
        ownIndex = elementIndex;
        continue;
      }
      if (needsNthChild) {
        continue;
      }
      if (sibling.localName !== nodeName) {
        continue;
      }
      needsClassNames = true;
      if (ownClassNames.length === 0) {
        needsNthChild = true;
        continue;
      }
      const siblingClassNames = new Set(getClassNames(sibling));
      const uniqueClasses = ownClassNames.filter((c) => !siblingClassNames.has(c));
      if (uniqueClasses.length === 0) {
        needsNthChild = true;
      }
    }
    let result = nodeName;
    if (isTargetNode && nodeName === "input" && element.getAttribute("type") && !id && ownClassNames.length === 0) {
      result += "[type=" + CSS.escape(element.getAttribute("type")) + "]";
    }
    if (needsNthChild) {
      result += ":nth-child(" + (ownIndex + 1) + ")";
    } else if (needsClassNames && ownClassNames.length > 0) {
      for (const className of ownClassNames) {
        result += "." + CSS.escape(className);
      }
    }
    return { value: result, optimized: false };
  }
  function getClassNames(element) {
    const classAttr = element.getAttribute("class");
    if (!classAttr) {
      return [];
    }
    return classAttr.split(/\s+/).filter(Boolean);
  }
  function idSelector(id) {
    return "#" + CSS.escape(id);
  }

  // src/content/layout-detection.ts
  function detectLayout(boxes) {
    if (boxes.length < 2) return void 0;
    if (hasSignificantOverlap(boxes)) return void 0;
    const sorted = [...boxes].sort((a, b) => a.y - b.y);
    const minHeight = Math.min(...sorted.map((b) => b.height));
    const tolerance = minHeight * 0.5;
    const rows = [];
    let currentRow = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].y - currentRow[0].y) <= tolerance) {
        currentRow.push(sorted[i]);
      } else {
        rows.push(currentRow);
        currentRow = [sorted[i]];
      }
    }
    rows.push(currentRow);
    const maxCols = Math.max(...rows.map((r) => r.length));
    if (maxCols < 2) return void 0;
    return `${maxCols}x${rows.length}`;
  }
  function hasSignificantOverlap(boxes) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const overlapArea = getOverlapArea(boxes[i], boxes[j]);
        const smallerArea = Math.min(
          boxes[i].width * boxes[i].height,
          boxes[j].width * boxes[j].height
        );
        if (smallerArea > 0 && overlapArea / smallerArea > 0.5) {
          return true;
        }
      }
    }
    return false;
  }
  function getOverlapArea(a, b) {
    const xOverlap = Math.max(
      0,
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    );
    const yOverlap = Math.max(
      0,
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    );
    return xOverlap * yOverlap;
  }

  // src/content/visual-tree.ts
  function isDefaultBackground(bg) {
    if (bg.type !== "color") return false;
    const v = bg.value;
    return v === "rgba(0, 0, 0, 0)" || v === "transparent" || v === "rgb(255, 255, 255)";
  }
  function resolvePageBackground(treeRootBg, directDetectionBg) {
    if (treeRootBg && !isDefaultBackground(treeRootBg)) {
      return treeRootBg;
    }
    return directDetectionBg;
  }
  function detectRootBackground() {
    const elements = [document.body, document.documentElement];
    for (const el of elements) {
      const style = window.getComputedStyle(el);
      const bgImage = style.backgroundImage;
      const bgColor = style.backgroundColor;
      const bgRaw = style.background;
      if (bgImage && bgImage !== "none") {
        if (bgImage.includes("gradient(")) {
          return {
            type: "gradient",
            value: bgImage,
            raw: bgRaw,
            source: "css"
          };
        }
        if (bgImage.includes("url(")) {
          const url = bgImage.match(/url\(["']?(.+?)["']?\)/)?.[1] ?? bgImage;
          return {
            type: "image",
            value: url,
            raw: bgRaw,
            source: "css"
          };
        }
      }
      if (bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent" && bgColor !== "rgb(255, 255, 255)") {
        return {
          type: "color",
          value: bgColor,
          raw: bgRaw,
          source: "css"
        };
      }
    }
    return void 0;
  }
  function captureVisualTree(minWidth = 900) {
    const root = buildVisualNode(document.body, minWidth);
    collapseSingleChildren(root);
    pruneZeroHeightLeaves(root);
    const promotedToRoot = promoteEscapedNodes(root);
    const nodeMap = {};
    assignPositionalIds(root, "r", nodeMap);
    enrichOverlayMetadata(root, nodeMap, promotedToRoot);
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    const rootBackground = bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent" ? bodyBg : htmlBg && htmlBg !== "rgba(0, 0, 0, 0)" && htmlBg !== "transparent" ? htmlBg : "rgb(255, 255, 255)";
    const rootBackgroundInfo = resolvePageBackground(
      root.background,
      detectRootBackground()
    );
    const overlayIds = /* @__PURE__ */ new Set();
    for (const [id, info] of Object.entries(nodeMap)) {
      if (info.overlay) overlayIds.add(id);
    }
    const textFormat = formatTreeAsText(root, 0, "r", rootBackground, overlayIds);
    return {
      data: root,
      textFormat,
      nodeMap,
      rootBackground,
      rootBackgroundInfo
    };
  }
  function parseRgb(color) {
    const match = color.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  function rgbToLab(rgb) {
    const toLinear = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const rl = toLinear(rgb[0]);
    const gl = toLinear(rgb[1]);
    const bl = toLinear(rgb[2]);
    let x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
    let y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
    let z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
    x /= 0.95047;
    y /= 1;
    z /= 1.08883;
    const f = (t) => t > 8856e-6 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
    const L = 116 * f(y) - 16;
    const a = 500 * (f(x) - f(y));
    const bVal = 200 * (f(y) - f(z));
    return [L, a, bVal];
  }
  function deltaE(color1, color2) {
    const rgb1 = parseRgb(color1);
    const rgb2 = parseRgb(color2);
    if (!rgb1 || !rgb2) return Infinity;
    const lab1 = rgbToLab(rgb1);
    const lab2 = rgbToLab(rgb2);
    return Math.sqrt(
      (lab1[0] - lab2[0]) ** 2 + (lab1[1] - lab2[1]) ** 2 + (lab1[2] - lab2[2]) ** 2
    );
  }
  function buildVisualNode(element, minWidth) {
    if (element.id?.startsWith("vibe-blueprint-")) {
      return {
        tag: element.tagName,
        selector: element.tagName.toLowerCase(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        children: []
      };
    }
    const rect = element.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return {
        tag: element.tagName,
        selector: element.tagName.toLowerCase(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        children: []
      };
    }
    const selector = getCssSelector(element);
    const node = {
      tag: element.tagName,
      selector,
      bounds: {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      children: []
    };
    if (element.id) {
      node.id = element.id;
    }
    if (element.classList.length > 0) {
      node.className = element.classList[0];
    }
    const role = element.getAttribute("role");
    if (role) {
      node.role = role;
    }
    const textContent = getDirectTextContent(element);
    if (textContent) {
      node.text = textContent.slice(0, 30);
    }
    const bgImage = style.backgroundImage;
    const bgColor = style.backgroundColor;
    const bgRaw = style.background;
    if (bgImage && bgImage !== "none") {
      if (bgImage.includes("gradient(")) {
        node.background = {
          type: "gradient",
          value: bgImage,
          raw: bgRaw,
          source: "css"
        };
      } else if (bgImage.includes("url(")) {
        const url = bgImage.match(/url\(["']?(.+?)["']?\)/)?.[1] ?? bgImage;
        node.background = {
          type: "image",
          value: url,
          raw: bgRaw,
          source: "css"
        };
      }
    }
    if (!node.background && bgColor && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent") {
      node.background = {
        type: "color",
        value: bgColor,
        raw: bgRaw,
        source: "css"
      };
    }
    if (!node.background) {
      const parentArea = rect.width * rect.height;
      if (parentArea > 0) {
        for (const child of element.children) {
          if (child.tagName !== "IMG") continue;
          const imgRect = child.getBoundingClientRect();
          const imgArea = imgRect.width * imgRect.height;
          if (imgArea / parentArea >= 0.75) {
            const src = child.getAttribute("src") || "";
            node.background = {
              type: "image",
              value: src,
              raw: "",
              source: "img"
            };
            break;
          }
        }
      }
    }
    for (const child of element.children) {
      const childRect = child.getBoundingClientRect();
      const passesWidth = childRect.width >= minWidth;
      const isFixed = !passesWidth && window.getComputedStyle(child).position === "fixed";
      if (passesWidth || isFixed) {
        const childMinWidth = isFixed ? 0 : minWidth;
        const childNode = buildVisualNode(child, childMinWidth);
        if (childNode.bounds.width > 0 || childNode.children.length > 0) {
          node.children.push(childNode);
        }
      }
    }
    const allChildBoxes = [];
    for (const child of element.children) {
      if (child.id?.startsWith("vibe-blueprint-")) continue;
      const childStyle = window.getComputedStyle(child);
      const hidden = childStyle.display === "none" || childStyle.visibility === "hidden" || childStyle.opacity === "0";
      if (hidden) continue;
      const childRect = child.getBoundingClientRect();
      if (childRect.width > 0 && childRect.height > 0) {
        allChildBoxes.push({
          x: Math.round(childRect.left + scrollX),
          y: Math.round(childRect.top + scrollY),
          width: Math.round(childRect.width),
          height: Math.round(childRect.height)
        });
      }
    }
    const layout = detectLayout(allChildBoxes);
    if (layout) {
      node.layout = layout;
    }
    if (node.children.length === 0 && !node.text) {
      const fullText = (element.textContent || "").replace(/[\n\r\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
      if (fullText) {
        node.text = fullText.slice(0, 30);
      }
    }
    if ((node.bounds.width === 0 || node.bounds.height === 0) && node.children.length === 0) {
      return {
        tag: element.tagName,
        selector: element.tagName.toLowerCase(),
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        children: []
      };
    }
    return node;
  }
  function collapseSingleChildren(node) {
    for (const child of node.children) {
      collapseSingleChildren(child);
    }
    while (node.children.length === 1) {
      const child = node.children[0];
      if (!node.text && child.text) {
        node.text = child.text;
      }
      if (!node.layout && child.layout) {
        node.layout = child.layout;
      }
      if (!node.background && child.background) {
        node.background = child.background;
      }
      node.children = child.children;
    }
  }
  function pruneZeroHeightLeaves(node) {
    for (const child of node.children) {
      pruneZeroHeightLeaves(child);
    }
    node.children = node.children.filter((child) => {
      const hasArea = child.bounds.width > 0 && child.bounds.height > 0;
      const hasChildren = child.children.length > 0;
      return hasArea || hasChildren;
    });
  }
  var CONTAINMENT_TOLERANCE = 2;
  function isContainedIn(child, parent) {
    const t = CONTAINMENT_TOLERANCE;
    return child.x >= parent.x - t && child.y >= parent.y - t && child.x + child.width <= parent.x + parent.width + t && child.y + child.height <= parent.y + parent.height + t;
  }
  function promoteEscapedNodes(root) {
    const promotedToRoot = /* @__PURE__ */ new Set();
    function walk(node, ancestors) {
      const stayed = [];
      const escaped = [];
      for (const child of node.children) {
        if (isContainedIn(child.bounds, node.bounds)) {
          stayed.push(child);
        } else {
          escaped.push(child);
        }
      }
      node.children = stayed;
      for (const child of escaped) {
        let placed = false;
        for (let i = ancestors.length - 1; i >= 0; i--) {
          if (isContainedIn(child.bounds, ancestors[i].bounds)) {
            ancestors[i].children.push(child);
            placed = true;
            if (ancestors[i] === root) {
              promotedToRoot.add(child);
            }
            break;
          }
        }
        if (!placed) {
          root.children.push(child);
          promotedToRoot.add(child);
        }
      }
      for (const child of [...node.children]) {
        walk(child, [...ancestors, node]);
      }
      node.children = node.children.filter((child) => {
        const hasArea = child.bounds.width > 0 && child.bounds.height > 0;
        const hasChildren = child.children.length > 0;
        return hasArea || hasChildren;
      });
    }
    const originalChildren = [...root.children];
    root.children = [...originalChildren];
    for (const child of [...root.children]) {
      walk(child, [root]);
    }
    root.children = root.children.filter((child) => {
      const hasArea = child.bounds.width > 0 && child.bounds.height > 0;
      const hasChildren = child.children.length > 0;
      return hasArea || hasChildren;
    });
    return promotedToRoot;
  }
  function boundsIntersect(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function enrichOverlayMetadata(root, nodeMap, promotedToRoot) {
    if (promotedToRoot.size === 0) return;
    const childIdMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < root.children.length; i++) {
      childIdMap.set(root.children[i], `rc${i + 1}`);
    }
    for (const promoted of promotedToRoot) {
      const promotedId = childIdMap.get(promoted);
      if (!promotedId || !nodeMap[promotedId]) continue;
      const occluding = [];
      for (const sibling of root.children) {
        if (sibling === promoted) continue;
        if (promotedToRoot.has(sibling)) continue;
        const siblingId = childIdMap.get(sibling);
        if (!siblingId) continue;
        if (boundsIntersect(promoted.bounds, sibling.bounds)) {
          occluding.push(siblingId);
        }
      }
      if (occluding.length > 0) {
        nodeMap[promotedId].overlay = { occluding };
      }
    }
  }
  function getDirectTextContent(element) {
    let text = "";
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += (node.textContent || "").replace(/[\n\r\t]+/g, " ") + " ";
      }
    }
    return text.replace(/\s{2,}/g, " ").trim();
  }
  function assignPositionalIds(node, prefix, nodeMap) {
    const info = { selector: node.selector };
    if (node.background) {
      info.background = node.background;
    }
    nodeMap[prefix] = info;
    for (let i = 0; i < node.children.length; i++) {
      const childId = `${prefix}c${i + 1}`;
      assignPositionalIds(node.children[i], childId, nodeMap);
    }
  }
  var DELTA_E_THRESHOLD = 5;
  function formatTreeAsText(node, depth, nodeId, rootBackground, overlayIds) {
    const indent = "  ".repeat(depth);
    let descriptor = nodeId;
    if (node.role) descriptor += ` [${node.role}]`;
    if (node.layout) descriptor += ` [${node.layout}]`;
    if (node.background) {
      const isOverlay = overlayIds?.has(nodeId) ?? false;
      const skipInText = !isOverlay && node.background.type === "color" && rootBackground !== void 0 && deltaE(node.background.value, rootBackground) < DELTA_E_THRESHOLD;
      if (!skipInText) {
        descriptor += ` [bg:${node.background.type}]`;
      }
    }
    descriptor += ` @${node.bounds.x},${node.bounds.y}`;
    descriptor += ` ${node.bounds.width}x${node.bounds.height}`;
    if (node.text) {
      descriptor += ` "${node.text}${node.text.length >= 30 ? "..." : ""}"`;
    }
    let result = `${indent}${descriptor}
`;
    for (let i = 0; i < node.children.length; i++) {
      const childId = `${nodeId}c${i + 1}`;
      result += formatTreeAsText(node.children[i], depth + 1, childId, rootBackground, overlayIds);
    }
    return result;
  }
  return __toCommonJS(visual_tree_exports);
})();
/**
 * CSS Selector Generator
 *
 * Extracted from Chrome DevTools (DOMPath.ts) and adapted for TypeScript.
 * Generates a unique CSS selector for any DOM element.
 *
 * @license BSD-3-Clause (Chrome DevTools)
 */
